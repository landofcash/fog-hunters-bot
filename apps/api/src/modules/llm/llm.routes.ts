import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { llmChannelSettingsBodySchema, llmGuildSettingsPatchBodySchema } from "../../contracts/llm";
import { ApiError } from "../../lib/errors";
import { requireAuth } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { requireGuildScope } from "../../middleware/guild-scope";
import { requireRole } from "../../middleware/require-role";
import { isSupportedLlmModel } from "./models";
import { getEffectivePrompts } from "./prompts";
import { sanitizeLlmSettingsForAudit } from "./settings-audit";

const guildParamsSchema = z.object({
  guildId: z.string().min(1),
});

const channelParamsSchema = guildParamsSchema.extend({
  channelId: z.string().min(1),
});

function actorTypeForRequest(request: FastifyRequest): "USER" | "PLATFORM_ADMIN" {
  return request.auth?.platformRole === "PLATFORM_ADMIN" ? "PLATFORM_ADMIN" : "USER";
}

function effectiveAiEnabled(app: FastifyInstance, settings: {
  enabled: boolean;
  platformEnabled: boolean;
}): boolean {
  return app.appConfig.llmEnabled
    && !app.appConfig.llmGlobalKillSwitch
    && settings.platformEnabled
    && settings.enabled;
}

