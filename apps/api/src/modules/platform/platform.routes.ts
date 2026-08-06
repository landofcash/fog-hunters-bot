import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LLM_PROMPT_MAX_LENGTH, reasoningEffortSchema } from "../../contracts/llm";
import { ApiError } from "../../lib/errors";
import { requireAuth } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { requirePlatformAdmin } from "../../middleware/platform-admin";
import { encryptBotToken } from "../bots/bot-token-crypto";
import { isSupportedLlmModel, SUPPORTED_LLM_MODELS } from "../llm/models";
import {
  sanitizeBotProfileForAudit,
  sanitizeLlmSettingsForAudit,
} from "../llm/settings-audit";

const botParams = z.object({ botId: z.string().uuid() });
const installationParams = botParams.extend({ installationId: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  search: z.string().max(100).optional(),
});
const createBotBody = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  displayName: z.string().min(1).max(100),
  discordApplicationId: z.string().min(1).max(32),
}).strict();
const EXISTING_DISCORD_INSTALL_PERMISSIONS = 68_608;
const VIEW_AUDIT_LOG_PERMISSION = 128;
const DISCORD_INSTALL_PERMISSIONS = String(
  EXISTING_DISCORD_INSTALL_PERMISSIONS + VIEW_AUDIT_LOG_PERMISSION,
);
const patchBotBody = z.object({
  displayName: z.string().min(1).max(100).optional(),
  desiredStatus: z.enum(["DRAFT", "ACTIVE", "DISABLED"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const profileBody = z.object({
  defaultModel: z.string().min(1),
  reasoningEffort: reasoningEffortSchema,
  assistantPrompt: z.string().max(LLM_PROMPT_MAX_LENGTH).nullable().optional(),
  gatekeeperPrompt: z.string().max(LLM_PROMPT_MAX_LENGTH).nullable().optional(),
  dmEnabled: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
  maxInputChars: z.number().int().min(128).max(32_000),
  maxOutputTokens: z.number().int().min(64).max(4096),
}).strict();
const tokenBody = z.object({ token: z.string().min(20).max(512) }).strict();
const platformPolicyBody = z.object({
  llmEnabledByPlatform: z.boolean().optional(),
  modelOverride: z.string().min(1).nullable().optional(),
  reasoningEffortOverride: reasoningEffortSchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

function noStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

export async function registerPlatformRoutes(app: FastifyInstance): Promise<void> {
  const platform = async (platformApp: FastifyInstance): Promise<void> => {
    platformApp.addHook("preHandler", requireAuth);
    platformApp.addHook("preHandler", requirePlatformAdmin);

    platformApp.get("/llm/models", async () => ({ items: SUPPORTED_LLM_MODELS }));

    platformApp.get("/bots", async (request) => {
      const query = listQuery.parse(request.query ?? {});
      return platformApp.repository.listBots(query);
    });

    platformApp.post("/bots", { preHandler: [requireCsrf] }, async (request) => {
      const body = createBotBody.parse(request.body ?? {});
      const result = await platformApp.repository.createBot({
        ...body,
        defaultModel: platformApp.appConfig.llmDefaultModel,
      });
      await platformApp.repository.createAuditLog({
        botInstanceId: result.bot.id,
        actorUserId: request.auth?.userId,
        actorType: "PLATFORM_ADMIN",
        action: "bot.created",
        entityType: "bot_instance",
        entityId: result.bot.id,
        after: {
          slug: result.bot.slug,
          displayName: result.bot.displayName,
          discordApplicationId: result.bot.discordApplicationId,
        },
      });
      return result;
    });

    platformApp.get("/bots/:botId", async (request) => {
      const { botId } = botParams.parse(request.params);
      const [bot, profile, runtime] = await Promise.all([
        platformApp.repository.getBot(botId),
        platformApp.repository.getBotProfile(botId),
        platformApp.repository.getRuntimeLease(botId),
      ]);
      if (!bot || !profile || !runtime) {
        throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      }
      return { bot, profile, runtime };
    });

    platformApp.patch("/bots/:botId", { preHandler: [requireCsrf] }, async (request) => {
      const { botId } = botParams.parse(request.params);
      const body = patchBotBody.parse(request.body ?? {});
      const before = await platformApp.repository.getBot(botId);
      if (!before) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      const bot = await platformApp.repository.updateBot({ botInstanceId: botId, ...body });
      await platformApp.repository.createAuditLog({
        botInstanceId: botId,
        actorUserId: request.auth?.userId,
        actorType: "PLATFORM_ADMIN",
        action: "bot.updated",
        entityType: "bot_instance",
        entityId: botId,
        before: { displayName: before.displayName, desiredStatus: before.desiredStatus },
        after: { displayName: bot.displayName, desiredStatus: bot.desiredStatus },
      });
      return { bot };
    });

    platformApp.put("/bots/:botId/profile", { preHandler: [requireCsrf] }, async (request) => {
      const { botId } = botParams.parse(request.params);
      const body = profileBody.parse(request.body ?? {});
      if (!isSupportedLlmModel(body.defaultModel)) {
        throw new ApiError(400, "LLM_MODEL_NOT_SUPPORTED", "Unsupported AI model.");
      }
      const before = await platformApp.repository.getBotProfile(botId);
      if (!before) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      const profile = await platformApp.repository.updateBotProfile({ botInstanceId: botId, ...body });
      await platformApp.repository.createAuditLog({
        botInstanceId: botId,
        actorUserId: request.auth?.userId,
        actorType: "PLATFORM_ADMIN",
        action: "bot.profile.updated",
        entityType: "bot_profile",
        entityId: profile.id,
        before: sanitizeBotProfileForAudit(before),
        after: sanitizeBotProfileForAudit(profile),
      });
      return { profile };
    });

    platformApp.put("/bots/:botId/token", { preHandler: [requireCsrf] }, async (request, reply) => {
      noStore(reply);
      const { botId } = botParams.parse(request.params);
      const { token } = tokenBody.parse(request.body ?? {});
      const bot = await platformApp.repository.getBot(botId);
      if (!bot) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      const keyVersion = platformApp.appConfig.botTokenActiveKeyVersion;
      const key = platformApp.appConfig.botTokenEncryptionKeys.get(keyVersion);
      if (!key) throw new ApiError(500, "BOT_TOKEN_KEY_NOT_FOUND", "Active encryption key is unavailable.");
      const encrypted = encryptBotToken({
        token,
        key,
        keyVersion,
        botInstanceId: bot.id,
        discordApplicationId: bot.discordApplicationId,
      });
      const updated = await platformApp.repository.configureBotToken({
        botInstanceId: bot.id,
        ...encrypted,
        rotatedAt: new Date(),
        rotatedByUserId: request.auth?.userId,
      });
      await platformApp.repository.createAuditLog({
        botInstanceId: bot.id,
        actorUserId: request.auth?.userId,
        actorType: "PLATFORM_ADMIN",
        action: "bot.token.configured",
        entityType: "bot_token_secret",
        entityId: bot.id,
        after: { configured: true, tokenVersion: updated.tokenVersion },
      });
      return { configured: true, tokenVersion: updated.tokenVersion, rotatedAt: new Date() };
    });

    platformApp.delete("/bots/:botId/token", { preHandler: [requireCsrf] }, async (request, reply) => {
      noStore(reply);
      const { botId } = botParams.parse(request.params);
      if (!await platformApp.repository.getBot(botId)) {
        throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      }
      const bot = await platformApp.repository.deleteBotToken(botId);
      await platformApp.repository.createAuditLog({
        botInstanceId: bot.id,
        actorUserId: request.auth?.userId,
        actorType: "PLATFORM_ADMIN",
        action: "bot.token.deleted",
        entityType: "bot_token_secret",
        entityId: bot.id,
        after: { configured: false, tokenVersion: bot.tokenVersion },
      });
      return { configured: false, tokenVersion: bot.tokenVersion, rotatedAt: null };
    });

    platformApp.get("/bots/:botId/installations", async (request) => {
      const { botId } = botParams.parse(request.params);
      return { items: await platformApp.repository.listBotInstallations(botId) };
    });

    platformApp.get("/bots/:botId/installations/:installationId", async (request) => {
      const { botId, installationId } = installationParams.parse(request.params);
      const installation = await platformApp.repository.getInstallationById(botId, installationId);
      if (!installation) throw new ApiError(404, "BOT_NOT_INSTALLED", "Installation not found.");
      const scoped = await platformApp.repository.getInstallationSettings(botId, installation.guildDiscordId);
      return { installation, settings: scoped.settings, profile: scoped.profile };
    });

    platformApp.patch(
      "/bots/:botId/installations/:installationId/policy",
      { preHandler: [requireCsrf] },
      async (request) => {
        const { botId, installationId } = installationParams.parse(request.params);
        const body = platformPolicyBody.parse(request.body ?? {});
        if (body.modelOverride && !isSupportedLlmModel(body.modelOverride)) {
          throw new ApiError(400, "LLM_MODEL_NOT_SUPPORTED", "Unsupported AI model.");
        }
        const installation = await platformApp.repository.getInstallationById(botId, installationId);
        if (!installation) throw new ApiError(404, "BOT_NOT_INSTALLED", "Installation not found.");
        if (installation.presenceStatus !== "PRESENT") {
          throw new ApiError(
            409,
            "BOT_NOT_INSTALLED",
            "Platform policy is read-only while the bot is absent.",
          );
        }
        const before = await platformApp.repository.getInstallationSettings(
          botId,
          installation.guildDiscordId,
        );
        const settings = await platformApp.repository.updateInstallationSettings({
          botInstanceId: botId,
          guildDiscordId: installation.guildDiscordId,
          ...body,
        });
        await platformApp.repository.createAuditLog({
          guildId: installation.guildId,
          botInstanceId: botId,
          botInstallationId: installation.id,
          actorUserId: request.auth?.userId,
          actorType: "PLATFORM_ADMIN",
          action: "bot.installation.platform_policy.updated",
          entityType: "llm_installation_settings",
          entityId: settings.id,
          before: sanitizeLlmSettingsForAudit(before.settings),
          after: sanitizeLlmSettingsForAudit(settings),
        });
        return { installation, settings };
      },
    );

    platformApp.post(
      "/bots/:botId/installations/:installationId/commands/resync",
      { preHandler: [requireCsrf] },
      async (request) => {
        const { botId, installationId } = installationParams.parse(request.params);
        const before = await platformApp.repository.getInstallationById(
          botId,
          installationId,
        );
        if (!before) {
          throw new ApiError(404, "BOT_NOT_INSTALLED", "Installation not found.");
        }
        if (before.presenceStatus !== "PRESENT") {
          throw new ApiError(
            409,
            "BOT_NOT_INSTALLED",
            "Commands cannot be synchronized while the bot is absent.",
          );
        }
        const installation = await platformApp.repository.requestCommandResync(
          botId,
          installationId,
        );
        await platformApp.repository.createAuditLog({
          guildId: installation.guildId,
          botInstanceId: botId,
          botInstallationId: installation.id,
          actorUserId: request.auth?.userId,
          actorType: "PLATFORM_ADMIN",
          action: "bot.installation.command_resync.requested",
          entityType: "bot_installation",
          entityId: installation.id,
          before: {
            lastCommandManifestHash: before.lastCommandManifestHash,
            lastCommandSyncErrorCode: before.lastCommandSyncErrorCode,
          },
          after: {
            lastCommandManifestHash: null,
            lastCommandSyncErrorCode: null,
          },
        });
        return { installation };
      },
    );

    platformApp.get("/bots/:botId/runtime", async (request) => {
      const { botId } = botParams.parse(request.params);
      const runtime = await platformApp.repository.getRuntimeLease(botId);
      if (!runtime) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      return { runtime };
    });

    platformApp.get("/bots/:botId/install-url", async (request) => {
      const { botId } = botParams.parse(request.params);
      const bot = await platformApp.repository.getBot(botId);
      if (!bot) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      const query = new URLSearchParams({
        client_id: bot.discordApplicationId,
        permissions: DISCORD_INSTALL_PERMISSIONS,
        scope: "bot applications.commands",
      });
      return { url: `https://discord.com/oauth2/authorize?${query.toString()}` };
    });
  };

  await app.register(platform, { prefix: "/platform" });
}
