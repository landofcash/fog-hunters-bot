import { Events, type Client, type Interaction } from "discord.js";
import type { Logger } from "pino";
import { ApiClient } from "../api/client";
import type { BotClaimResponse } from "../api/contracts";
import type { BotConfig } from "../config";
import { createDiscordClient } from "../discord/client";
import { synchronizeGuildCommands } from "../discord/register-commands";
import { handleGuildCreateEvent } from "../events/guild-create";
import { handleGuildDeleteEvent } from "../events/guild-delete";
import { handleGuildUpdateEvent } from "../events/guild-update";
import { handleInteractionCreateEvent } from "../events/interaction-create";
import { MessageResponseBuffer } from "../events/message-create";
import { handleReadyEvent } from "../events/ready";
import { DiscordWebhookAlertNotifier } from "./alerts";
import { registerDiscordLifecycleAlerts } from "./discord-lifecycle";
import { ApiClientError } from "./errors";

function sanitizedErrorCode(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.code) {
    return error.code.slice(0, 100);
  }
  return fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export type ManagedBotRuntimeTerminalReason =
  | "HEARTBEAT_FAILED_AT_LEASE_SAFETY_MARGIN"
  | "LEASE_SAFETY_MARGIN_REACHED";

export type ManagedBotRuntimeTerminalHandler = (
  runtime: ManagedBotRuntime,
  reason: ManagedBotRuntimeTerminalReason,
) => void;

export class ManagedBotRuntime {
  private readonly apiClient: ApiClient;
  private readonly client: Client;
  private readonly messageBuffer: MessageResponseBuffer;
  private readonly logger: Logger;
  private leaseExpiresAt: number;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private safetyTimer?: ReturnType<typeof setTimeout>;
  private commandSyncInFlight?: Promise<void>;
  private acceptingNewWork = true;
  private quarantined = false;
  private stopping = false;
  private terminal = false;
  private flushingBeforeStop = false;
  private ready = false;
  private readyInitializationFailed = false;
  private readonly readyInitialization: Promise<void>;
  private resolveReadyInitialization!: () => void;
  private rejectReadyInitialization!: (error: unknown) => void;

  constructor(
    private readonly config: BotConfig,
    private readonly claim: BotClaimResponse,
    parentLogger: Logger,
    private readonly onTerminal: ManagedBotRuntimeTerminalHandler,
  ) {
    this.logger = parentLogger.child({
      runtimeInstanceId: config.runtimeInstanceId,
      botInstanceId: claim.bot.id,
      discordApplicationId: claim.bot.discordApplicationId,
    });
    this.apiClient = new ApiClient(config, this.logger, {
      botInstanceId: claim.bot.id,
      leaseGeneration: claim.lease.leaseGeneration,
      leaseToken: claim.leaseToken,
    });
    this.client = createDiscordClient();
    this.leaseExpiresAt = new Date(claim.lease.expiresAt ?? 0).getTime();
    this.readyInitialization = new Promise<void>((resolve, reject) => {
      this.resolveReadyInitialization = resolve;
      this.rejectReadyInitialization = reject;
    });
    this.messageBuffer = new MessageResponseBuffer(
      this.apiClient,
      this.logger,
      {},
      () => this.canPerformDiscordSideEffects(),
    );
  }

  get botInstanceId(): string {
    return this.claim.bot.id;
  }

  get tokenVersion(): number {
    return this.claim.bot.tokenVersion;
  }

  get runtimeState(): "CONNECTING" | "READY" | "QUARANTINED" | "STOPPED" {
    if (this.stopping) return "STOPPED";
    if (this.quarantined) return "QUARANTINED";
    return this.ready ? "READY" : "CONNECTING";
  }

