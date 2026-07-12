import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import { handleAiCommand } from "../commands/protected/ai";
import { handleSettingsViewCommand } from "../commands/protected/settings-view";
import { handleHelpCommand } from "../commands/public/help";
import { handlePingCommand } from "../commands/public/ping";

export async function routeCommand(input: {
  interaction: ChatInputCommandInteraction;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { interaction, apiClient, logger } = input;
  switch (interaction.commandName) {
    case "ping":
      await handlePingCommand(interaction);
      return;
    case "help":
      await handleHelpCommand(interaction);
      return;
    case "settings": {
      const sub = interaction.options.getSubcommand(false);
      if (sub === "view") {
        await handleSettingsViewCommand(apiClient, interaction);
        return;
      }
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Unsupported settings command.",
      });
      return;
    }
    case "ai":
      await handleAiCommand(apiClient, interaction);
      return;
    default:
      logger.warn({ command: interaction.commandName }, "Unknown command received");
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Unknown command.",
      });
  }
}
