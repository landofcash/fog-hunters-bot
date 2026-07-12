import { MessageFlags, type Interaction } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import { routeCommand } from "../runtime/command-router";
import { touchUserFromInteraction } from "../runtime/user-touch";

export async function handleInteractionCreateEvent(input: {
  interaction: Interaction;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { interaction, apiClient, logger } = input;
  if (!interaction.isChatInputCommand()) {
    return;
  }

  await touchUserFromInteraction(apiClient, interaction, logger);

  try {
    await routeCommand({
      interaction,
      apiClient,
      logger,
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        guildId: interaction.guildId,
        discordUserId: interaction.user.id,
        command: interaction.commandName,
      },
      "Command handling failed",
    );

    if (interaction.deferred) {
      await interaction.editReply({
        content: "An unexpected error occurred while handling your command.",
      });
      return;
    }

    if (!interaction.replied) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "An unexpected error occurred while handling your command.",
      });
    }
  }
}