  async start(): Promise<void> {
    this.registerEventHandlers();
    this.resetSafetyTimer();
    await this.renewLease("CONNECTING");
    this.scheduleHeartbeat();

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.loginRetryMax; attempt += 1) {
      if (this.stopping) return;
      try {
        await Promise.all([
          this.client.login(this.claim.discordToken),
          this.readyInitialization,
        ]);
        if (this.stopping) return;
        return;
      } catch (error) {
        lastError = error;
        const finalAttempt =
          this.readyInitializationFailed ||
          attempt === this.config.loginRetryMax;
        await this.reportRuntimeState(
          finalAttempt ? "ERROR" : "BACKOFF",
          this.readyInitializationFailed
            ? "READY_INITIALIZATION_FAILED"
            : "DISCORD_LOGIN_FAILED",
        ).catch(() => undefined);
        if (finalAttempt) break;

        const backoff = Math.min(
          this.config.loginRetryBaseMs * 2 ** attempt,
          30_000,
        );
        this.logger.warn(
          { err: error, attempt: attempt + 1, retryAfterMs: backoff },
          "Discord login failed; retrying this bot only",
        );
        await delay(backoff);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Discord login failed.");
  }

  async stop(options: { releaseLease?: boolean; reason?: string } = {}): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.acceptingNewWork = false;
    this.clearTimers();

    if (!this.quarantined && Date.now() < this.leaseExpiresAt) {
      this.flushingBeforeStop = true;
      try {
        await this.messageBuffer.flushAll();
      } catch (error) {
        this.logger.warn({ err: error }, "Failed to flush bot message buffers");
      } finally {
        this.flushingBeforeStop = false;
      }
    } else {
      this.messageBuffer.cancelAll();
    }

    this.quarantined = true;
    this.client.destroy();

    if (options.releaseLease !== false) {
      await this.apiClient.release().catch((error) => {
        this.logger.warn(
          { err: error, reason: options.reason },
          "Failed to release bot runtime lease",
        );
      });
    }

    this.logger.info({ reason: options.reason }, "Managed bot runtime stopped");
  }

  private registerEventHandlers(): void {
    const alerts = new DiscordWebhookAlertNotifier(
      this.config.alertDiscordWebhookUrl,
      `fhaibot-bot:${this.claim.bot.slug}`,
      this.logger,
      this.config.alertCooldownMs,
      this.config.alertRequestTimeoutMs,
    );
    registerDiscordLifecycleAlerts({
      client: this.client,
      alerts,
      logger: this.logger,
      isShuttingDown: () => this.stopping,
    });

    this.client.once(Events.ClientReady, (client) => {
      void this.onReady(client);
    });

    this.client.on(Events.GuildCreate, (guild) => {
      if (!this.canAcceptNewWork()) return;
      void handleGuildCreateEvent({
        guild,
        apiClient: this.apiClient,
        botToken: this.claim.discordToken,
        discordApplicationId: this.claim.bot.discordApplicationId,
        logger: this.logger,
      }).catch((error) => {
        this.logger.error({ err: error, guildId: guild.id }, "Guild bootstrap failed");
      });
    });

    this.client.on(Events.GuildDelete, (guild) => {
      if (!this.canAcceptNewWork()) return;
      void handleGuildDeleteEvent({
        guild,
        apiClient: this.apiClient,
        logger: this.logger,
      }).catch((error) => {
        this.logger.error(
          { err: error, guildId: guild.id },
          "Guild departure reconciliation failed",
        );
      });
    });

    this.client.on(Events.GuildUpdate, (oldGuild, newGuild) => {
      if (!this.canAcceptNewWork()) return;
      void handleGuildUpdateEvent({
        oldGuild,
        newGuild,
        apiClient: this.apiClient,
        logger: this.logger,
      }).catch((error) => {
        this.logger.error(
          { err: error, guildId: newGuild.id },
          "Guild metadata reconciliation failed",
        );
      });
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!this.canAcceptNewWork()) return;
      this.fenceInteraction(interaction);
      void this.processEvent(interaction.id, "INTERACTION_CREATE", () =>
        handleInteractionCreateEvent({
          interaction,
          apiClient: this.apiClient,
          logger: this.logger,
        }),
      );
    });

