import { describe, expect, it, vi } from "vitest";
import { handleInteractionCreateEvent } from "../src/events/interaction-create";
import { asInteraction, createApiClientMock, createInteractionMock, createLoggerMock } from "./helpers/fixtures";

describe("interaction create event", () => {
  it("ignores interactions that are not chat commands", async () => {
    const interaction = createInteractionMock({ isChatInputCommand: vi.fn().mockReturnValue(false) });
    const apiClient = createApiClientMock();
    await handleInteractionCreateEvent({ interaction: asInteraction(interaction), apiClient, logger: createLoggerMock() });
    expect(apiClient.touchUser).not.toHaveBeenCalled();
  });

  it("continues command routing after user synchronization fails", async () => {
    const logger = createLoggerMock();
    const interaction = createInteractionMock({ commandName: "ping" });
    const apiClient = createApiClientMock({ touchUser: vi.fn().mockRejectedValue(new Error("sync failed")) });
    await handleInteractionCreateEvent({ interaction: asInteraction(interaction), apiClient, logger });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/^Pong!/) }));
    expect(logger.warn).toHaveBeenCalled();
  });

  it("replies with a recovery message when routing fails before a reply", async () => {
    const interaction = createInteractionMock({
      commandName: "ping",
      reply: vi.fn().mockRejectedValueOnce(new Error("Discord failed")).mockResolvedValueOnce(undefined),
    });
    const logger = createLoggerMock();
    await handleInteractionCreateEvent({ interaction: asInteraction(interaction), apiClient: createApiClientMock(), logger });
    expect(logger.error).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining("unexpected error") }));
  });

  it("edits a deferred interaction when routing fails", async () => {
    const interaction = createInteractionMock({
      commandName: "unknown",
      deferred: true,
      reply: vi.fn().mockRejectedValue(new Error("cannot reply")),
    });
    await handleInteractionCreateEvent({ interaction: asInteraction(interaction), apiClient: createApiClientMock(), logger: createLoggerMock() });
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining("unexpected error") });
  });
});
