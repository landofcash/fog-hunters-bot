import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { ApiClient } from "../../api/client";
import { ApiClientError } from "../../runtime/errors";
import { isSupportedAiModel } from "./ai-models";

interface AccessDeniedDetails {
  reason?: string;
  commandKey?: string;
}

type PromptType = "assistant" | "gatekeeper";

function parsePromptType(value: string | null): PromptType | null {
  return value === "assistant" || value === "gatekeeper" ? value : null;
}

function configuredPrompt(
  settings: {
    assistantPrompt?: string | null;
    gatekeeperPrompt?: string | null;
  },
  type: PromptType,
): string | null {
  return type === "assistant"
    ? settings.assistantPrompt ?? null
    : settings.gatekeeperPrompt ?? null;
}

function effectivePrompt(
  prompts: { assistant: string; gatekeeper: string },
  type: PromptType,
): string {
  return type === "assistant" ? prompts.assistant : prompts.gatekeeper;
}

function promptFilename(type: PromptType): string {
  return `${type}-prompt.txt`;
}

function promptLabel(type: PromptType): string {
  return type === "assistant" ? "Assistant" : "Gatekeeper";
}

function getAccessDeniedDetails(error: ApiClientError): AccessDeniedDetails | null {
  if (!error.details || typeof error.details !== "object") {
    return null;
  }
  const details = error.details as Record<string, unknown>;
  return {
    reason: typeof details.reason === "string" ? details.reason : undefined,
    commandKey: typeof details.commandKey === "string" ? details.commandKey : undefined,
  };
}

async function handleStatus(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai` commands are only available in servers.",
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await apiClient.readLlmGuildSettings({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
    commandKey: "ai.status",
  });

  const lines = [
    `Guild: **${result.guild.name}**`,
    `AI enabled: **${result.settings.enabled ? "yes" : "no"}**`,
    `Model: **${result.settings.defaultModel}**`,
    `Retention: **${result.settings.retentionDays} days**`,
    `DM enabled: **${result.settings.dmEnabled ? "yes" : "no"}**`,
    `Max input chars: **${result.settings.maxInputChars}**`,
    `Max output tokens: **${result.settings.maxOutputTokens}**`,
  ];

  await interaction.editReply({ content: lines.join("\n") });
}

async function handleEnable(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  const channel = interaction.options.getChannel("channel", true);
  const mentionOnly = interaction.options.getBoolean("mention_only") ?? false;

  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai enable` can only be used in servers.",
    });
    return;
  }

  await apiClient.enableLlmChannel({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: channel.id,
    respondOnMentionOnly: mentionOnly,
    commandKey: "ai.enable",
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Enabled AI responses for <#${channel.id}>${mentionOnly ? " (mention-only mode)." : "."}`,
  });
}

async function handleModel(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai model` can only be used in servers.",
    });
    return;
  }

  const model = interaction.options.getString("name", true);
  if (!isSupportedAiModel(model)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Unsupported AI model selection.",
    });
    return;
  }

  const updated = await apiClient.patchLlmGuildSettings({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
    commandKey: "ai.model",
    patch: {
      defaultModel: model,
    },
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Set this server's AI model to **${updated.settings.defaultModel}**.`,
  });
}

async function handleDisable(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  const channel = interaction.options.getChannel("channel", true);

  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai disable` can only be used in servers.",
    });
    return;
  }

  await apiClient.disableLlmChannel({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: channel.id,
    commandKey: "ai.disable",
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Disabled AI responses for <#${channel.id}>.`,
  });
}

