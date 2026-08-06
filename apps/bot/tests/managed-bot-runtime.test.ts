import { EventEmitter } from "node:events";
import { Events, type Client, type Guild } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotClaimResponse } from "../src/api/contracts";
import { ManagedBotRuntime } from "../src/runtime/managed-bot-runtime";
import {
  createBotConfig,
  createInteractionMock,
  createLoggerMock,
  createMessageMock,
} from "./helpers/fixtures";

const runtimeMocks = vi.hoisted(() => ({
  client: undefined as unknown as Client,
  heartbeat: vi.fn(),
  reportIdentity: vi.fn(),
  pendingCommandManifests: vi.fn(),
  acquireEvent: vi.fn(),
  completeEvent: vi.fn(),
  failEvent: vi.fn(),
  touchUser: vi.fn(),
  respondWithLlm: vi.fn(),
  handleGuildCreateEvent: vi.fn(),
  handleReadyEvent: vi.fn(),
  handleInteractionCreateEvent: vi.fn(),
}));

vi.mock("../src/api/client", () => ({
  ApiClient: class {
    readonly botInstanceId = "bot-1";
    heartbeat = runtimeMocks.heartbeat;
    reportIdentity = runtimeMocks.reportIdentity;
    pendingCommandManifests = runtimeMocks.pendingCommandManifests;
    acquireEvent = runtimeMocks.acquireEvent;
    completeEvent = runtimeMocks.completeEvent;
    failEvent = runtimeMocks.failEvent;
    touchUser = runtimeMocks.touchUser;
    respondWithLlm = runtimeMocks.respondWithLlm;
  },
}));

vi.mock("../src/discord/client", () => ({
  createDiscordClient: () => runtimeMocks.client,
}));

vi.mock("../src/events/ready", () => ({
  handleReadyEvent: runtimeMocks.handleReadyEvent,
}));

vi.mock("../src/events/guild-create", () => ({
  handleGuildCreateEvent: runtimeMocks.handleGuildCreateEvent,
}));

vi.mock("../src/events/interaction-create", () => ({
  handleInteractionCreateEvent: runtimeMocks.handleInteractionCreateEvent,
}));

function createClaim(): BotClaimResponse {
  return {
    bot: {
      id: "bot-1",
      slug: "bot-one",
      displayName: "Bot One",
      discordApplicationId: "application-1",
      desiredStatus: "ACTIVE",
      tokenVersion: 1,
      tokenConfigured: true,
    },
    profile: {
      id: "profile-1",
      botInstanceId: "bot-1",
      defaultModel: "gpt-5.6-luna",
      reasoningEffort: "low",
      dmEnabled: true,
      retentionDays: 30,
      maxInputChars: 4_000,
      maxOutputTokens: 512,
    },
    lease: {
      botInstanceId: "bot-1",
      runtimeInstanceId: "runtime-1",
      leaseGeneration: 3,
      runtimeState: "CLAIMED",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      claimedTokenVersion: 1,
    },
    leaseToken: "lease-token",
    discordToken: "discord-token",
    heartbeatAfterMs: 15_000,
  };
}

class FakeDiscordClient extends EventEmitter {
  readonly application = { id: "application-1" };
  readonly user = {
    id: "bot-user-1",
    username: "bot-one",
    displayAvatarURL: () => null,
  };
  readonly guilds = { cache: new Map() };
  readonly destroy = vi.fn();
  readonly login = vi.fn(async () => {
    queueMicrotask(() => this.emit(Events.ClientReady, this));
    return "discord-token";
  });
}

