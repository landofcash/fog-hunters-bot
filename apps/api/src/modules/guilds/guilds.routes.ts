import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { LLM_PROMPT_MAX_LENGTH } from "../../contracts/llm";
import { ApiError } from "../../lib/errors";
import { requireAuth } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { requireGuildScope } from "../../middleware/guild-scope";
import { requireRole } from "../../middleware/require-role";
import { isEffectiveAiEnabled } from "../llm/effective-ai";
import { getEffectivePrompts } from "../llm/prompts";
import { sanitizeLlmSettingsForAudit } from "../llm/settings-audit";

const guildParams = z.object({ guildId: z.string().min(1) });
const botParams = guildParams.extend({ botId: z.string().uuid() });
const channelParams = botParams.extend({ channelId: z.string().min(1) });
const featureParams = botParams.extend({ featureKey: z.string().min(1).max(100) });
const commandParams = botParams.extend({ commandKey: z.string().min(1).max(100) });
const installationPatch = z.object({
  operationalStatus: z.enum(["ENABLED", "DISABLED"]),
}).strict();
const guildLlmPatch = z.object({
  llmEnabledByGuild: z.boolean().optional(),
  assistantPromptOverride: z.string().max(LLM_PROMPT_MAX_LENGTH).nullable().optional(),
  gatekeeperPromptOverride: z.string().max(LLM_PROMPT_MAX_LENGTH).nullable().optional(),
  retentionDaysOverride: z.number().int().min(1).max(3650).nullable().optional(),
  maxInputCharsOverride: z.number().int().min(128).max(32_000).nullable().optional(),
  maxOutputTokensOverride: z.number().int().min(64).max(4096).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const channelBody = z.object({
  enabled: z.boolean().default(true),
  respondOnMentionOnly: z.boolean().default(false),
}).strict();
const featureBody = z.object({
  enabled: z.boolean(),
  configJson: z.record(z.unknown()).default({}),
  expectedVersion: z.number().int().positive().optional(),
}).strict();
const commandBody = z.object({
  minRole: z.enum(["OWNER", "ADMIN", "MODERATOR", "USER"]),
  allowChannels: z.array(z.string()).default([]),
  denyChannels: z.array(z.string()).default([]),
}).strict();
const memberParams = guildParams.extend({ userId: z.string().uuid() });
const roleBody = z.object({ role: z.enum(["OWNER", "ADMIN", "MODERATOR", "USER"]) }).strict();
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

async function presentInstallation(app: FastifyInstance, botId: string, guildId: string) {
  const installation = await app.repository.getInstallation(botId, guildId);
  if (!installation) throw new ApiError(404, "BOT_NOT_INSTALLED", "The bot is not installed in this guild.");
  if (installation.presenceStatus !== "PRESENT") {
    throw new ApiError(409, "BOT_NOT_INSTALLED", "The bot is no longer present in this guild.");
  }
  return installation;
}

async function auditGuildChange(input: {
  app: FastifyInstance;
  request: FastifyRequest;
  botInstanceId: string;
  botInstallationId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}) {
  const guildId = input.request.guildContext?.guild.id;
  if (!guildId || !input.request.auth) return;
  await input.app.repository.createAuditLog({
    guildId,
    botInstanceId: input.botInstanceId,
    botInstallationId: input.botInstallationId,
    actorUserId: input.request.auth.userId,
    actorType:
      input.request.auth.platformRole === "PLATFORM_ADMIN"
        ? "PLATFORM_ADMIN"
        : "USER",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before,
    after: input.after,
    metadata: input.metadata,
  });
}

export async function registerGuildRoutes(app: FastifyInstance): Promise<void> {
  const guildRoutes = async (guildApp: FastifyInstance): Promise<void> => {
    guildApp.addHook("preHandler", requireAuth);
    guildApp.addHook("preHandler", requireGuildScope);

    guildApp.get("/:guildId/bots", { preHandler: [requireRole("ADMIN")] }, async (request) => {
      const { guildId } = guildParams.parse(request.params);
      return { items: await guildApp.repository.listGuildBots(guildId) };
    });

    guildApp.get("/:guildId/bots/:botId/settings", { preHandler: [requireRole("ADMIN")] }, async (request) => {
      const { guildId, botId } = botParams.parse(request.params);
      const scoped = await guildApp.repository.getInstallationSettings(botId, guildId);
      const [channels, features, commands, effective] = await Promise.all([
        guildApp.repository.listLlmChannelSettings(botId, guildId),
        guildApp.repository.listFeatureFlags(botId, guildId),
        guildApp.repository.listCommandPermissions(botId, guildId),
        guildApp.repository.getEffectiveBotSettings({
          botInstanceId: botId,
          guildDiscordId: guildId,
        }),
      ]);
      return {
        installation: scoped.installation,
        settings: scoped.settings,
        profile: scoped.profile,
        effective,
        effectiveAiEnabled: isEffectiveAiEnabled(guildApp.appConfig, effective),
        effectivePrompts: getEffectivePrompts(effective),
        channels,
        features,
        commands,
      };
    });

    guildApp.patch(
      "/:guildId/bots/:botId/installation",
      { preHandler: [requireRole("ADMIN"), requireCsrf] },
      async (request) => {
        const { guildId, botId } = botParams.parse(request.params);
        const before = await presentInstallation(guildApp, botId, guildId);
        const body = installationPatch.parse(request.body ?? {});
        const installation = await guildApp.repository.updateInstallationOperationalStatus({
          botInstanceId: botId,
          guildDiscordId: guildId,
          operationalStatus: body.operationalStatus,
        });
        await auditGuildChange({
          app: guildApp,
          request,
          botInstanceId: botId,
          botInstallationId: installation.id,
          action: "bot.installation.operational_status.updated",
          entityType: "bot_installation",
          entityId: installation.id,
          before: { operationalStatus: before.operationalStatus },
          after: { operationalStatus: installation.operationalStatus },
        });
        return { installation };
      },
    );

    guildApp.patch(
      "/:guildId/bots/:botId/llm/settings",
      { preHandler: [requireRole("ADMIN"), requireCsrf] },
      async (request) => {
        const { guildId, botId } = botParams.parse(request.params);
        const installation = await presentInstallation(guildApp, botId, guildId);
        const before = await guildApp.repository.getInstallationSettings(botId, guildId);
        const body = guildLlmPatch.parse(request.body ?? {});
        const settings = await guildApp.repository.updateInstallationSettings({
          botInstanceId: botId,
          guildDiscordId: guildId,
          ...body,
        });
        await auditGuildChange({
          app: guildApp,
          request,
          botInstanceId: botId,
          botInstallationId: installation.id,
          action: "bot.installation.llm_settings.updated",
          entityType: "llm_installation_settings",
          entityId: settings.id,
          before: sanitizeLlmSettingsForAudit(before.settings),
          after: sanitizeLlmSettingsForAudit(settings),
        });
        const effective = await guildApp.repository.getEffectiveBotSettings({
          botInstanceId: botId,
          guildDiscordId: guildId,
        });
        return {
          settings,
          effective,
          effectiveAiEnabled: isEffectiveAiEnabled(guildApp.appConfig, effective),
          effectivePrompts: getEffectivePrompts(effective),
        };
      },
    );

    guildApp.put(
      "/:guildId/bots/:botId/llm/channels/:channelId",
      { preHandler: [requireRole("ADMIN"), requireCsrf] },
      async (request) => {
        const { guildId, botId, channelId } = channelParams.parse(request.params);
        const installation = await presentInstallation(guildApp, botId, guildId);
        const body = channelBody.parse(request.body ?? {});
        const previous = await guildApp.repository.getLlmChannelSettings(botId, guildId, channelId);
        if (body.enabled) {
          await guildApp.repository.updateInstallationSettings({
            botInstanceId: botId,
            guildDiscordId: guildId,
            llmEnabledByGuild: true,
          });
        }
        const channel = await guildApp.repository.upsertLlmChannelSettings({
          botInstanceId: botId,
          guildDiscordId: guildId,
          channelId,
          enabled: body.enabled,
          respondOnMentionOnly: body.respondOnMentionOnly,
        });
        await auditGuildChange({
          app: guildApp,
          request,
          botInstanceId: botId,
          botInstallationId: installation.id,
          action: "bot.installation.llm_channel.updated",
          entityType: "llm_channel_settings",
          entityId: channel.id,
          before: previous ? { ...previous } : null,
          after: { ...channel },
        });
        return { channel };
      },
    );

    guildApp.delete(
      "/:guildId/bots/:botId/llm/channels/:channelId",
      { preHandler: [requireRole("ADMIN"), requireCsrf] },
      async (request) => {
        const { guildId, botId, channelId } = channelParams.parse(request.params);
        const installation = await presentInstallation(guildApp, botId, guildId);
        const previous = await guildApp.repository.getLlmChannelSettings(botId, guildId, channelId);
        const channel = await guildApp.repository.upsertLlmChannelSettings({
          botInstanceId: botId,
          guildDiscordId: guildId,
          channelId,
          enabled: false,
          respondOnMentionOnly: previous?.respondOnMentionOnly ?? false,
        });
        await auditGuildChange({
          app: guildApp,
          request,
          botInstanceId: botId,
          botInstallationId: installation.id,
          action: "bot.installation.llm_channel.disabled",
          entityType: "llm_channel_settings",
          entityId: channel.id,
          before: previous ? { ...previous } : null,
          after: { ...channel },
        });
        return { channel };
      },
    );

    guildApp.post(
      "/:guildId/bots/:botId/llm/channels/:channelId/memory/clear",
      { preHandler: [requireRole("ADMIN"), requireCsrf] },
      async (request) => {
        const { guildId, botId, channelId } = channelParams.parse(request.params);
        const installation = await presentInstallation(guildApp, botId, guildId);
        const result = await guildApp.repository.clearLlmChannelMemory(botId, guildId, channelId);
        await auditGuildChange({
          app: guildApp,
          request,
          botInstanceId: botId,
          botInstallationId: installation.id,
          action: "bot.installation.llm_memory.cleared",
          entityType: "llm_channel",
          entityId: channelId,
          after: { ...result },
        });
        return result;
      },
    );

    guildApp.patch(
      "/:guildId/bots/:botId/features/:featureKey",
      { preHandler: [requireRole("ADMIN"), requireCsrf] },
      async (request) => {
        const { guildId, botId, featureKey } = featureParams.parse(request.params);
        const installation = await presentInstallation(guildApp, botId, guildId);
        const body = featureBody.parse(request.body ?? {});
        const result = await guildApp.repository.upsertFeatureFlag({
          botInstanceId: botId,
          guildDiscordId: guildId,
          featureKey,
          ...body,
        });
        await auditGuildChange({
          app: guildApp,
          request,
          botInstanceId: botId,
          botInstallationId: installation.id,
          action: "bot.installation.feature.updated",
          entityType: "feature_flag",
          entityId: result.current.id,
          before: result.previous ? { ...result.previous } : null,
          after: { ...result.current },
        });
        return result;
      },
    );

    guildApp.put(
      "/:guildId/bots/:botId/commands/:commandKey",
      { preHandler: [requireRole("ADMIN"), requireCsrf] },
      async (request) => {
        const { guildId, botId, commandKey } = commandParams.parse(request.params);
        const installation = await presentInstallation(guildApp, botId, guildId);
        const body = commandBody.parse(request.body ?? {});
        const result = await guildApp.repository.upsertCommandPermission({
          botInstanceId: botId,
          guildDiscordId: guildId,
          commandKey,
          ...body,
        });
        await auditGuildChange({
          app: guildApp,
          request,
          botInstanceId: botId,
          botInstallationId: installation.id,
          action: "bot.installation.command_permission.updated",
          entityType: "command_permission",
          entityId: result.current.id,
          before: result.previous ? { ...result.previous } : null,
          after: { ...result.current },
        });
        return result;
      },
    );

    guildApp.get("/:guildId/members", { preHandler: [requireRole("ADMIN")] }, async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const query = pageQuery.parse(request.query ?? {});
      return guildApp.repository.listGuildMembers(guildId, query.limit, query.cursor);
    });

    guildApp.put(
      "/:guildId/roles/:userId",
      { preHandler: [requireRole("OWNER"), requireCsrf] },
      async (request) => {
        const { guildId, userId } = memberParams.parse(request.params);
        const { role } = roleBody.parse(request.body ?? {});
        const auth = request.auth;
        if (!auth) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        const result = await guildApp.repository.updateGuildMemberRole({
          guildDiscordId: guildId,
          targetUserId: userId,
          role,
        });
        if (!result) throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Guild membership not found.");
        await guildApp.repository.createAuditLog({
          guildId: result.guild.id,
          actorUserId: auth.userId,
          actorType:
            auth.platformRole === "PLATFORM_ADMIN"
              ? "PLATFORM_ADMIN"
              : "USER",
          action: "member.role.updated",
          entityType: "guild_member",
          entityId: `${result.after.guildId}:${result.after.userId}`,
          before: { ...result.before },
          after: { ...result.after },
        });
        return result;
      },
    );

    guildApp.get("/:guildId/audit-logs", { preHandler: [requireRole("ADMIN")] }, async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const query = pageQuery.extend({ botInstanceId: z.string().uuid().optional() }).parse(request.query ?? {});
      return guildApp.repository.listAuditLogs({
        guildDiscordId: guildId,
        botInstanceId: query.botInstanceId,
        cursor: query.cursor,
        limit: query.limit,
      });
    });

    guildApp.get("/:guildId/jobs", { preHandler: [requireRole("ADMIN")] }, async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const query = pageQuery.extend({ botInstanceId: z.string().uuid().optional() }).parse(request.query ?? {});
      return guildApp.repository.listJobRuns({
        guildDiscordId: guildId,
        botInstanceId: query.botInstanceId,
        cursor: query.cursor,
        limit: query.limit,
      });
    });
  };

  await app.register(guildRoutes, { prefix: "/guilds" });
}
