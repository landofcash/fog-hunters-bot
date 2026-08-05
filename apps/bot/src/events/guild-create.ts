import type { Guild } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import { synchronizeGuildCommands } from "../discord/register-commands";
import { resolveGuildInstaller } from "../discord/resolve-guild-installer";

export async function handleGuildCreateEvent(input: {
  guild: Guild;
  apiClient: ApiClient;
  botToken: string;
  discordApplicationId: string;
  discordBotUserId: string;
  canPerformDiscordSideEffects: () => boolean;
  logger: Logger;
}): Promise<void> {
  const {
    guild,
    apiClient,
    botToken,
    discordApplicationId,
    discordBotUserId,
    canPerformDiscordSideEffects,
    logger,
  } = input;

  if (!guild.available) {
    logger.info({ guildId: guild.id }, "Guild is temporarily unavailable; preserving installation presence");
    return;
  }

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

  const installer = await resolveGuildInstaller({
    guild,
    discordBotUserId,
    logger,
    attempts: 3,
  });
  const result = await apiClient.bootstrapGuild(guild.id, {
    guildName: guild.name,
    owner,
    ...(installer
      ? {
          installer: installer.profile,
          installerAuditLogEntryId: installer.auditLogEntryId,
        }
      : {}),
  });

  await synchronizeGuildCommands({
    apiClient,
    botToken,
    clientId: discordApplicationId,
    guildId: guild.id,
    previousHash: result.installation.lastCommandManifestHash,
    previousErrorCode: result.installation.lastCommandSyncErrorCode,
    canPerformDiscordSideEffects,
    logger,
  });

  logger.info({ guildId: guild.id, guildName: guild.name }, "Guild onboarding complete");
}