    this.client.on(Events.MessageCreate, (message) => {
      if (!this.canAcceptNewWork()) return;
      void this.processEvent(message.id, "MESSAGE_CREATE", () =>
        this.messageBuffer.enqueueAndWait(message),
      );
    });
  }

  private fenceInteraction(interaction: Interaction): void {
    for (const method of ["reply", "deferReply", "editReply", "followUp"] as const) {
      const value = (interaction as unknown as Record<string, unknown>)[method];
      if (typeof value !== "function") continue;
      const original = value.bind(interaction) as (...args: unknown[]) => unknown;
      Object.defineProperty(interaction, method, {
        configurable: true,
        value: (...args: unknown[]) => {
          if (!this.canPerformDiscordSideEffects()) {
            return Promise.reject(new Error("RUNTIME_QUARANTINED"));
          }
          return original(...args);
        },
      });
    }
  }

  private async onReady(client: Client<true>): Promise<void> {
    if (this.stopping) return;

    try {
      const observedApplicationId = client.application?.id;
      if (observedApplicationId !== this.claim.bot.discordApplicationId) {
        await this.enterQuarantine("DISCORD_APPLICATION_ID_MISMATCH");
        throw new Error("Discord application identity did not match the assignment.");
      }

      await this.apiClient.reportIdentity({
        discordApplicationId: observedApplicationId,
        discordBotUserId: client.user.id,
        discordUsername: client.user.username,
        discordAvatarUrl: client.user.displayAvatarURL() ?? null,
      });
      if (this.stopping) return;

      await handleReadyEvent({
        client,
        apiClient: this.apiClient,
        botToken: this.claim.discordToken,
        discordApplicationId: this.claim.bot.discordApplicationId,
        logger: this.logger,
      });
      if (this.stopping) return;

      this.ready = true;
      await this.renewLease("READY", new Date());
      if (this.stopping) return;
      this.resolveReadyInitialization();
    } catch (error) {
      if (this.stopping) return;

      this.readyInitializationFailed = true;
      this.logger.error({ err: error }, "Managed bot ready initialization failed");
      await this.enterQuarantine(sanitizedErrorCode(error, "READY_INITIALIZATION_FAILED"));
      this.client.destroy();
      this.rejectReadyInitialization(error);
    }
  }

  private async processEvent(
    eventId: string,
    eventType: "MESSAGE_CREATE" | "INTERACTION_CREATE",
    handler: () => Promise<void>,
  ): Promise<void> {
    if (!this.canAcceptNewWork()) return;

    let receipt: { id: string; acquisitionRequestId: string } | undefined;
    try {
      const acquisition = await this.apiClient.acquireEvent(eventId, eventType);
      if (!acquisition.acquired) return;
      receipt = acquisition.receipt;
      if (!this.canPerformDiscordSideEffects()) {
        await this.apiClient.failEvent(
          receipt.id,
          receipt.acquisitionRequestId,
          "RUNTIME_QUARANTINED",
        );
        return;
      }
      await handler();
      if (!this.canPerformDiscordSideEffects()) {
        await this.apiClient.failEvent(
          receipt.id,
          receipt.acquisitionRequestId,
          "RUNTIME_QUARANTINED",
        );
        return;
      }
      await this.apiClient.completeEvent(receipt.id, receipt.acquisitionRequestId);
    } catch (error) {
      this.logger.error({ err: error, eventId, eventType }, "Discord event handling failed");
      if (receipt) {
        await this.apiClient
          .failEvent(
            receipt.id,
            receipt.acquisitionRequestId,
            sanitizedErrorCode(error, "EVENT_HANDLER_FAILED"),
          )
          .catch((receiptError) => {
            this.logger.warn(
              { err: receiptError, eventId, eventType },
              "Failed to mark Discord event receipt as failed",
            );
          });
      }
    }
  }

  private canAcceptNewWork(): boolean {
    return this.acceptingNewWork && this.canPerformDiscordSideEffects();
  }

  private canPerformDiscordSideEffects(): boolean {
    return (
      (!this.stopping || this.flushingBeforeStop) &&
      !this.quarantined &&
      Date.now() < this.leaseExpiresAt - this.config.leaseSafetyMarginMs
    );
  }

  private scheduleHeartbeat(delayMs = this.claim.heartbeatAfterMs): void {
    if (this.stopping) return;
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      void this.heartbeatTick();
    }, delayMs);
  }

  private async heartbeatTick(): Promise<void> {
    if (this.stopping) return;
    try {
      await this.renewLease(this.ready ? "READY" : "CONNECTING");
      if (this.stopping) return;

      if (this.quarantined) {
        this.quarantined = false;
        this.acceptingNewWork = true;
        this.logger.info("Bot runtime lease ownership recovered");
      }
      this.scheduleHeartbeat();
      if (this.ready) {
        this.startCommandSyncMaintenance();
      }
    } catch (error) {
      await this.enterQuarantine(sanitizedErrorCode(error, "HEARTBEAT_FAILED"));
      if (this.terminal) return;

      const remaining = this.leaseExpiresAt - Date.now();
      if (remaining <= this.config.leaseSafetyMarginMs) {
        this.terminate("HEARTBEAT_FAILED_AT_LEASE_SAFETY_MARGIN");
        return;
      }
      this.scheduleHeartbeat(
        Math.min(this.claim.heartbeatAfterMs, Math.max(1_000, remaining / 2)),
      );
    }
  }

  private async renewLease(
    runtimeState: "CONNECTING" | "READY",
    connectedAt?: Date,
  ): Promise<void> {
    const { lease } = await this.apiClient.heartbeat({
      runtimeState,
      connectedAt,
      errorCode: null,
    });
    if (this.stopping) return;

    if (
      lease.leaseGeneration !== this.claim.lease.leaseGeneration ||
      lease.claimedTokenVersion !== this.claim.bot.tokenVersion
    ) {
      throw new ApiClientError(
        409,
        "Runtime lease fencing values changed.",
        "BOT_LEASE_GENERATION_MISMATCH",
      );
    }
    this.leaseExpiresAt = new Date(lease.expiresAt ?? 0).getTime();
    this.resetSafetyTimer();
  }

  private startCommandSyncMaintenance(): void {
    if (this.stopping || this.commandSyncInFlight) return;

    this.commandSyncInFlight = this.synchronizePendingCommandManifests()
      .catch((error) => {
        this.logger.warn(
          { err: error },
          "Pending command manifest polling failed; lease remains healthy",
        );
      })
      .finally(() => {
        this.commandSyncInFlight = undefined;
      });
  }

  private async synchronizePendingCommandManifests(): Promise<void> {
    const { items } = await this.apiClient.pendingCommandManifests();
    for (const installation of items) {
      if (this.stopping || !this.canPerformDiscordSideEffects()) return;
      try {
        await synchronizeGuildCommands({
          apiClient: this.apiClient,
          botToken: this.claim.discordToken,
          clientId: this.claim.bot.discordApplicationId,
          guildId: installation.guildDiscordId,
          previousHash: installation.lastCommandManifestHash,
          previousErrorCode: installation.lastCommandSyncErrorCode,
          logger: this.logger,
        });
      } catch (error) {
        this.logger.error(
          { err: error, guildId: installation.guildDiscordId },
          "Pending command synchronization failed",
        );
      }
    }
  }

  private async reportRuntimeState(
    runtimeState: "BACKOFF" | "ERROR" | "QUARANTINED",
    errorCode: string,
  ): Promise<void> {
    const { lease } = await this.apiClient.heartbeat({
      runtimeState,
      errorCode,
    });
    if (this.stopping) return;

    this.leaseExpiresAt = new Date(lease.expiresAt ?? 0).getTime();
    this.resetSafetyTimer();
  }

  private async enterQuarantine(errorCode: string): Promise<void> {
    if (this.stopping) return;

    if (!this.quarantined) {
      this.quarantined = true;
      this.acceptingNewWork = false;
      this.messageBuffer.cancelAll();
      this.logger.error({ errorCode }, "Managed bot runtime quarantined");
    }

    if (Date.now() >= this.leaseExpiresAt - this.config.leaseSafetyMarginMs) {
      this.terminate("LEASE_SAFETY_MARGIN_REACHED");
      return;
    }

    await this.reportRuntimeState("QUARANTINED", errorCode).catch(() => undefined);
  }

  private resetSafetyTimer(): void {
    clearTimeout(this.safetyTimer);
    if (this.stopping) return;

    const delayMs = Math.max(
      0,
      this.leaseExpiresAt - this.config.leaseSafetyMarginMs - Date.now(),
    );
    this.safetyTimer = setTimeout(() => {
      this.terminate("LEASE_SAFETY_MARGIN_REACHED");
    }, delayMs);
  }

  private terminate(reason: ManagedBotRuntimeTerminalReason): void {
    if (this.terminal || this.stopping) return;

    this.terminal = true;
    this.stopping = true;
    this.acceptingNewWork = false;
    this.quarantined = true;
    this.ready = false;
    this.clearTimers();
    this.messageBuffer.cancelAll();
    this.client.destroy();
    this.rejectReadyInitialization(new Error(`Managed bot runtime terminated: ${reason}`));
    this.logger.error({ reason }, "Managed bot runtime terminated");

    try {
      this.onTerminal(this, reason);
    } catch (error) {
      this.logger.error(
        { err: error, reason },
        "Managed bot runtime terminal notification failed",
      );
    }
  }

  private clearTimers(): void {
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.safetyTimer);
  }
}