describe("ManagedBotRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-08-03T12:00:00Z") });
    runtimeMocks.client = new FakeDiscordClient() as unknown as Client;
    runtimeMocks.reportIdentity.mockResolvedValue(undefined);
    runtimeMocks.pendingCommandManifests.mockResolvedValue({ items: [] });
    runtimeMocks.acquireEvent.mockResolvedValue({
      receipt: {
        id: "00000000-0000-4000-8000-000000000001",
        acquisitionRequestId: "00000000-0000-4000-8000-000000000002",
        processingStatus: "PROCESSING",
        attemptCount: 1,
      },
      acquired: true,
    });
    runtimeMocks.completeEvent.mockResolvedValue(undefined);
    runtimeMocks.failEvent.mockResolvedValue(undefined);
    runtimeMocks.touchUser.mockResolvedValue(undefined);
    runtimeMocks.respondWithLlm.mockResolvedValue({ shouldRespond: false });
    runtimeMocks.handleGuildCreateEvent.mockResolvedValue(undefined);
    runtimeMocks.handleInteractionCreateEvent.mockResolvedValue(undefined);
    runtimeMocks.heartbeat.mockImplementation(async (input: { runtimeState: string }) => ({
      lease: {
        botInstanceId: "bot-1",
        runtimeInstanceId: "runtime-1",
        leaseGeneration: 3,
        runtimeState: input.runtimeState,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        claimedTokenVersion: 1,
      },
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("bootstraps a guild when it becomes available", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );
    await runtime.start();
    const availableGuild = {
      id: "available-guild",
      available: true,
    } as Guild;

    client.emit(Events.GuildAvailable, availableGuild);
    await vi.advanceTimersByTimeAsync(0);

    expect(runtimeMocks.handleGuildCreateEvent).toHaveBeenCalledWith({
      guild: availableGuild,
      apiClient: expect.any(Object),
      botToken: "discord-token",
      discordApplicationId: "application-1",
      discordBotUserId: "bot-user-1",
      canPerformDiscordSideEffects: expect.any(Function),
      logger,
    });

    await runtime.stop({ releaseLease: false, reason: "test complete" });
  });

  it("renews the lease while Discord ready reconciliation is still running", async () => {
    let finishReady!: () => void;
    runtimeMocks.handleReadyEvent.mockReturnValue(new Promise<void>((resolve) => {
      finishReady = resolve;
    }));
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(runtimeMocks.handleReadyEvent).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.heartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(runtimeMocks.heartbeat).toHaveBeenNthCalledWith(2, {
      runtimeState: "CONNECTING",
      errorCode: null,
    });
    expect(client.destroy).not.toHaveBeenCalled();

    finishReady();
    await vi.advanceTimersByTimeAsync(0);
    await start;
    await runtime.stop({ releaseLease: false, reason: "test complete" });
  });

  it("keeps a renewed runtime ready when pending command polling fails", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    runtimeMocks.pendingCommandManifests.mockRejectedValue(new Error("manifest API unavailable"));
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;
    expect(runtime.runtimeState).toBe("READY");

    await vi.advanceTimersByTimeAsync(15_000);

    expect(runtimeMocks.pendingCommandManifests).toHaveBeenCalledTimes(1);
    expect(runtime.runtimeState).toBe("READY");
    expect(client.destroy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Pending command manifest polling failed; lease remains healthy",
    );

    await runtime.stop({ releaseLease: false, reason: "test complete" });
  });

  it("keeps renewing the lease while one command synchronization poll remains in flight", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    let finishCommandSync!: (value: { items: [] }) => void;
    runtimeMocks.pendingCommandManifests.mockReturnValue(
      new Promise<{ items: [] }>((resolve) => {
        finishCommandSync = resolve;
      }),
    );
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;

    await vi.advanceTimersByTimeAsync(15_000);
    expect(runtimeMocks.pendingCommandManifests).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(runtimeMocks.heartbeat).toHaveBeenCalledTimes(7);
    expect(runtimeMocks.pendingCommandManifests).toHaveBeenCalledTimes(1);
    expect(runtime.runtimeState).toBe("READY");
    expect(client.destroy).not.toHaveBeenCalled();

    finishCommandSync({ items: [] });
    await vi.advanceTimersByTimeAsync(0);
    await runtime.stop({ releaseLease: false, reason: "test complete" });
  });

  it("reconciles the current guild cache before leaving heartbeat quarantine", async () => {
    let finishRecovery!: () => void;
    runtimeMocks.handleReadyEvent
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishRecovery = resolve;
      }));
    let readyHeartbeatCount = 0;
    runtimeMocks.heartbeat.mockImplementation(async (input: { runtimeState: string }) => {
      if (input.runtimeState === "READY") {
        readyHeartbeatCount += 1;
        if (readyHeartbeatCount === 2) {
          throw new Error("API unavailable");
        }
      }
      return {
        lease: {
          botInstanceId: "bot-1",
          runtimeInstanceId: "runtime-1",
          leaseGeneration: 3,
          runtimeState: input.runtimeState,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          claimedTokenVersion: 1,
        },
      };
    });
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );

    await runtime.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(runtime.runtimeState).toBe("QUARANTINED");

    const joinedGuild = {
      id: "joined-during-quarantine",
      available: true,
    } as Guild;
    client.guilds.cache.set(joinedGuild.id, joinedGuild);
    client.emit(Events.GuildCreate, joinedGuild);
    await vi.advanceTimersByTimeAsync(0);
    expect(runtimeMocks.handleGuildCreateEvent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(runtimeMocks.handleReadyEvent).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.handleReadyEvent).toHaveBeenLastCalledWith({
      client,
      apiClient: expect.any(Object),
      botToken: "discord-token",
      discordApplicationId: "application-1",
      canPerformDiscordSideEffects: expect.any(Function),
      logger,
    });
    expect(client.guilds.cache.get(joinedGuild.id)).toBe(joinedGuild);
    expect(runtime.runtimeState).toBe("QUARANTINED");

    finishRecovery();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.runtimeState).toBe("READY");

    await runtime.stop({ releaseLease: false, reason: "test complete" });
  });

  it("terminates once and stops heartbeats at the lease safety margin", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    let successfulHeartbeats = 0;
    runtimeMocks.heartbeat.mockImplementation(async (input: { runtimeState: string }) => {
      if (successfulHeartbeats >= 2) {
        throw new Error("API unavailable");
      }
      successfulHeartbeats += 1;
      return {
        lease: {
          botInstanceId: "bot-1",
          runtimeInstanceId: "runtime-1",
          leaseGeneration: 3,
          runtimeState: input.runtimeState,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          claimedTokenVersion: 1,
        },
      };
    });
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const onTerminal = vi.fn();
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      onTerminal,
    );

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;

    await vi.advanceTimersByTimeAsync(40_000);

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith(
      runtime,
      "LEASE_SAFETY_MARGIN_REACHED",
    );
    expect(runtime.runtimeState).toBe("STOPPED");
    expect(client.destroy).toHaveBeenCalledTimes(1);

    const heartbeatCountAtTermination = runtimeMocks.heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtimeMocks.heartbeat).toHaveBeenCalledTimes(heartbeatCountAtTermination);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("uses the acquired request ID to complete an event processing attempt", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;

    client.emit(Events.InteractionCreate, { id: "interaction-1" });
    await vi.advanceTimersByTimeAsync(0);

    expect(runtimeMocks.acquireEvent).toHaveBeenCalledWith(
      "interaction-1",
      "INTERACTION_CREATE",
    );
    expect(runtimeMocks.handleInteractionCreateEvent).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.completeEvent).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    );
    expect(runtimeMocks.failEvent).not.toHaveBeenCalled();

    await runtime.stop({ releaseLease: false, reason: "test complete" });
  });

  it("serializes receipt acquisition and buffering for messages in one channel", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    let resolveOlderReceipt!: (value: unknown) => void;
    runtimeMocks.acquireEvent.mockImplementation((eventId: string) => {
      const acquisition = {
        receipt: {
          id: `00000000-0000-4000-8000-00000000000${eventId}`,
          acquisitionRequestId: `10000000-0000-4000-8000-00000000000${eventId}`,
          processingStatus: "PROCESSING",
          attemptCount: 1,
        },
        acquired: true,
      };
      if (eventId === "1") {
        return new Promise((resolve) => {
          resolveOlderReceipt = resolve;
        });
      }
      return Promise.resolve(acquisition);
    });
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;

    client.emit(Events.MessageCreate, createMessageMock({
      id: "1",
      content: "Older message",
    }));
    client.emit(Events.MessageCreate, createMessageMock({
      id: "2",
      content: "Newer message",
    }));
    await vi.advanceTimersByTimeAsync(0);

    expect(runtimeMocks.acquireEvent).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.acquireEvent).toHaveBeenCalledWith("1", "MESSAGE_CREATE");

    await vi.advanceTimersByTimeAsync(4_000);
    expect(runtimeMocks.respondWithLlm).not.toHaveBeenCalled();

    resolveOlderReceipt({
      receipt: {
        id: "00000000-0000-4000-8000-000000000001",
        acquisitionRequestId: "10000000-0000-4000-8000-000000000001",
        processingStatus: "PROCESSING",
        attemptCount: 1,
      },
      acquired: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(runtimeMocks.acquireEvent).toHaveBeenNthCalledWith(
      2,
      "2",
      "MESSAGE_CREATE",
    );
    expect(runtimeMocks.respondWithLlm).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(runtimeMocks.respondWithLlm).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.respondWithLlm).toHaveBeenCalledWith(expect.objectContaining({
      content: "Newer message",
      messageId: "2",
      contextMessages: [{
        discordUserId: "user-1",
        content: "Older message",
        messageId: "1",
      }],
    }));

    await runtime.stop({ releaseLease: false, reason: "test complete" });
  });

  it("cancels buffered message work when an assignment is revoked", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    runtimeMocks.respondWithLlm.mockResolvedValue({
      shouldRespond: true,
      replyText: "Revoked reply",
    });
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );
    const send = vi.fn().mockResolvedValue(undefined);

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;

    client.emit(Events.MessageCreate, createMessageMock({
      id: "revoked-message",
      channel: { send },
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(runtimeMocks.acquireEvent).toHaveBeenCalledWith(
      "revoked-message",
      "MESSAGE_CREATE",
    );

    await runtime.stop({
      releaseLease: false,
      reason: "TOKEN_VERSION_CHANGED",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runtimeMocks.respondWithLlm).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("fences an in-flight interaction reply when an assignment is revoked", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    let releaseInteraction!: () => void;
    const interactionCanFinish = new Promise<void>((resolve) => {
      releaseInteraction = resolve;
    });
    runtimeMocks.handleInteractionCreateEvent.mockImplementation(
      async (input: { interaction: { reply: (options: { content: string }) => Promise<unknown> } }) => {
        await interactionCanFinish;
        await input.interaction.reply({ content: "Late reply" });
      },
    );
    let releaseBufferFlush!: () => void;
    runtimeMocks.respondWithLlm.mockReturnValue(new Promise((resolve) => {
      releaseBufferFlush = () => resolve({ shouldRespond: false });
    }));
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = createInteractionMock({
      id: "revoked-interaction",
      reply,
    });

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;

    client.emit(Events.InteractionCreate, interaction);
    await vi.advanceTimersByTimeAsync(0);
    expect(runtimeMocks.handleInteractionCreateEvent).toHaveBeenCalledTimes(1);

    client.emit(Events.MessageCreate, createMessageMock({
      id: "pending-message",
      channelId: "pending-channel",
    }));
    await vi.advanceTimersByTimeAsync(0);

    const stop = runtime.stop({
      releaseLease: false,
      reason: "ASSIGNMENT_REMOVED",
    });
    await vi.advanceTimersByTimeAsync(0);
    releaseInteraction();
    await vi.advanceTimersByTimeAsync(0);

    expect(reply).not.toHaveBeenCalled();

    releaseBufferFlush();
    await vi.advanceTimersByTimeAsync(0);
    await stop;
  });

  it("flushes buffered message work during a graceful pool shutdown", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    runtimeMocks.respondWithLlm.mockResolvedValue({
      shouldRespond: true,
      replyText: "Graceful reply",
    });
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );
    const send = vi.fn().mockResolvedValue(undefined);

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;

    client.emit(Events.MessageCreate, createMessageMock({
      id: "shutdown-message",
      channel: { send },
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(runtimeMocks.acquireEvent).toHaveBeenCalledWith(
      "shutdown-message",
      "MESSAGE_CREATE",
    );

    await runtime.stop({
      releaseLease: false,
      reason: "POOL_SHUTDOWN",
    });

    expect(runtimeMocks.respondWithLlm).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "shutdown-message" }),
    );
    expect(send).toHaveBeenCalledWith({ content: "Graceful reply" });
  });

  it("skips receipt acquisition for ignored message events", async () => {
    runtimeMocks.handleReadyEvent.mockResolvedValue(undefined);
    const client = runtimeMocks.client as unknown as FakeDiscordClient;
    const logger = createLoggerMock();
    Object.assign(logger, { child: vi.fn().mockReturnValue(logger) });
    const runtime = new ManagedBotRuntime(
      createBotConfig(),
      createClaim(),
      logger,
      vi.fn(),
    );

    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await start;

    client.emit(Events.MessageCreate, createMessageMock({
      id: "bot-message",
      author: { bot: true },
    }));
    client.emit(Events.MessageCreate, createMessageMock({
      id: "webhook-message",
      webhookId: "webhook-1",
    }));
    client.emit(Events.MessageCreate, createMessageMock({
      id: "empty-message",
      content: "   ",
    }));
    await vi.advanceTimersByTimeAsync(0);

    expect(runtimeMocks.acquireEvent).not.toHaveBeenCalled();
    expect(runtimeMocks.completeEvent).not.toHaveBeenCalled();

    await runtime.stop({ releaseLease: false, reason: "test complete" });
  });
});
