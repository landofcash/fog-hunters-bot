import type { ChatInputCommandInteraction, Message } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";

export async function touchUserFromInteraction(
  apiClient: ApiClient,
  interaction: ChatInputCommandInteraction,
  logger: Logger,
): Promise<void> {
  try {
    await apiClient.touchUser({
      discordUserId: interaction.user.id,
      username: interaction.user.username,
      globalName: interaction.user.globalName ?? null,
      avatarUrl: interaction.user.displayAvatarURL() ?? null,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        discordUserId: interaction.user.id,
        command: interaction.commandName,
      },
      "User touch failed; continuing command flow",
    );
  }
}

export async function touchUserFromMessage(
  apiClient: ApiClient,
  message: Message,
  logger: Logger,
): Promise<void> {
  try {
    await apiClient.touchUser({
      discordUserId: message.author.id,
      username: message.author.username,
      globalName: message.author.globalName ?? null,
      avatarUrl: message.author.displayAvatarURL() ?? null,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        discordUserId: message.author.id,
        guildId: message.guildId,
      },
      "User touch failed for message event; continuing",
    );
  }
}
