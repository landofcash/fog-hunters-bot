import type { Guild } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";

export async function handleGuildUpdateEvent(input: {
  oldGuild: Guild;
  newGuild: Guild;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { oldGuild, newGuild, apiClient, logger } = input;
  if (oldGuild.ownerId === newGuild.ownerId) {
    try {
      await apiClient.bootstrapGuild(newGuild.id, { guildName: newGuild.name });
    } catch (error) {
      logger.error(
        { err: error, guildId: newGuild.id },
        "Failed to reconcile guild metadata",
      );
    }
    return;
  }

  try {
    const ownerMember = await newGuild.fetchOwner();
    await apiClient.bootstrapGuild(newGuild.id, {
      guildName: newGuild.name,
      owner: {
        discordUserId: ownerMember.user.id,
        username: ownerMember.user.username,
        globalName: ownerMember.user.globalName ?? null,
        avatarUrl: ownerMember.user.displayAvatarURL() ?? null,
      },
    });
    logger.info(
      {
        guildId: newGuild.id,
        previousOwnerDiscordUserId: oldGuild.ownerId,
        ownerDiscordUserId: ownerMember.user.id,
      },
      "Guild ownership reconciled",
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        guildId: newGuild.id,
        previousOwnerDiscordUserId: oldGuild.ownerId,
        ownerDiscordUserId: newGuild.ownerId,
      },
      "Failed to reconcile guild ownership",
    );
  }
}
