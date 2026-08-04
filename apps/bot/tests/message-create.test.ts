import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleMessageCreateEvent,
  MessageResponseBuffer,
} from "../src/events/message-create";
import { ApiClientError } from "../src/runtime/errors";
import { createApiClientMock, createLoggerMock, createMessageMock } from "./helpers/fixtures";

afterEach(() => {
  vi.useRealTimers();
});

describe("message create event", () => {
  it.each([
    ["bot messages", { author: { bot: true } }],
    ["webhooks", { webhookId: "webhook-1" }],
    ["empty content", { content: "   " }],
  ])("ignores %s", async (_label, overrides) => {
    const apiClient = createApiClientMock();
    await handleMessageCreateEvent({ message: createMessageMock(overrides), apiClient, logger: createLoggerMock() });
    expect(apiClient.touchUser).not.toHaveBeenCalled();
    expect(apiClient.respondWithLlm).not.toHaveBeenCalled();
  });

  it("continues when user synchronization fails and maps guild mentions", async () => {
    const logger = createLoggerMock();
    const apiClient = createApiClientMock({ touchUser: vi.fn().mockRejectedValue(new Error("sync failed")), respondWithLlm: vi.fn().mockResolvedValue({ shouldRespond: false }) });
    const message = createMessageMock({ mentions: { has: vi.fn().mockReturnValue(true) } });
    await handleMessageCreateEvent({ message, apiClient, logger });
    expect(apiClient.respondWithLlm).toHaveBeenCalledWith(expect.objectContaining({ guildId: "guild-1", channelId: "channel-1", botWasMentioned: true, isDm: false }));
    expect(logger.warn).toHaveBeenCalled();
  });

  it("maps direct messages without a guild", async () => {
    const apiClient = createApiClientMock();
    await handleMessageCreateEvent({ message: createMessageMock({ guildId: null }), apiClient, logger: createLoggerMock() });
    expect(apiClient.respondWithLlm).toHaveBeenCalledWith(expect.objectContaining({ guildId: undefined, isDm: true }));
  });

  it("splits responses into Discord-sized chunks", async () => {
    const apiClient = createApiClientMock({ respondWithLlm: vi.fn().mockResolvedValue({ shouldRespond: true, replyText: "x".repeat(4_001) }) });
    const message = createMessageMock();
    await handleMessageCreateEvent({ message, apiClient, logger: createLoggerMock() });
    const channelSend = (message.channel as unknown as { send: ReturnType<typeof vi.fn> }).send;
    expect(message.reply).not.toHaveBeenCalled();
    expect(channelSend).toHaveBeenNthCalledWith(1, { content: "x".repeat(2_000) });
    expect(channelSend).toHaveBeenNthCalledWith(2, { content: "x".repeat(2_000) });
    expect(channelSend).toHaveBeenNthCalledWith(3, { content: "x" });
  });

  it("silently logs expected denials and propagates unexpected failures", async () => {
    const deniedLogger = createLoggerMock();
    await handleMessageCreateEvent({
      message: createMessageMock(),
      apiClient: createApiClientMock({ respondWithLlm: vi.fn().mockRejectedValue(new ApiClientError(403, "Denied", "COMMAND_ACCESS_DENIED")) }),
      logger: deniedLogger,
    });
    expect(deniedLogger.debug).toHaveBeenCalled();
    expect(deniedLogger.warn).not.toHaveBeenCalled();

    const failedLogger = createLoggerMock();
    await expect(handleMessageCreateEvent({
      message: createMessageMock(),
      apiClient: createApiClientMock({
        respondWithLlm: vi.fn().mockRejectedValue(new Error("offline")),
      }),
      logger: failedLogger,
    })).rejects.toThrow("offline");
    expect(failedLogger.warn).toHaveBeenCalled();
  });
});

