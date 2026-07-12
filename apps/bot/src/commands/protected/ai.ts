import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { ApiClient } from "../../api/client";
import { ApiClientError } from "../../runtime/errors";

interface AccessDeniedDetails {
  reason?: string;
  commandKey?: string;
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

async function handleStyle(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "`/ai style` can only be used in servers.",
    });
    return;
  }

  const mode = interaction.options.getString("mode", true);
  const promptOverride = interaction.options.getString("prompt");

  const modePromptMap: Record<string, string> = {
    casual: "Use short, conversational responses with light humor when appropriate.",
    strict: "Respond with factual, concise answers and avoid speculative language.",
    custom: promptOverride ?? "",
  };

  const stylePrompt = mode === "custom" ? promptOverride ?? null : modePromptMap[mode];

  const updated = await apiClient.patchLlmGuildSettings({
    guildId,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
    commandKey: "ai.style",
    patch: {
      stylePrompt,
    },
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Updated style prompt. Current model: **${updated.settings.defaultModel}**.`,
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

  try {
    switch (sub) {
      case "status":
        await handleStatus(apiClient, interaction);
        return;
      case "enable":
        await handleEnable(apiClient, interaction);
        return;
      case "disable":
        await handleDisable(apiClient, interaction);
        return;
      case "style":
        await handleStyle(apiClient, interaction);
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
