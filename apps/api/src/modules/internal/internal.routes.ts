import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  internalAdminListBodySchema,
  internalAdminMutationBodySchema,
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
import { isSupportedLlmModel } from "../llm/models";
import { getEffectivePrompts } from "../llm/prompts";
import { sanitizeLlmSettingsForAudit } from "../llm/settings-audit";

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
  defaultMinRole?: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
}): Promise<{
  actorUserId?: string;
  actorRole?: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
  actorType: "USER" | "PLATFORM_ADMIN";
}> {
  const access = await input.app.repository.checkCommandAccess({
    guildDiscordId: input.guildId,
    commandKey: input.commandKey,
    actorDiscordUserId: input.actorDiscordUserId,
    channelId: input.channelId,
    defaultMinRole: input.defaultMinRole ?? "ADMIN",
  });

  if (!access.allowed) {
    throw new ApiError(403, "COMMAND_ACCESS_DENIED", "Command access denied.", {
      reason: access.reason,
      commandKey: input.commandKey,
    });
  }

  return {
    actorUserId: access.actor?.userId,
    actorRole: access.actor?.tenantRole,
    actorType: access.actor?.platformRole === "PLATFORM_ADMIN" ? "PLATFORM_ADMIN" : "USER",
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
        before: bootstrap.ownerChanged
          ? {
              ownerDiscordUserId: bootstrap.previousOwnerDiscordUserId,
            }
          : undefined,
        after: {
          guildId: bootstrap.guild.id,
          guildDiscordId: bootstrap.guild.discordGuildId,
          guildName: bootstrap.guild.name,
          guildCreated: bootstrap.guildCreated,
          ownerMembershipCreated: bootstrap.ownerMembershipCreated,
          ownerChanged: bootstrap.ownerChanged,
          ownerDiscordUserId: bootstrap.ownerDiscordUserId,
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

    internalApp.post("/guilds/:guildId/admins/list", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalAdminListBodySchema.parse(request.body ?? {});
      await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: "settings.admin.list",
      });

      const members = await internalApp.repository.listGuildAdministrators(params.guildId);
      return {
        owners: members.filter((member) => member.tenantRole === "OWNER"),
        admins: members.filter((member) => member.tenantRole === "ADMIN"),
      };
    });

    internalApp.post("/guilds/:guildId/admins/add", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalAdminMutationBodySchema.parse(request.body ?? {});
      const access = await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: "settings.admin.add",
        defaultMinRole: "OWNER",
      });
      if (access.actorRole !== "OWNER") {
        throw new ApiError(403, "OWNER_REQUIRED", "Only the guild OWNER can manage admins.");
      }

      const targetUser = await internalApp.repository.upsertUserFromDiscord(
        body.target,
        internalApp.appConfig.platformAdminDiscordIds.has(body.target.discordUserId),
      );
      const target = await internalApp.repository.upsertGuildMembership(params.guildId, targetUser.id);
      if (!target) {
        throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
      }

      if (target.membership.tenantRole === "OWNER") {
        return {
          changed: false,
          reason: "OWNER_ALREADY_PRIVILEGED",
          membership: target.membership,
        };
      }
      if (target.membership.tenantRole === "ADMIN") {
        return {
          changed: false,
          reason: "ALREADY_ADMIN",
          membership: target.membership,
        };
      }

      const update = await internalApp.repository.updateGuildMemberRole({
        guildDiscordId: params.guildId,
        targetUserId: targetUser.id,
        role: "ADMIN",
      });
      if (!update) {
        throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Guild membership not found.");
      }

      const audit = await internalApp.repository.createAuditLog({
        guildId: update.guild.id,
        actorUserId: access.actorUserId,
        actorType: access.actorType,
        action: "member.admin.added",
        entityType: "guild_member",
        entityId: `${update.after.guildId}:${update.after.userId}`,
        before: update.before as unknown as Record<string, unknown>,
        after: update.after as unknown as Record<string, unknown>,
        metadata: {
          targetDiscordUserId: body.target.discordUserId,
          membershipCreated: target.created,
        },
      });

      return {
        changed: true,
        membership: update.after,
        auditLogId: audit.id,
      };
    });

    internalApp.post("/guilds/:guildId/admins/remove", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const body = internalAdminMutationBodySchema.parse(request.body ?? {});
      const access = await assertCommandAccess({
        app: internalApp,
        guildId: params.guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: "settings.admin.remove",
        defaultMinRole: "OWNER",
      });
      if (access.actorRole !== "OWNER") {
        throw new ApiError(403, "OWNER_REQUIRED", "Only the guild OWNER can manage admins.");
      }

      const targetUser = await internalApp.repository.upsertUserFromDiscord(
        body.target,
        internalApp.appConfig.platformAdminDiscordIds.has(body.target.discordUserId),
      );
      const membership = await internalApp.repository.getMembershipByDiscordUser(
        params.guildId,
        body.target.discordUserId,
      );
      if (membership?.tenantRole === "OWNER" && membership.status === "ACTIVE") {
        throw new ApiError(409, "OWNER_PROTECTED", "The guild OWNER cannot be removed as an admin.");
      }
      if (!membership || membership.status !== "ACTIVE" || membership.tenantRole !== "ADMIN") {
        return {
          changed: false,
          reason: "NOT_ADMIN",
          membership: membership ?? null,
        };
      }

      const update = await internalApp.repository.updateGuildMemberRole({
        guildDiscordId: params.guildId,
        targetUserId: targetUser.id,
        role: "USER",
      });
      if (!update) {
        throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Guild membership not found.");
      }

      const audit = await internalApp.repository.createAuditLog({
        guildId: update.guild.id,
        actorUserId: access.actorUserId,
        actorType: access.actorType,
        action: "member.admin.removed",
        entityType: "guild_member",
        entityId: `${update.after.guildId}:${update.after.userId}`,
        before: update.before as unknown as Record<string, unknown>,
        after: update.after as unknown as Record<string, unknown>,
        metadata: {
          targetDiscordUserId: body.target.discordUserId,
        },
      });

      return {
        changed: true,
        membership: update.after,
        auditLogId: audit.id,
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

      const result = await internalApp.repository.getOrCreateLlmGuildSettings(params.guildId);
      return {
        ...result,
        effectiveAiEnabled:
          internalApp.appConfig.llmEnabled
          && !internalApp.appConfig.llmGlobalKillSwitch
          && result.settings.platformEnabled
          && result.settings.enabled,
        effectivePrompts: getEffectivePrompts(result.settings),
      };
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
      if (body.defaultModel !== undefined) {
        const actor = access.actorUserId
          ? await internalApp.repository.getUserById(access.actorUserId)
          : null;
        if (actor?.platformRole !== "PLATFORM_ADMIN") {
          throw new ApiError(
            403,
            "PLATFORM_ADMIN_REQUIRED",
            "Only a platform administrator can change the assigned model.",
          );
        }
        if (!isSupportedLlmModel(body.defaultModel)) {
          throw new ApiError(400, "LLM_MODEL_NOT_SUPPORTED", "Unsupported AI model.");
        }
      }

      const before = await internalApp.repository.getOrCreateLlmGuildSettings(params.guildId);
      const assistantPrompt = body.assistantPrompt !== undefined
        ? body.assistantPrompt
        : body.stylePrompt;
      const updated = await internalApp.repository.updateLlmGuildSettings({
        guildDiscordId: params.guildId,
        enabled: body.enabled,
        defaultModel: body.defaultModel,
        assistantPrompt,
        gatekeeperPrompt: body.gatekeeperPrompt,
        retentionDays: body.retentionDays,
        dmEnabled: body.dmEnabled,
        maxInputChars: body.maxInputChars,
        maxOutputTokens: body.maxOutputTokens,
      });

      await internalApp.repository.createAuditLog({
        guildId: updated.guild.id,
        actorUserId: access.actorUserId,
        actorType: access.actorType,
        action: "llm.guild_settings.updated",
        entityType: "llm_guild_setting",
        entityId: updated.settings.id,
        before: sanitizeLlmSettingsForAudit(before.settings),
        after: sanitizeLlmSettingsForAudit(updated.settings),
      });

      return {
        guild: updated.guild,
        settings: updated.settings,
        effectivePrompts: getEffectivePrompts(updated.settings),
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
        actorType: access.actorType,
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
        actorType: access.actorType,
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
        actorType: access.actorType,
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
