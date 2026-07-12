import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  internalBootstrapBodySchema,
  internalLlmChannelToggleBodySchema,
  internalLlmMemoryClearBodySchema,
  internalLlmRespondBodySchema,
  internalLlmSettingsPatchBodySchema,
  internalLlmSettingsReadBodySchema,
  internalSettingsReadBodySchema,
  internalUserTouchBodySchema,
} from "../../contracts/internal";
import { ApiError } from "../../lib/errors";
import { requireInternalApiKey } from "../../middleware/internal-auth";
import { LlmService } from "../llm/llm.service";

const guildParamsSchema = z.object({
  guildId: z.string().min(1),
});

const commandCheckParamsSchema = guildParamsSchema.extend({
  commandKey: z.string().min(1),
});

const commandCheckBodySchema = z.object({
  actorDiscordUserId: z.string().min(1),
  channelId: z.string().optional(),
  defaultMinRole: z.enum(["OWNER", "ADMIN", "MODERATOR", "USER"]).default("ADMIN"),
});

async function assertCommandAccess(input: {
  app: FastifyInstance;
  guildId: string;
  actorDiscordUserId: string;
  commandKey: string;
  channelId?: string;
}): Promise<{ actorUserId?: string }> {
  const access = await input.app.repository.checkCommandAccess({
    guildDiscordId: input.guildId,
    commandKey: input.commandKey,
    actorDiscordUserId: input.actorDiscordUserId,
    channelId: input.channelId,
    defaultMinRole: "ADMIN",
  });

  if (!access.allowed) {
    throw new ApiError(403, "COMMAND_ACCESS_DENIED", "Command access denied.", {
      reason: access.reason,
      commandKey: input.commandKey,
    });
  }

  return {
    actorUserId: access.actor?.userId,
  };
}

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  const llmService = new LlmService(app.appConfig, app.repository, app.log);

  const internal = async (internalApp: FastifyInstance): Promise<void> => {
    internalApp.addHook("preHandler", requireInternalApiKey);

    internalApp.post("/guilds/:guildId/bootstrap", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalBootstrapBodySchema.parse(request.body ?? {});

      const bootstrap = await internalApp.repository.bootstrapGuild({
        guildDiscordId: params.guildId,
        guildName: body.guildName,
        ownerProfile: body.owner
          ? {
              discordUserId: body.owner.discordUserId,
              username: body.owner.username,
              globalName: body.owner.globalName,
              avatarUrl: body.owner.avatarUrl,
            }
          : undefined,
      });

      const owner = body.owner ? await internalApp.repository.getUserByDiscordId(body.owner.discordUserId) : null;
      await internalApp.repository.createAuditLog({
        guildId: bootstrap.guild.id,
        actorUserId: owner?.id,
        actorType: "SYSTEM",
        action: "guild.bootstrap",
        entityType: "guild",
        entityId: bootstrap.guild.id,
        after: {
          guildId: bootstrap.guild.id,
          guildDiscordId: bootstrap.guild.discordGuildId,
          guildName: bootstrap.guild.name,
          guildCreated: bootstrap.guildCreated,
          ownerMembershipCreated: bootstrap.ownerMembershipCreated,
        },
      });

      return bootstrap;
    });

    internalApp.post("/interactions/user-touch", async (request) => {
      const body = internalUserTouchBodySchema.parse(request.body ?? {});
      const user = await internalApp.repository.upsertUserFromDiscord(
        {
          discordUserId: body.discordUserId,
          username: body.username,
          globalName: body.globalName,
          avatarUrl: body.avatarUrl,
        },
        internalApp.appConfig.platformAdminDiscordIds.has(body.discordUserId),
      );
      return {
        touched: true,
        user: {
          id: user.id,
          discordUserId: user.discordUserId,
        },
      };
    });

    internalApp.post("/guilds/:guildId/commands/:commandKey/check", async (request) => {
      const params = commandCheckParamsSchema.parse(request.params);
      const body = commandCheckBodySchema.parse(request.body ?? {});
      const access = await internalApp.repository.checkCommandAccess({
        guildDiscordId: params.guildId,
        commandKey: params.commandKey,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        defaultMinRole: body.defaultMinRole,
      });
      return access;
    });

    internalApp.post("/guilds/:guildId/settings/read", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalSettingsReadBodySchema.parse(request.body ?? {});
      await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey,
      });

      const settings = await internalApp.repository.getGuildSettings(params.guildId);
      if (!settings) {
        throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
      }

      return {
        guild: settings.guild,
        features: settings.features,
        commands: settings.commands,
      };
    });

    internalApp.post("/guilds/:guildId/llm/settings/read", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalLlmSettingsReadBodySchema.parse(request.body ?? {});
      await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey,
      });

      return internalApp.repository.getOrCreateLlmGuildSettings(params.guildId);
    });

    internalApp.patch("/guilds/:guildId/llm/settings", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalLlmSettingsPatchBodySchema.parse(request.body ?? {});
      const access = await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey,
      });

      const before = await internalApp.repository.getOrCreateLlmGuildSettings(params.guildId);
      const updated = await internalApp.repository.updateLlmGuildSettings({
        guildDiscordId: params.guildId,
        enabled: body.enabled,
        defaultModel: body.defaultModel,
        stylePrompt: body.stylePrompt,
        retentionDays: body.retentionDays,
        dmEnabled: body.dmEnabled,
        maxInputChars: body.maxInputChars,
        maxOutputTokens: body.maxOutputTokens,
      });

      await internalApp.repository.createAuditLog({
        guildId: updated.guild.id,
        actorUserId: access.actorUserId,
        actorType: "USER",
        action: "llm.guild_settings.updated",
        entityType: "llm_guild_setting",
        entityId: updated.settings.id,
        before: before.settings as unknown as Record<string, unknown>,
        after: updated.settings as unknown as Record<string, unknown>,
      });

      return {
        guild: updated.guild,
        settings: updated.settings,
      };
    });

    internalApp.post("/guilds/:guildId/llm/channels/enable", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalLlmChannelToggleBodySchema.parse(request.body ?? {});
      const access = await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey,
      });

      const previous = await internalApp.repository.getLlmChannelSettings(params.guildId, body.channelId);
      await internalApp.repository.updateLlmGuildSettings({
        guildDiscordId: params.guildId,
        enabled: true,
      });
      const current = await internalApp.repository.upsertLlmChannelSettings({
        guildDiscordId: params.guildId,
        channelId: body.channelId,
        enabled: true,
        respondOnMentionOnly: body.respondOnMentionOnly,
      });

      const guild = await internalApp.repository.getGuildByDiscordId(params.guildId);
      if (!guild) {
        throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
      }

      await internalApp.repository.createAuditLog({
        guildId: guild.id,
        actorUserId: access.actorUserId,
        actorType: "USER",
        action: "llm.channel_settings.upserted",
        entityType: "llm_channel_setting",
        entityId: current.id,
        before: previous as unknown as Record<string, unknown> | null,
        after: current as unknown as Record<string, unknown>,
        metadata: {
          channelId: body.channelId,
          enabled: true,
        },
      });

      return {
        channel: current,
      };
    });

    internalApp.post("/guilds/:guildId/llm/channels/disable", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalLlmChannelToggleBodySchema.parse(request.body ?? {});
      const access = await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey,
      });

      const previous = await internalApp.repository.getLlmChannelSettings(params.guildId, body.channelId);
      const current = await internalApp.repository.upsertLlmChannelSettings({
        guildDiscordId: params.guildId,
        channelId: body.channelId,
        enabled: false,
        respondOnMentionOnly: previous?.respondOnMentionOnly ?? false,
      });

      const guild = await internalApp.repository.getGuildByDiscordId(params.guildId);
      if (!guild) {
        throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
      }

      await internalApp.repository.createAuditLog({
        guildId: guild.id,
        actorUserId: access.actorUserId,
        actorType: "USER",
        action: "llm.channel_settings.disabled",
        entityType: "llm_channel_setting",
        entityId: current.id,
        before: previous as unknown as Record<string, unknown> | null,
        after: current as unknown as Record<string, unknown>,
        metadata: {
          channelId: body.channelId,
          enabled: false,
        },
      });

      return {
        channel: current,
      };
    });

    internalApp.post("/guilds/:guildId/llm/channels/memory/clear", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalLlmMemoryClearBodySchema.parse(request.body ?? {});
      const access = await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey,
      });

      const result = await internalApp.repository.clearLlmChannelMemory(params.guildId, body.channelId);
      const guild = await internalApp.repository.getGuildByDiscordId(params.guildId);
      if (!guild) {
        throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
      }

      await internalApp.repository.createAuditLog({
        guildId: guild.id,
        actorUserId: access.actorUserId,
        actorType: "USER",
        action: "llm.channel_memory.cleared",
        entityType: "llm_conversation",
        entityId: `${params.guildId}:${body.channelId}`,
        after: result as unknown as Record<string, unknown>,
        metadata: {
          channelId: body.channelId,
        },
      });

      return result;
    });

    internalApp.post("/llm/respond", async (request) => {
      const body = internalLlmRespondBodySchema.parse(request.body ?? {});
      return llmService.respondToMessage({
        guildId: body.guildId,
        channelId: body.channelId,
        discordUserId: body.discordUserId,
        content: body.content,
        messageId: body.messageId,
        isDm: body.isDm,
        botWasMentioned: body.botWasMentioned,
      });
    });
  };

  await app.register(internal, { prefix: "/internal" });
}
