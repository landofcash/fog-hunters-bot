import { describe, expect, it, vi } from "vitest";
import { handleAiCommand } from "../src/commands/protected/ai";
import { handleSettingsAdminCommand } from "../src/commands/protected/settings-admin";
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

  it("adds and removes admins through owner-only API operations", async () => {
    const targetUser = {
      id: "target-1",
      username: "target",
      globalName: "Target",
      bot: false,
      displayAvatarURL: vi.fn().mockReturnValue("https://avatar.test/target.png"),
    };
    const addGuildAdmin = vi.fn().mockResolvedValue({
      changed: true,
      membership: { tenantRole: "ADMIN" },
    });
    const removeGuildAdmin = vi.fn().mockResolvedValue({
      changed: true,
      membership: { tenantRole: "USER" },
    });
    const apiClient = createApiClientMock({ addGuildAdmin, removeGuildAdmin });

    for (const [subcommand, method] of [
      ["add", addGuildAdmin],
      ["remove", removeGuildAdmin],
    ] as const) {
      const interaction = createInteractionMock({
        commandName: "settings",
        options: {
          getSubcommand: vi.fn().mockReturnValue(subcommand),
          getSubcommandGroup: vi.fn().mockReturnValue("admin"),
          getUser: vi.fn().mockReturnValue(targetUser),
        },
      });

      await handleSettingsAdminCommand(apiClient, interaction);

      expect(method).toHaveBeenCalledWith({
        guildId: "guild-1",
        actorDiscordUserId: "user-1",
        channelId: "channel-1",
        target: {
          discordUserId: "target-1",
          username: "target",
          globalName: "Target",
          avatarUrl: "https://avatar.test/target.png",
        },
      });
      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining("<@target-1>"),
        allowedMentions: { users: [] },
      }));
    }
  });

  it("lists owners and admins without pinging them", async () => {
    const listGuildAdmins = vi.fn().mockResolvedValue({
      owners: [{ discordUserId: "owner-1" }],
      admins: [{ discordUserId: "admin-1" }],
    });
    const interaction = createInteractionMock({
      commandName: "settings",
      options: {
        getSubcommand: vi.fn().mockReturnValue("list"),
        getSubcommandGroup: vi.fn().mockReturnValue("admin"),
      },
    });

    await handleSettingsAdminCommand(createApiClientMock({ listGuildAdmins }), interaction);

    expect(listGuildAdmins).toHaveBeenCalledWith({
      guildId: "guild-1",
      actorDiscordUserId: "user-1",
      channelId: "channel-1",
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("<@admin-1>"),
      allowedMentions: { users: [] },
    });
  });

  it("rejects bot targets and maps owner-only errors", async () => {
    const botTarget = createInteractionMock({
      commandName: "settings",
      options: {
        getSubcommand: vi.fn().mockReturnValue("add"),
        getSubcommandGroup: vi.fn().mockReturnValue("admin"),
        getUser: vi.fn().mockReturnValue({
          id: "bot-1",
          username: "bot",
          bot: true,
          displayAvatarURL: vi.fn().mockReturnValue(null),
        }),
      },
    });
    const addGuildAdmin = vi.fn();
    await handleSettingsAdminCommand(createApiClientMock({ addGuildAdmin }), botTarget);
    expect(addGuildAdmin).not.toHaveBeenCalled();
    expect(botTarget.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("Bot accounts"),
    }));

    const denied = createInteractionMock({
      commandName: "settings",
      options: {
        getSubcommand: vi.fn().mockReturnValue("remove"),
        getSubcommandGroup: vi.fn().mockReturnValue("admin"),
        getUser: vi.fn().mockReturnValue({
          id: "target-1",
          username: "target",
          globalName: null,
          bot: false,
          displayAvatarURL: vi.fn().mockReturnValue(null),
        }),
      },
    });
    await handleSettingsAdminCommand(createApiClientMock({
      removeGuildAdmin: vi.fn().mockRejectedValue(new ApiClientError(403, "Owner required", "OWNER_REQUIRED")),
    }), denied);
    expect(denied.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("Only the server owner"),
    });
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

  it("maps retention settings", async () => {
    const patch = vi.fn().mockResolvedValue({ settings: { defaultModel: "model" } });
    const apiClient = createApiClientMock({ patchLlmGuildSettings: patch });
    const retention = aiInteraction("retention", { getInteger: vi.fn().mockReturnValue(45) });
    await handleAiCommand(apiClient, retention);
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ commandKey: "ai.retention", patch: { retentionDays: 45 } }));
  });

  it.each([
    ["assistant", { assistantPrompt: "Custom assistant" }],
    ["gatekeeper", { gatekeeperPrompt: "Custom gatekeeper" }],
  ] as const)("sets the %s prompt without clearing memory", async (type, expectedPatch) => {
    const patch = vi.fn().mockResolvedValue({
      settings: {
        assistantPrompt: type === "assistant" ? "Custom assistant" : null,
        gatekeeperPrompt: type === "gatekeeper" ? "Custom gatekeeper" : null,
      },
    });
    const apiClient = createApiClientMock({ patchLlmGuildSettings: patch });
    const interaction = aiInteraction("set", {
      getSubcommandGroup: vi.fn().mockReturnValue("prompt"),
      getString: vi.fn((name: string) => name === "type" ? type : `Custom ${type}`),
    });

    await handleAiCommand(apiClient, interaction);

    expect(patch).toHaveBeenCalledWith(expect.objectContaining({
      commandKey: "ai.prompt.set",
      patch: expectedPatch,
    }));
    expect(apiClient.clearLlmChannelMemory).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("Existing channel memory was kept"),
    }));
  });

  it.each(["assistant", "gatekeeper"] as const)("resets the %s prompt", async (type) => {
    const patch = vi.fn().mockResolvedValue({ settings: {} });
    const apiClient = createApiClientMock({ patchLlmGuildSettings: patch });
    const interaction = aiInteraction("reset", {
      getSubcommandGroup: vi.fn().mockReturnValue("prompt"),
      getString: vi.fn((name: string) => name === "type" ? type : null),
    });

    await handleAiCommand(apiClient, interaction);

    expect(patch).toHaveBeenCalledWith(expect.objectContaining({
      commandKey: "ai.prompt.reset",
      patch: type === "assistant" ? { assistantPrompt: null } : { gatekeeperPrompt: null },
    }));
  });

  it("views short effective prompts inline and attaches long prompts", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        guild: { name: "Guild" },
        settings: { assistantPrompt: null, gatekeeperPrompt: "Custom rules" },
        effectivePrompts: { assistant: "Default assistant", gatekeeper: "Fixed contract\nCustom rules" },
      })
      .mockResolvedValueOnce({
        guild: { name: "Guild" },
        settings: { assistantPrompt: "x".repeat(2_000), gatekeeperPrompt: null },
        effectivePrompts: { assistant: "x".repeat(2_000), gatekeeper: "Default gatekeeper" },
      });
    const apiClient = createApiClientMock({ readLlmGuildSettings: read });

    const short = aiInteraction("view", {
      getSubcommandGroup: vi.fn().mockReturnValue("prompt"),
      getString: vi.fn().mockReturnValue("gatekeeper"),
    });
    await handleAiCommand(apiClient, short);
    expect(short.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("Fixed contract"),
    }));

    const long = aiInteraction("view", {
      getSubcommandGroup: vi.fn().mockReturnValue("prompt"),
      getString: vi.fn().mockReturnValue("assistant"),
    });
    await handleAiCommand(apiClient, long);
    expect(long.editReply).toHaveBeenCalledWith(expect.objectContaining({
      files: [expect.objectContaining({ name: "assistant-prompt.txt" })],
    }));
  });

  it("rejects blank or oversized Discord prompt text", async () => {
    for (const prompt of ["   ", "x".repeat(6_001)]) {
      const patch = vi.fn();
      const apiClient = createApiClientMock({ patchLlmGuildSettings: patch });
      const interaction = aiInteraction("set", {
        getSubcommandGroup: vi.fn().mockReturnValue("prompt"),
        getString: vi.fn((name: string) => name === "type" ? "assistant" : prompt),
      });

      await handleAiCommand(apiClient, interaction);

      expect(patch).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining("1 to 6,000"),
      }));
    }
  });

  it("updates the selected AI model", async () => {
    const patch = vi.fn().mockResolvedValue({ settings: { defaultModel: "gpt-5.6-terra" } });
    const apiClient = createApiClientMock({ patchLlmGuildSettings: patch });
    const interaction = aiInteraction("model", {
      getString: vi.fn((name: string) => name === "name" ? "gpt-5.6-terra" : null),
    });

    await handleAiCommand(apiClient, interaction);

    expect(patch).toHaveBeenCalledWith({
      guildId: "guild-1",
      actorDiscordUserId: "user-1",
      channelId: "channel-1",
      commandKey: "ai.model",
      patch: { defaultModel: "gpt-5.6-terra" },
    });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: "Set this server's AI model to **gpt-5.6-terra**.",
    }));
  });

  it("rejects AI models outside the Discord choice list", async () => {
    const patch = vi.fn();
    const apiClient = createApiClientMock({ patchLlmGuildSettings: patch });
    const interaction = aiInteraction("model", {
      getString: vi.fn((name: string) => name === "name" ? "unknown-model" : null),
    });

    await handleAiCommand(apiClient, interaction);

    expect(patch).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: "Unsupported AI model selection.",
    }));
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
