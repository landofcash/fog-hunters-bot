import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { ApiClient } from "../../api/client";
import { ApiClientError } from "../../runtime/errors";

export async function handleSettingsViewCommand(
  apiClient: ApiClient,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "This command can only be used in a server channel.",
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const settings = await apiClient.readGuildSettings({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      channelId: interaction.channelId ?? undefined,
      commandKey: "settings.view",
    });

    const message = [
      `Bot: **${settings.bot.displayName}**`,
      `Presence: **${settings.guild.presenceStatus.toLowerCase()}**`,
      `Operational status: **${settings.guild.operationalStatus.toLowerCase()}**`,
      `AI guild preference: **${settings.settings.llmEnabledByGuild ? "enabled" : "disabled"}**`,
      `AI platform access: **${settings.settings.llmEnabledByPlatform ? "enabled" : "suspended"}**`,
    ].join("\n");

    await interaction.editReply({ content: message });
  } catch (error) {
    if (error instanceof ApiClientError && error.statusCode === 403) {
      await interaction.editReply({
        content: "You do not have permission to view settings in this server.",
      });
      return;
    }
    if (error instanceof ApiClientError && error.statusCode === 404) {
      await interaction.editReply({
        content: "This server is not onboarded yet. Ask an admin to re-invite the bot.",
      });
      return;
    }

    await interaction.editReply({
      content: "Failed to read settings right now. Try again in a moment.",
    });
  }
}
