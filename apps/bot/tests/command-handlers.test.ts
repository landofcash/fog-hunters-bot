import { describe, expect, it, vi } from "vitest";
import { handleAiCommand } from "../src/commands/protected/ai";
import { handleSettingsViewCommand } from "../src/commands/protected/settings-view";
import { ApiClientError } from "../src/runtime/errors";
import { createApiClientMock, createInteractionMock } from "./helpers/fixtures";

function aiInteraction(subcommand: string, optionOverrides: Record<string, unknown> = {}) {
  const interaction = createInteractionMock();
  const baseOptions = interaction.options;
  return createInteractionMock({
    options: {
      ...baseOptions,
      getSubcommand: vi.fn().mockReturnValue(subcommand),
      ...optionOverrides,
    },
  });
}

describe("protected command handlers", () => {
  it("renders settings summaries and maps access errors", async () => {
    const successClient = createApiClientMock({
      readGuildSettings: vi.fn().mockResolvedValue({
        guild: { name: "Guild" },
        features: [{ enabled: true }, { enabled: false }],
        commands: [{ commandKey: "settings.view" }],
      }),
    });
    const success = createInteractionMock({ commandName: "settings" });
    await handleSettingsViewCommand(successClient, success);
    expect(success.editReply).toHaveBeenCalledWith({ content: expect.stringContaining("Features: **1/2**") });

    for (const [statusCode, message] of [
      [403, "do not have permission"],
      [404, "not onboarded"],
      [500, "Failed to read settings"],
    ] as const) {
      const interaction = createInteractionMock({ commandName: "settings" });
      const client = createApiClientMock({ readGuildSettings: vi.fn().mockRejectedValue(new ApiClientError(statusCode, "failed")) });
      await handleSettingsViewCommand(client, interaction);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining(message) });
    }
  });

  it("rejects protected commands in direct messages", async () => {
    const interaction = aiInteraction("status");
    Object.assign(interaction, { guildId: null });
    const apiClient = createApiClientMock();
    await handleAiCommand(apiClient, interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("only available in servers") }));
    expect(apiClient.readLlmGuildSettings).not.toHaveBeenCalled();
  });

  it("renders AI status", async () => {
    const apiClient = createApiClientMock({
      readLlmGuildSettings: vi.fn().mockResolvedValue({
        guild: { name: "Guild" },
        settings: { enabled: true, defaultModel: "model", retentionDays: 30, dmEnabled: true, maxInputChars: 4000, maxOutputTokens: 256 },
      }),
    });
    const interaction = aiInteraction("status");
    await handleAiCommand(apiClient, interaction);
    expect(apiClient.readLlmGuildSettings).toHaveBeenCalledWith(expect.objectContaining({ commandKey: "ai.status" }));
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining("Model: **model**") });
  });

  it.each([
    ["enable", "enableLlmChannel", "ai.enable"],
    ["disable", "disableLlmChannel", "ai.disable"],
    ["memory-clear", "clearLlmChannelMemory", "ai.memory.clear"],
  ] as const)("maps the %s subcommand", async (subcommand, method, commandKey) => {
    const implementation = method === "clearLlmChannelMemory"
      ? vi.fn().mockResolvedValue({ deletedConversations: 1, deletedMessages: 2 })
      : vi.fn().mockResolvedValue(undefined);
    const apiClient = createApiClientMock({ [method]: implementation });
    const interaction = aiInteraction(subcommand);
    await handleAiCommand(apiClient, interaction);
    expect(implementation).toHaveBeenCalledWith(expect.objectContaining({ guildId: "guild-1", channelId: "channel-1", commandKey }));
    expect(interaction.reply).toHaveBeenCalled();
  });

  it("maps style and retention settings", async () => {
    const patch = vi.fn().mockResolvedValue({ settings: { defaultModel: "model" } });
    const apiClient = createApiClientMock({ patchLlmGuildSettings: patch });
    const style = aiInteraction("style", {
      getString: vi.fn((name: string) => name === "mode" ? "strict" : null),
    });
    await handleAiCommand(apiClient, style);
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ commandKey: "ai.style", patch: { stylePrompt: expect.stringContaining("factual") } }));

    const retention = aiInteraction("retention", { getInteger: vi.fn().mockReturnValue(45) });
    await handleAiCommand(apiClient, retention);
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ commandKey: "ai.retention", patch: { retentionDays: 45 } }));
  });

  it("renders permission details and generic failures", async () => {
    const denied = aiInteraction("enable");
    await handleAiCommand(createApiClientMock({
      enableLlmChannel: vi.fn().mockRejectedValue(new ApiClientError(403, "Denied", "COMMAND_ACCESS_DENIED", { reason: "ROLE_TOO_LOW", commandKey: "ai.enable" })),
    }), denied);
    expect(denied.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("ROLE_TOO_LOW") }));

    const failed = aiInteraction("disable");
    await handleAiCommand(createApiClientMock({ disableLlmChannel: vi.fn().mockRejectedValue(new Error("offline")) }), failed);
    expect(failed.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Failed to execute AI command." }));
  });
});