async function handlePromptView(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai prompt view` can only be used in servers.",
    });
    return;
  }

  const requestedTypeValue = interaction.options.getString("type");
  const requestedType = requestedTypeValue ? parsePromptType(requestedTypeValue) : null;
  if (requestedTypeValue && !requestedType) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Unsupported prompt type.",
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await apiClient.readLlmGuildSettings({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
    commandKey: "ai.prompt.view",
  });

  const types: PromptType[] = requestedType
    ? [requestedType]
    : ["assistant", "gatekeeper"];
  const entries = types.map((type) => ({
    type,
    configured: configuredPrompt(result.settings, type) !== null,
    prompt: effectivePrompt(result.effectivePrompts, type),
  }));
  const summary = entries
    .map((entry) => `${promptLabel(entry.type)}: **${entry.configured ? "custom" : "default"}** (${entry.prompt.length} characters)`)
    .join("\n");
  const inlineSections = entries.map((entry) => [
    `**${promptLabel(entry.type)} prompt**`,
    "```text",
    entry.prompt.replaceAll("```", "`\u200b``"),
    "```",
  ].join("\n"));
  const inlineContent = [summary, ...inlineSections].join("\n\n");

  if (entries.every((entry) => entry.prompt.length <= 1_500) && inlineContent.length <= 1_900) {
    await interaction.editReply({
      content: inlineContent,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.editReply({
    content: `${summary}\n\nThe effective prompt text is attached.`,
    files: entries.map((entry) => ({
      attachment: Buffer.from(entry.prompt, "utf8"),
      name: promptFilename(entry.type),
    })),
    allowedMentions: { parse: [] },
  });
}

async function handlePromptSet(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai prompt set` can only be used in servers.",
    });
    return;
  }

  const type = parsePromptType(interaction.options.getString("type", true));
  const prompt = interaction.options.getString("text", true);
  if (!type) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Unsupported prompt type.",
    });
    return;
  }
  if (!prompt.trim() || prompt.length > 6_000) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Prompt text must contain 1 to 6,000 characters.",
    });
    return;
  }

  await apiClient.patchLlmGuildSettings({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
    commandKey: "ai.prompt.set",
    patch: type === "assistant"
      ? { assistantPrompt: prompt }
      : { gatekeeperPrompt: prompt },
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Set this server's **${type}** prompt (${prompt.length} characters). Existing channel memory was kept.`,
  });
}

async function handlePromptReset(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai prompt reset` can only be used in servers.",
    });
    return;
  }

  const type = parsePromptType(interaction.options.getString("type", true));
  if (!type) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Unsupported prompt type.",
    });
    return;
  }

  await apiClient.patchLlmGuildSettings({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
    commandKey: "ai.prompt.reset",
    patch: type === "assistant"
      ? { assistantPrompt: null }
      : { gatekeeperPrompt: null },
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Reset this server's **${type}** prompt to the default. Existing channel memory was kept.`,
  });
}

async function handleRetention(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai retention` can only be used in servers.",
    });
    return;
  }

  const days = interaction.options.getInteger("days", true);

  await apiClient.patchLlmGuildSettings({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
    commandKey: "ai.retention",
    patch: {
      retentionDays: days,
    },
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Set AI memory retention to **${days} days**.`,
  });
}

async function handleMemoryClear(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  const channel = interaction.options.getChannel("channel", true);

  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai memory clear` can only be used in servers.",
    });
    return;
  }

  const result = await apiClient.clearLlmChannelMemory({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: channel.id,
    commandKey: "ai.memory.clear",
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Cleared memory for <#${channel.id}> (conversations: ${result.deletedConversations}, messages: ${result.deletedMessages}).`,
  });
}

export async function handleAiCommand(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(false);
  const group = interaction.options.getSubcommandGroup(false);

  try {
    if (group === "prompt") {
      switch (sub) {
        case "view":
          await handlePromptView(apiClient, interaction);
          return;
        case "set":
          await handlePromptSet(apiClient, interaction);
          return;
        case "reset":
          await handlePromptReset(apiClient, interaction);
          return;
        default:
          await interaction.reply({
            flags: MessageFlags.Ephemeral,
            content: "Unsupported AI prompt command.",
          });
          return;
      }
    }

    switch (sub) {
      case "status":
        await handleStatus(apiClient, interaction);
        return;
      case "model":
        await handleModel(apiClient, interaction);
        return;
      case "enable":
        await handleEnable(apiClient, interaction);
        return;
      case "disable":
        await handleDisable(apiClient, interaction);
        return;
      case "retention":
        await handleRetention(apiClient, interaction);
        return;
      case "memory-clear":
        await handleMemoryClear(apiClient, interaction);
        return;
      default:
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: "Unsupported AI command.",
        });
    }
  } catch (error) {
    if (error instanceof ApiClientError && error.statusCode === 403) {
      const denied = getAccessDeniedDetails(error);
      const reason = denied?.reason ?? "UNKNOWN";
      const commandKey = denied?.commandKey ? ` (${denied.commandKey})` : "";
      const content = `You do not have permission for this AI admin command${commandKey}. Reason: ${reason}.`;
      if (interaction.deferred) {
        await interaction.editReply({ content });
        return;
      }
      if (!interaction.replied) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content });
      }
      return;
    }

    if (interaction.deferred) {
      await interaction.editReply({ content: "Failed to execute AI command." });
      return;
    }

    if (!interaction.replied) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Failed to execute AI command.",
      });
    }
  }
}
