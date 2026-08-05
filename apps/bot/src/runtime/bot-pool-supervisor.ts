import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { PoolApiClient } from "../api/client";
import type { BotConfig } from "../config";
import { ApiClientError } from "./errors";
import {
  ManagedBotRuntime,
  type ManagedBotRuntimeTerminalReason,
} from "./managed-bot-runtime";

export interface BotPoolHealth {
  healthy: boolean;
  supervisorRunning: boolean;
  apiConnected: boolean;
  lastSuccessfulPollAt?: string;
  managedBots: number;
  runtimeStates: Record<string, string>;
}

export class BotPoolSupervisor {
  private readonly apiClient: PoolApiClient;
  private readonly runtimes = new Map<string, ManagedBotRuntime>();
  private readonly claimRequestIds = new Map<string, string>();
  private running = false;
  private lastSuccessfulPollAt?: number;
  private loopPromise?: Promise<void>;
  private wakePollDelay?: () => void;
  private pollRequested = false;

  constructor(
    private readonly config: BotConfig,
    private readonly logger: Logger,
  ) {
    this.apiClient = new PoolApiClient(config, logger);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wakePollDelay?.();
    await this.loopPromise;
    await Promise.all(
      [...this.runtimes.values()].map((runtime) =>
        runtime.stop({ reason: "POOL_SHUTDOWN" }),
      ),
    );
    this.runtimes.clear();
    this.logger.info("Bot pool supervisor stopped");
  }

  health(): BotPoolHealth {
    const apiConnected =
      this.lastSuccessfulPollAt !== undefined &&
      Date.now() - this.lastSuccessfulPollAt <= Math.max(this.config.assignmentPollMs * 3, 45_000);
    return {
      healthy: this.running && apiConnected,
      supervisorRunning: this.running,
      apiConnected,
      lastSuccessfulPollAt: this.lastSuccessfulPollAt
        ? new Date(this.lastSuccessfulPollAt).toISOString()
        : undefined,
      managedBots: this.runtimes.size,
      runtimeStates: Object.fromEntries(
        [...this.runtimes].map(([botId, runtime]) => [botId, runtime.runtimeState]),
      ),
    };
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      this.pollRequested = false;
      try {
        await this.reconcile();
      } catch (error) {
        this.logger.error({ err: error }, "Bot assignment reconciliation failed");
      }
      if (this.running && !this.pollRequested) await this.waitForNextPoll();
    }
  }

  private waitForNextPoll(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakePollDelay = undefined;
        resolve();
      }, this.config.assignmentPollMs);
      this.wakePollDelay = () => {
        clearTimeout(timer);
        this.wakePollDelay = undefined;
        resolve();
      };
    });
  }

  private async reconcile(): Promise<void> {
    const response = await this.apiClient.listAssignments();
    this.lastSuccessfulPollAt = Date.now();
    const assignments = new Map(
      response.items.map((assignment) => [assignment.botInstanceId, assignment]),
    );

    for (const [botId, runtime] of this.runtimes) {
      const assignment = assignments.get(botId);
      if (runtime.runtimeState === "STOPPED") {
        this.runtimes.delete(botId);
        continue;
      }
      if (!assignment || assignment.tokenVersion !== runtime.tokenVersion) {
        await runtime.stop({
          reason: assignment ? "TOKEN_VERSION_CHANGED" : "ASSIGNMENT_REMOVED",
        });
        this.runtimes.delete(botId);
        this.claimRequestIds.delete(botId);
      }
    }

    await Promise.all(
      [...assignments.values()].map(async (assignment) => {
        if (this.runtimes.has(assignment.botInstanceId)) return;
        if (
          assignment.runtime.runtimeInstanceId === this.config.runtimeInstanceId &&
          assignment.runtime.claimRequestId
        ) {
          const expiresAt = assignment.runtime.expiresAt
            ? new Date(assignment.runtime.expiresAt).getTime()
            : 0;
          if (!assignment.runtime.revokedAt && expiresAt > Date.now()) {
            this.claimRequestIds.set(
              assignment.botInstanceId,
              assignment.runtime.claimRequestId,
            );
          } else if (
            this.claimRequestIds.get(assignment.botInstanceId)
            === assignment.runtime.claimRequestId
          ) {
            this.claimRequestIds.delete(assignment.botInstanceId);
          }
        }
        await this.claimAndStart(assignment.botInstanceId);
      }),
    );
  }

  private async claimAndStart(botInstanceId: string): Promise<void> {
    const claimRequestId =
      this.claimRequestIds.get(botInstanceId) ?? randomUUID();
    this.claimRequestIds.set(botInstanceId, claimRequestId);

    try {
      const claim = await this.apiClient.claimBot(botInstanceId, claimRequestId);
      const runtime = new ManagedBotRuntime(
        this.config,
        claim,
        this.logger,
        (terminalRuntime, reason) => {
          this.handleRuntimeTerminal(terminalRuntime, reason);
        },
      );
      this.runtimes.set(botInstanceId, runtime);
      this.claimRequestIds.delete(botInstanceId);

      void runtime.start().catch(async (error) => {
        this.logger.error(
          { err: error, botInstanceId },
          "Managed bot runtime exhausted its connection attempts",
        );
        await runtime.stop({ reason: "START_FAILED" });
        if (this.runtimes.get(botInstanceId) === runtime) {
          this.runtimes.delete(botInstanceId);
        }
      });
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        ["BOT_LEASE_CONFLICT", "BOT_LEASE_ALREADY_OWNED"].includes(error.code ?? "")
      ) {
        this.logger.debug(
          { botInstanceId, code: error.code },
          "Bot assignment is owned by another runtime",
        );
        if (error.code === "BOT_LEASE_CONFLICT") {
          this.claimRequestIds.delete(botInstanceId);
        }
        return;
      }
      throw error;
    }
  }

  private handleRuntimeTerminal(
    runtime: ManagedBotRuntime,
    reason: ManagedBotRuntimeTerminalReason,
  ): void {
    const botInstanceId = runtime.botInstanceId;
    if (this.runtimes.get(botInstanceId) !== runtime) return;

    this.runtimes.delete(botInstanceId);
    this.logger.warn(
      { botInstanceId, reason },
      "Terminal bot runtime evicted from supervisor",
    );
    this.pollRequested = true;
    this.wakePollDelay?.();
  }
}
