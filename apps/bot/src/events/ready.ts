import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import type { BotConfig } from "../config";
import { registerGuildCommands } from "../discord/register-commands";

export async function handleReadyEvent(input: {
  client: Client<true>;
  config: BotConfig;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { client, config, apiClient, logger } = input;
  logger.info({ botUserId: client.user.id, botTag: client.user.tag }, "Discord bot connected");

  // Bootstrap guild rows for servers where the bot already exists.
  for (const guild of client.guilds.cache.values()) {
    try {
      let owner:
        | {
            discordUserId: string;
            username: string;
            globalName?: string | null;
            avatarUrl?: string | null;
          }
        | undefined;

      try {
        const ownerMember = await guild.fetchOwner();
        owner = {
          discordUserId: ownerMember.user.id,
          username: ownerMember.user.username,
          globalName: ownerMember.user.globalName ?? null,
          avatarUrl: ownerMember.user.displayAvatarURL() ?? null,
        };
      } catch (ownerError) {
        logger.warn({ err: ownerError, guildId: guild.id }, "Failed to resolve owner during ready bootstrap");
      }

      await apiClient.bootstrapGuild(guild.id, {
        guildName: guild.name,
        owner,
      });
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Failed to bootstrap guild during startup");
    }
  }

  if (!config.commandSyncOnStart) {
    logger.info("Command sync on start disabled");
    return;
  }

  const guildIds =
    config.discordGuildIds.length > 0
      ? config.discordGuildIds
      : Array.from(client.guilds.cache.keys());

  for (const guildId of guildIds) {
    try {
      await registerGuildCommands({
        botToken: config.discordBotToken,
        clientId: config.discordClientId,
        guildId,
        logger,
      });
    } catch (error) {
      logger.error({ err: error, guildId }, "Failed to synchronize commands for guild");
    }
  }
}