describe("message response buffer", () => {
  it("waits four seconds after the latest channel message", async () => {
    vi.useFakeTimers();
    const apiClient = createApiClientMock();
    const buffer = new MessageResponseBuffer(apiClient, createLoggerMock());

    await buffer.enqueue(createMessageMock({ id: "1", content: "First part" }));
    await vi.advanceTimersByTimeAsync(3_000);
    await buffer.enqueue(createMessageMock({ id: "2", content: "Second part" }));
    await vi.advanceTimersByTimeAsync(3_999);
    expect(apiClient.respondWithLlm).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(apiClient.respondWithLlm).toHaveBeenCalledTimes(1);
    expect(apiClient.respondWithLlm).toHaveBeenCalledWith(expect.objectContaining({
      content: "Second part",
      messageId: "2",
      contextMessages: [{
        discordUserId: "user-1",
        content: "First part",
        messageId: "1",
      }],
    }));
  });

  it("orders buffered messages by Discord snowflake before processing", async () => {
    vi.useFakeTimers();
    const apiClient = createApiClientMock();
    const buffer = new MessageResponseBuffer(apiClient, createLoggerMock());

    await buffer.enqueue(createMessageMock({ id: "2", content: "Newer message" }));
    await buffer.enqueue(createMessageMock({ id: "1", content: "Older message" }));
    await vi.advanceTimersByTimeAsync(4_000);

    expect(apiClient.respondWithLlm).toHaveBeenCalledWith(expect.objectContaining({
      content: "Newer message",
      messageId: "2",
      contextMessages: [{
        discordUserId: "user-1",
        content: "Older message",
        messageId: "1",
      }],
    }));
  });

  it("flushes after ten seconds even while messages continue arriving", async () => {
    vi.useFakeTimers();
    const apiClient = createApiClientMock();
    const buffer = new MessageResponseBuffer(apiClient, createLoggerMock());

    await buffer.enqueue(createMessageMock({ id: "1", content: "Part 1" }));
    await vi.advanceTimersByTimeAsync(3_000);
    await buffer.enqueue(createMessageMock({ id: "2", content: "Part 2" }));
    await vi.advanceTimersByTimeAsync(3_000);
    await buffer.enqueue(createMessageMock({ id: "3", content: "Part 3" }));
    await vi.advanceTimersByTimeAsync(3_000);
    await buffer.enqueue(createMessageMock({ id: "4", content: "Part 4" }));
    await vi.advanceTimersByTimeAsync(999);
    expect(apiClient.respondWithLlm).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(apiClient.respondWithLlm).toHaveBeenCalledTimes(1);
    expect(apiClient.respondWithLlm).toHaveBeenCalledWith(expect.objectContaining({
      content: "Part 4",
      contextMessages: expect.arrayContaining([
        expect.objectContaining({ content: "Part 1" }),
        expect.objectContaining({ content: "Part 2" }),
        expect.objectContaining({ content: "Part 3" }),
      ]),
    }));
  });

  it("flushes buffered channel messages immediately when the bot is mentioned", async () => {
    vi.useFakeTimers();
    const apiClient = createApiClientMock();
    const buffer = new MessageResponseBuffer(apiClient, createLoggerMock());

    await buffer.enqueue(createMessageMock({ id: "1", content: "Background" }));
    await buffer.enqueue(createMessageMock({
      id: "2",
      content: "<@bot-1> what do you think?",
      mentions: { has: vi.fn().mockReturnValue(true) },
    }));

    expect(apiClient.respondWithLlm).toHaveBeenCalledTimes(1);
    expect(apiClient.respondWithLlm).toHaveBeenCalledWith(expect.objectContaining({
      botWasMentioned: true,
      content: "<@bot-1> what do you think?",
      contextMessages: [expect.objectContaining({ content: "Background" })],
    }));
  });

  it("processes direct messages immediately without buffering", async () => {
    vi.useFakeTimers();
    const apiClient = createApiClientMock();
    const buffer = new MessageResponseBuffer(apiClient, createLoggerMock());

    await buffer.enqueue(createMessageMock({ guildId: null, content: "Hello in DM" }));

    expect(apiClient.respondWithLlm).toHaveBeenCalledTimes(1);
    expect(apiClient.respondWithLlm).toHaveBeenCalledWith(expect.objectContaining({
      guildId: undefined,
      isDm: true,
      content: "Hello in DM",
      contextMessages: [],
    }));
  });

  it("rejects every buffered receipt waiter when batch processing fails", async () => {
    vi.useFakeTimers();
    const apiClient = createApiClientMock({
      respondWithLlm: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const buffer = new MessageResponseBuffer(apiClient, createLoggerMock());

    const first = buffer.enqueueAndWait(
      createMessageMock({ id: "1", content: "First part" }),
    );
    const second = buffer.enqueueAndWait(
      createMessageMock({
        id: "2",
        content: "<@bot-1> second part",
        mentions: { has: vi.fn().mockReturnValue(true) },
      }),
    );

    await expect(first).rejects.toThrow("offline");
    await expect(second).rejects.toThrow("offline");
  });
});
