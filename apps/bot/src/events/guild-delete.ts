import type { Guild } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";

export async function handleGuildDeleteEvent(input: {
  guild: Guild;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { guild, apiClient, logger } = input;
  if (!guild.available) {
    logger.info(
      { guildId: guild.id },
      "Guild delete event is an outage signal; preserving installation presence",
    );
    return;
  }

  await apiClient.markGuildLeft(guild.id);
  logger.info({ guildId: guild.id }, "Bot installation marked as left");
}
