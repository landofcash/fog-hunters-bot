import { describe, expect, it, vi } from "vitest";
import { handleMessageCreateEvent } from "../src/events/message-create";
import { ApiClientError } from "../src/runtime/errors";
import { createApiClientMock, createLoggerMock, createMessageMock } from "./helpers/fixtures";

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
    expect(message.reply).toHaveBeenCalledWith({ content: "x".repeat(2_000) });
    expect(channelSend).toHaveBeenNthCalledWith(1, { content: "x".repeat(2_000) });
    expect(channelSend).toHaveBeenNthCalledWith(2, { content: "x" });
  });

  it("silently logs expected denials and warns for unexpected failures", async () => {
    const deniedLogger = createLoggerMock();
    await handleMessageCreateEvent({
      message: createMessageMock(),
      apiClient: createApiClientMock({ respondWithLlm: vi.fn().mockRejectedValue(new ApiClientError(403, "Denied", "COMMAND_ACCESS_DENIED")) }),
      logger: deniedLogger,
    });
    expect(deniedLogger.debug).toHaveBeenCalled();
    expect(deniedLogger.warn).not.toHaveBeenCalled();

    const failedLogger = createLoggerMock();
    await handleMessageCreateEvent({ message: createMessageMock(), apiClient: createApiClientMock({ respondWithLlm: vi.fn().mockRejectedValue(new Error("offline")) }), logger: failedLogger });
    expect(failedLogger.warn).toHaveBeenCalled();
  });
});
