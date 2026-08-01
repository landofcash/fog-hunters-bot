import type { FastifyInstance } from "fastify";
import {
  platformGuildListQuerySchema,
  platformGuildParamsSchema,
  platformLlmPolicyPatchSchema,
} from "../../contracts/platform";
import { ApiError } from "../../lib/errors";
import { requireAuth } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { requirePlatformAdmin } from "../../middleware/platform-admin";
import { isSupportedLlmModel, SUPPORTED_LLM_MODELS } from "../llm/models";
import { sanitizeLlmSettingsForAudit } from "../llm/settings-audit";

function effectiveAiEnabled(app: FastifyInstance, settings: {
  enabled: boolean;
  platformEnabled: boolean;
}): boolean {
  return app.appConfig.llmEnabled
    && !app.appConfig.llmGlobalKillSwitch
    && settings.platformEnabled
    && settings.enabled;
}

export async function registerPlatformRoutes(app: FastifyInstance): Promise<void> {
  const platform = async (platformApp: FastifyInstance): Promise<void> => {
    platformApp.addHook("preHandler", requireAuth);
    platformApp.addHook("preHandler", requirePlatformAdmin);

    platformApp.get("/guilds", async (request) => {
      const query = platformGuildListQuerySchema.parse(request.query ?? {});
      const page = await platformApp.repository.listPlatformGuilds(query);
      return {
        ...page,
        items: page.items.map((guild) => ({
          ...guild,
          effectiveAiEnabled:
            platformApp.appConfig.llmEnabled
            && !platformApp.appConfig.llmGlobalKillSwitch
            && guild.platformAiEnabled
            && guild.guildAiEnabled,
        })),
      };
    });

    platformApp.get("/llm/models", async () => ({
      items: SUPPORTED_LLM_MODELS,
    }));

    platformApp.patch(
      "/guilds/:guildId/llm-policy",
      {
        preHandler: [requireCsrf],
      },
      async (request) => {
        const params = platformGuildParamsSchema.parse(request.params);
        const body = platformLlmPolicyPatchSchema.parse(request.body ?? {});
        const auth = request.auth;
        if (!auth) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        }
        if (body.defaultModel && !isSupportedLlmModel(body.defaultModel)) {
          throw new ApiError(400, "LLM_MODEL_NOT_SUPPORTED", "Unsupported AI model.");
        }

        const before = await platformApp.repository.getOrCreateLlmGuildSettings(params.guildId);
        const updated = await platformApp.repository.updateLlmGuildSettings({
          guildDiscordId: params.guildId,
          platformEnabled: body.platformEnabled,
          defaultModel: body.defaultModel,
        });
        const audit = await platformApp.repository.createAuditLog({
          guildId: updated.guild.id,
          actorUserId: auth.userId,
          actorType: "PLATFORM_ADMIN",
          action: "llm.platform_policy.updated",
          entityType: "llm_guild_setting",
          entityId: updated.settings.id,
          before: sanitizeLlmSettingsForAudit(before.settings),
          after: sanitizeLlmSettingsForAudit(updated.settings),
        });

        return {
          guild: updated.guild,
          settings: updated.settings,
          effectiveAiEnabled: effectiveAiEnabled(platformApp, updated.settings),
          auditLogId: audit.id,
        };
      },
    );
  };

  await app.register(platform, { prefix: "/platform" });
}
