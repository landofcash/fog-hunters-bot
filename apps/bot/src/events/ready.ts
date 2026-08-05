import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import { synchronizeGuildCommands } from "../discord/register-commands";
import { resolveGuildInstaller } from "../discord/resolve-guild-installer";

export async function handleReadyEvent(input: {
  client: Client<true>;
  apiClient: ApiClient;
  botToken: string;
  discordApplicationId: string;
  canPerformDiscordSideEffects: () => boolean;
  logger: Logger;
}): Promise<void> {
  const {
    client,
    apiClient,
    botToken,
    discordApplicationId,
    canPerformDiscordSideEffects,
    logger,
  } = input;
  logger.info({ botUserId: client.user.id, botTag: client.user.tag }, "Discord bot connected");

  const guilds = [...client.guilds.cache.values()];
  await apiClient.reconcileGuilds(guilds.map((guild) => guild.id));

  // Bootstrap guild rows for servers where the bot already exists.
  for (const guild of guilds) {
    if (!guild.available) {
      logger.info(
        { guildId: guild.id },
        "Guild is temporarily unavailable during ready; preserving installation presence",
      );
      continue;
    }
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

      const installer = await resolveGuildInstaller({
        guild,
        discordBotUserId: client.user.id,
        logger,
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
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Failed to bootstrap guild during startup");
    }
  }

}
