import type { Guild } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import type { BotConfig } from "../config";
import { registerGuildCommands } from "../discord/register-commands";

export async function handleGuildCreateEvent(input: {
  guild: Guild;
  apiClient: ApiClient;
  config: BotConfig;
  logger: Logger;
}): Promise<void> {
  const { guild, apiClient, config, logger } = input;

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
  } catch (error) {
    logger.warn({ err: error, guildId: guild.id }, "Failed to resolve guild owner during bootstrap");
  }

  await apiClient.bootstrapGuild(guild.id, {
    guildName: guild.name,
    owner,
  });

  await registerGuildCommands({
    botToken: config.discordBotToken,
    clientId: config.discordClientId,
    guildId: guild.id,
    logger,
  });

  logger.info({ guildId: guild.id, guildName: guild.name }, "Guild onboarding complete");
}
