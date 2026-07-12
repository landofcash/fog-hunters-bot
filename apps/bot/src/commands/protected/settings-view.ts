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

    const enabledFeatures = settings.features.filter((feature) => feature.enabled).length;
    const message = [
      `Guild: **${settings.guild.name}**`,
      `Features: **${enabledFeatures}/${settings.features.length}** enabled`,
      `Command policies: **${settings.commands.length}**`,
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
