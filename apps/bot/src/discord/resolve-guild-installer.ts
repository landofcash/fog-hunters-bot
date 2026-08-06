import { AuditLogEvent, PermissionsBitField, type Guild } from "discord.js";
import type { Logger } from "pino";
import type { InternalBootstrapRequest } from "../api/contracts";

export interface ResolvedGuildInstaller {
  profile: NonNullable<InternalBootstrapRequest["installer"]>;
  auditLogEntryId: string;
}

export async function resolveGuildInstaller(input: {
  guild: Guild;
  discordBotUserId: string;
  logger: Logger;
  attempts?: number;
}): Promise<ResolvedGuildInstaller | undefined> {
  const {
    guild,
    discordBotUserId,
    logger,
    attempts = 1,
  } = input;
  const botMember = guild.members?.me;

  if (!botMember?.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
    logger.warn(
      { guildId: guild.id },
      "Cannot resolve the bot installer because View Audit Log permission is missing",
    );
    return undefined;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.BotAdd,
        limit: 10,
      });
      const entry = auditLogs.entries.find(
        (candidate) =>
          candidate.targetId === discordBotUserId
          && candidate.executor
          && !candidate.executor.bot,
      );

      if (entry?.executor) {
        return {
          auditLogEntryId: entry.id,
          profile: {
            discordUserId: entry.executor.id,
            username: entry.executor.username
              ?? entry.executor.globalName
              ?? entry.executor.id,
            globalName: entry.executor.globalName ?? null,
            avatarUrl: entry.executor.displayAvatarURL() ?? null,
          },
        };
      }
    } catch (error) {
      logger.warn(
        { err: error, guildId: guild.id },
        "Failed to resolve the bot installer from Discord audit logs",
      );
      return undefined;
    }

    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  logger.warn(
    { guildId: guild.id, discordBotUserId },
    "Discord bot-add audit entry was not found",
  );
  return undefined;
}