export async function registerLlmRoutes(app: FastifyInstance): Promise<void> {
  const llmPlugin = async (llmApp: FastifyInstance): Promise<void> => {
    llmApp.addHook("preHandler", requireAuth);
    llmApp.addHook("preHandler", requireGuildScope);

    llmApp.get(
      "/:guildId/llm/settings",
      {
        preHandler: [requireRole("ADMIN")],
      },
      async (request) => {
        const params = guildParamsSchema.parse(request.params);
        const result = await llmApp.repository.getOrCreateLlmGuildSettings(params.guildId);
        const channels = await llmApp.repository.listLlmChannelSettings(params.guildId);
        return {
          ...result,
          effectiveAiEnabled: effectiveAiEnabled(llmApp, result.settings),
          channels,
          effectivePrompts: getEffectivePrompts(result.settings),
        };
      },
    );

    llmApp.patch(
      "/:guildId/llm/settings",
      {
        preHandler: [requireCsrf, requireRole("ADMIN")],
      },
      async (request) => {
        const params = guildParamsSchema.parse(request.params);
        const body = llmGuildSettingsPatchBodySchema.parse(request.body ?? {});
        const auth = request.auth;
        const guildContext = request.guildContext;
        if (!auth || !guildContext) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        }
        const updatesPlatformPolicy = body.defaultModel !== undefined || body.platformEnabled !== undefined;
        if (updatesPlatformPolicy && auth.platformRole !== "PLATFORM_ADMIN") {
          throw new ApiError(
            403,
            "PLATFORM_ADMIN_REQUIRED",
            "Only a platform administrator can change the assigned model or platform AI access.",
          );
        }
        if (body.defaultModel && !isSupportedLlmModel(body.defaultModel)) {
          throw new ApiError(400, "LLM_MODEL_NOT_SUPPORTED", "Unsupported AI model.");
        }

        const before = await llmApp.repository.getOrCreateLlmGuildSettings(params.guildId);
        const updated = await llmApp.repository.updateLlmGuildSettings({
          guildDiscordId: params.guildId,
          enabled: body.enabled,
          platformEnabled: body.platformEnabled,
          defaultModel: body.defaultModel,
          assistantPrompt: body.assistantPrompt,
          gatekeeperPrompt: body.gatekeeperPrompt,
          retentionDays: body.retentionDays,
          dmEnabled: body.dmEnabled,
          maxInputChars: body.maxInputChars,
          maxOutputTokens: body.maxOutputTokens,
        });

        const audit = await llmApp.repository.createAuditLog({
          guildId: guildContext.guild.id,
          actorUserId: auth.userId,
          actorType: actorTypeForRequest(request),
          action: "llm.guild_settings.updated",
          entityType: "llm_guild_setting",
          entityId: updated.settings.id,
          before: sanitizeLlmSettingsForAudit(before.settings),
          after: sanitizeLlmSettingsForAudit(updated.settings),
        });

        return {
          settings: updated.settings,
          effectiveAiEnabled: effectiveAiEnabled(llmApp, updated.settings),
          effectivePrompts: getEffectivePrompts(updated.settings),
          auditLogId: audit.id,
        };
      },
    );

    llmApp.post(
      "/:guildId/llm/channels/:channelId",
      {
        preHandler: [requireCsrf, requireRole("ADMIN")],
      },
      async (request) => {
        const params = channelParamsSchema.parse(request.params);
        const body = llmChannelSettingsBodySchema.parse(request.body ?? {});
        const auth = request.auth;
        const guildContext = request.guildContext;
        if (!auth || !guildContext) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        }

        const previous = await llmApp.repository.getLlmChannelSettings(params.guildId, params.channelId);
        await llmApp.repository.updateLlmGuildSettings({
          guildDiscordId: params.guildId,
          enabled: true,
        });
        const current = await llmApp.repository.upsertLlmChannelSettings({
          guildDiscordId: params.guildId,
          channelId: params.channelId,
          enabled: true,
          respondOnMentionOnly: body.respondOnMentionOnly,
        });

        const audit = await llmApp.repository.createAuditLog({
          guildId: guildContext.guild.id,
          actorUserId: auth.userId,
          actorType: actorTypeForRequest(request),
          action: "llm.channel_settings.upserted",
          entityType: "llm_channel_setting",
          entityId: current.id,
          before: previous as unknown as Record<string, unknown> | null,
          after: current as unknown as Record<string, unknown>,
          metadata: {
            channelId: params.channelId,
            enabled: true,
          },
        });

        return {
          channel: current,
          auditLogId: audit.id,
        };
      },
    );

    llmApp.delete(
      "/:guildId/llm/channels/:channelId",
      {
        preHandler: [requireCsrf, requireRole("ADMIN")],
      },
      async (request) => {
        const params = channelParamsSchema.parse(request.params);
        const auth = request.auth;
        const guildContext = request.guildContext;
        if (!auth || !guildContext) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        }

        const previous = await llmApp.repository.getLlmChannelSettings(params.guildId, params.channelId);
        const current = await llmApp.repository.upsertLlmChannelSettings({
          guildDiscordId: params.guildId,
          channelId: params.channelId,
          enabled: false,
          respondOnMentionOnly: previous?.respondOnMentionOnly ?? false,
        });

        const audit = await llmApp.repository.createAuditLog({
          guildId: guildContext.guild.id,
          actorUserId: auth.userId,
          actorType: actorTypeForRequest(request),
          action: "llm.channel_settings.disabled",
          entityType: "llm_channel_setting",
          entityId: current.id,
          before: previous as unknown as Record<string, unknown> | null,
          after: current as unknown as Record<string, unknown>,
          metadata: {
            channelId: params.channelId,
            enabled: false,
          },
        });

        return {
          channel: current,
          auditLogId: audit.id,
        };
      },
    );

    llmApp.post(
      "/:guildId/llm/memory/channels/:channelId/clear",
      {
        preHandler: [requireCsrf, requireRole("ADMIN")],
      },
      async (request) => {
        const params = channelParamsSchema.parse(request.params);
        const auth = request.auth;
        const guildContext = request.guildContext;
        if (!auth || !guildContext) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        }

        const result = await llmApp.repository.clearLlmChannelMemory(params.guildId, params.channelId);

        const audit = await llmApp.repository.createAuditLog({
          guildId: guildContext.guild.id,
          actorUserId: auth.userId,
          actorType: actorTypeForRequest(request),
          action: "llm.channel_memory.cleared",
          entityType: "llm_conversation",
          entityId: `${params.guildId}:${params.channelId}`,
          after: result as unknown as Record<string, unknown>,
          metadata: {
            channelId: params.channelId,
          },
        });

        return {
          ...result,
          auditLogId: audit.id,
        };
      },
    );
  };

  await app.register(llmPlugin, { prefix: "/guilds" });
}
