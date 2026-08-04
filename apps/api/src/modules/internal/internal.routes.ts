import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { LLM_PROMPT_MAX_LENGTH } from "../../contracts/llm";
import { ApiError, isApiError } from "../../lib/errors";
import { requireBotLease, requirePoolCredential } from "../../middleware/internal-auth";
import { createInternalRateLimiters } from "../../plugins/rate-limit";
import type { CommandAccessResult } from "../../repositories/types";
import {
  decryptBotToken,
  hashOpaqueToken,
} from "../bots/bot-token-crypto";
import { isEffectiveAiEnabled } from "../llm/effective-ai";
import { LlmService } from "../llm/llm.service";
import { getEffectivePrompts } from "../llm/prompts";
import { sanitizeLlmSettingsForAudit } from "../llm/settings-audit";

const botParams = z.object({ botId: z.string().uuid() });
const guildParams = z.object({ guildId: z.string().min(1) });
const commandParams = guildParams.extend({ commandKey: z.string().min(1) });
const claimBody = z.object({
  runtimeInstanceId: z.string().min(1).max(200),
  claimRequestId: z.string().uuid(),
}).strict();
const heartbeatBody = z.object({
  runtimeState: z.enum(["CLAIMED", "CONNECTING", "READY", "BACKOFF", "ERROR", "QUARANTINED"]).optional(),
  connectedAt: z.coerce.date().optional(),
  errorCode: z.string().max(100).nullable().optional(),
}).strict();
const bootstrapBody = z.object({
  guildName: z.string().min(1),
  owner: z.object({
    discordUserId: z.string().min(1),
    username: z.string().min(1),
    globalName: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
  }).optional(),
}).strict();
const identityBody = z.object({
  discordApplicationId: z.string().min(1),
  discordBotUserId: z.string().min(1),
  discordUsername: z.string().min(1),
  discordAvatarUrl: z.string().nullable().optional(),
}).strict();
const manifestBody = z.object({
  hash: z.string().max(128).nullable().optional(),
  errorCode: z.string().max(100).nullable().optional(),
  syncedAt: z.coerce.date().nullable().optional(),
}).strict();
const userBody = z.object({
  discordUserId: z.string().min(1),
  username: z.string().min(1),
  globalName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
}).strict();
const commandCheckBody = z.object({
  actorDiscordUserId: z.string().min(1),
  channelId: z.string().optional(),
  defaultMinRole: z.enum(["OWNER", "ADMIN", "MODERATOR", "USER"]).default("ADMIN"),
}).strict();
const adminMutationBody = z.object({
  actorDiscordUserId: z.string().min(1),
  channelId: z.string().optional(),
  target: userBody,
}).strict();
const actorBody = z.object({
  actorDiscordUserId: z.string().min(1),
  channelId: z.string().optional(),
  commandKey: z.string().min(1).optional(),
}).strict();
const llmSettingsPatch = actorBody.extend({
  llmEnabledByGuild: z.boolean().optional(),
  assistantPromptOverride: z.string().max(LLM_PROMPT_MAX_LENGTH).nullable().optional(),
  gatekeeperPromptOverride: z.string().max(LLM_PROMPT_MAX_LENGTH).nullable().optional(),
  retentionDaysOverride: z.number().int().min(1).max(3650).nullable().optional(),
  maxInputCharsOverride: z.number().int().min(128).max(32_000).nullable().optional(),
  maxOutputTokensOverride: z.number().int().min(64).max(4096).nullable().optional(),
}).strict();
const channelBody = actorBody.extend({
  channelId: z.string().min(1),
  respondOnMentionOnly: z.boolean().optional(),
}).strict();
const llmRespondBody = z.object({
  guildId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  discordUserId: z.string().min(1),
  content: z.string().min(1).max(24_000),
  messageId: z.string().optional(),
  contextMessages: z.array(z.object({
    discordUserId: z.string().min(1),
    content: z.string().min(1).max(8_000),
    messageId: z.string().optional(),
  })).max(19).default([]),
  isDm: z.boolean().default(false),
  botWasMentioned: z.boolean().default(false),
}).strict();
const receiptBody = z.object({
  discordEventId: z.string().min(1),
  eventType: z.enum(["MESSAGE_CREATE", "INTERACTION_CREATE"]),
}).strict();
const receiptParams = z.object({ receiptId: z.string().uuid() });
const failureBody = z.object({ errorCode: z.string().min(1).max(100) }).strict();

function noStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

function leaseContext(request: FastifyRequest) {
  if (!request.botLeaseContext) {
    throw new ApiError(401, "BOT_LEASE_EXPIRED", "A valid bot lease is required.");
  }
  return request.botLeaseContext;
}

async function assertPresentInstallation(
  app: FastifyInstance,
  botInstanceId: string,
  guildId: string,
) {
  const installation = await app.repository.getInstallation(botInstanceId, guildId);
  if (!installation || installation.presenceStatus !== "PRESENT") {
    throw new ApiError(404, "BOT_NOT_INSTALLED", "The bot is not present in this guild.");
  }
  return installation;
}

async function assertActiveInstallation(
  app: FastifyInstance,
  botInstanceId: string,
  guildId: string,
) {
  const installation = await assertPresentInstallation(app, botInstanceId, guildId);
  if (installation.operationalStatus !== "ENABLED") {
    throw new ApiError(409, "BOT_DISABLED", "The bot installation is disabled.");
  }
  return installation;
}

async function assertCommandAccess(input: {
  app: FastifyInstance;
  botInstanceId: string;
  guildId: string;
  actorDiscordUserId: string;
  channelId?: string;
  commandKey: string;
  defaultMinRole?: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
}) {
  await assertActiveInstallation(
    input.app,
    input.botInstanceId,
    input.guildId,
  );
  const access = await input.app.repository.checkCommandAccess({
    botInstanceId: input.botInstanceId,
    guildDiscordId: input.guildId,
    commandKey: input.commandKey,
    actorDiscordUserId: input.actorDiscordUserId,
    channelId: input.channelId,
    defaultMinRole: input.defaultMinRole ?? "ADMIN",
  });
  if (!access.allowed) {
    throw new ApiError(403, "COMMAND_ACCESS_DENIED", "Command access denied.", { reason: access.reason });
  }
  return access;
}

async function auditBotCommandMutation(input: {
  app: FastifyInstance;
  access: CommandAccessResult;
  botInstanceId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const actor = input.access.actor;
  if (!actor) {
    throw new ApiError(500, "COMMAND_ACTOR_MISSING", "Authorized command actor is missing.");
  }
  await input.app.repository.createAuditLog({
    guildId: input.access.guild.id,
    botInstanceId: input.botInstanceId,
    botInstallationId: input.access.installation.id,
    actorUserId: actor.userId,
    actorType:
      actor.platformRole === "PLATFORM_ADMIN"
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

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  const llmService = new LlmService(app.appConfig, app.repository, app.log);
  const rateLimiters = createInternalRateLimiters(app);

  const requireRateLimitedCredential = (
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
    rateLimit: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  ) => async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await authenticate(request, reply);
    } catch (error) {
      if (isApiError(error) && error.statusCode === 401) {
        await rateLimiters.authenticationFailure(request, reply);
      }
      throw error;
    }
    await rateLimit(request, reply);
  };
  const requireRateLimitedPoolCredential = requireRateLimitedCredential(
    requirePoolCredential,
    rateLimiters.pool,
  );
  const requireRateLimitedBotLease = requireRateLimitedCredential(
    requireBotLease,
    rateLimiters.bot,
  );

  const poolRoutes = async (pool: FastifyInstance): Promise<void> => {
    pool.get("/assignments", { preHandler: [requireRateLimitedPoolCredential] }, async () => ({
      items: (await pool.repository.listRuntimeAssignments(new Date())).map(({ bot, lease }) => ({
        botInstanceId: bot.id,
        slug: bot.slug,
        displayName: bot.displayName,
        discordApplicationId: bot.discordApplicationId,
        tokenVersion: bot.tokenVersion,
        runtime: lease,
      })),
      pollAfterMs: pool.appConfig.botAssignmentPollMs,
    }));

    pool.post("/assignments/:botId/claim", { preHandler: [requireRateLimitedPoolCredential] }, async (request, reply) => {
      noStore(reply);
      const { botId } = botParams.parse(request.params);
      const body = claimBody.parse(request.body ?? {});
      const leaseToken = randomBytes(32).toString("base64url");
      const now = new Date();
      const claim = await pool.repository.claimRuntime({
        botInstanceId: botId,
        runtimeInstanceId: body.runtimeInstanceId,
        claimRequestId: body.claimRequestId,
        leaseToken,
        leaseTokenHash: hashOpaqueToken(leaseToken),
        now,
        expiresAt: new Date(now.getTime() + pool.appConfig.botLeaseTtlMs),
      });
      let discordToken: string;
      try {
        const key = pool.appConfig.botTokenEncryptionKeys.get(claim.secret.encryptionKeyVersion);
        if (!key) {
          throw new ApiError(409, "BOT_TOKEN_DECRYPT_FAILED", "Bot-token encryption key version is unavailable.");
        }
        discordToken = decryptBotToken({
          encrypted: claim.secret,
          key,
          botInstanceId: claim.bot.id,
          discordApplicationId: claim.bot.discordApplicationId,
        });
      } catch (error) {
        if (isApiError(error) && error.code === "BOT_TOKEN_DECRYPT_FAILED") {
          await pool.repository.revokeRuntimeLease(botId, now);
        }
        throw error;
      }
      return {
        bot: claim.bot,
        profile: claim.profile,
        lease: claim.lease,
        leaseToken: claim.leaseToken,
        discordToken,
        heartbeatAfterMs: pool.appConfig.botHeartbeatMs,
      };
    });
  };
  await app.register(poolRoutes, { prefix: "/internal/runtime" });

  const botRoutes = async (botApp: FastifyInstance): Promise<void> => {
    botApp.addHook("preHandler", requireRateLimitedBotLease);

    botApp.post("/runtime/assignments/:botId/heartbeat", async (request) => {
      const { botId } = botParams.parse(request.params);
      const context = leaseContext(request);
      if (context.bot.id !== botId) throw new ApiError(403, "BOT_SCOPE_MISMATCH", "Lease cannot manage another bot.");
      const body = heartbeatBody.parse(request.body ?? {});
      const now = new Date();
      return {
        lease: await botApp.repository.heartbeatRuntime({
          botInstanceId: botId,
          leaseGeneration: context.lease.leaseGeneration,
          leaseTokenHash: context.leaseTokenHash,
          now,
          expiresAt: new Date(now.getTime() + botApp.appConfig.botLeaseTtlMs),
          runtimeState: body.runtimeState,
          connectedAt: body.connectedAt,
          errorCode: body.errorCode,
        }),
      };
    });

    botApp.post("/runtime/assignments/:botId/release", async (request) => {
      const { botId } = botParams.parse(request.params);
      const context = leaseContext(request);
      if (context.bot.id !== botId) throw new ApiError(403, "BOT_SCOPE_MISMATCH", "Lease cannot manage another bot.");
      return {
        lease: await botApp.repository.releaseRuntime({
          botInstanceId: botId,
          leaseGeneration: context.lease.leaseGeneration,
          leaseTokenHash: context.leaseTokenHash,
          now: new Date(),
        }),
      };
    });

    botApp.post("/guilds/:guildId/bootstrap", async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const body = bootstrapBody.parse(request.body ?? {});
      const context = leaseContext(request);
      return botApp.repository.bootstrapInstallation({
        botInstanceId: context.bot.id,
        guildDiscordId: guildId,
        guildName: body.guildName,
        ownerProfile: body.owner,
      });
    });

    botApp.post("/guilds/:guildId/left", async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const context = leaseContext(request);
      return {
        installation: await botApp.repository.markInstallationLeft({
          botInstanceId: context.bot.id,
          guildDiscordId: guildId,
        }),
      };
    });

    botApp.post("/identity", async (request) => {
      const context = leaseContext(request);
      const body = identityBody.parse(request.body ?? {});
      return {
        bot: await botApp.repository.updateObservedBotIdentity({
          botInstanceId: context.bot.id,
          ...body,
        }),
      };
    });

    botApp.put("/guilds/:guildId/command-manifest", async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const context = leaseContext(request);
      await assertPresentInstallation(botApp, context.bot.id, guildId);
      return {
        installation: await botApp.repository.updateCommandManifest({
          botInstanceId: context.bot.id,
          guildDiscordId: guildId,
          ...manifestBody.parse(request.body ?? {}),
        }),
      };
    });

    botApp.get("/command-manifests/pending", async (request) => {
      const context = leaseContext(request);
      return {
        items: await botApp.repository.listPendingCommandSyncs(context.bot.id),
      };
    });

    botApp.post("/interactions/user-touch", async (request) => {
      const body = userBody.parse(request.body ?? {});
      const user = await botApp.repository.upsertUserFromDiscord(
        body,
        botApp.appConfig.platformAdminDiscordIds.has(body.discordUserId),
      );
      return { touched: true, user: { id: user.id, discordUserId: user.discordUserId } };
    });

    botApp.post("/guilds/:guildId/commands/:commandKey/check", async (request) => {
      const { guildId, commandKey } = commandParams.parse(request.params);
      const context = leaseContext(request);
      await assertActiveInstallation(botApp, context.bot.id, guildId);
      const body = commandCheckBody.parse(request.body ?? {});
      return botApp.repository.checkCommandAccess({
        botInstanceId: context.bot.id,
        guildDiscordId: guildId,
        commandKey,
        ...body,
      });
    });

    botApp.post("/guilds/:guildId/settings/read", async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const context = leaseContext(request);
      const body = actorBody.parse(request.body ?? {});
      await assertCommandAccess({
        app: botApp,
        botInstanceId: context.bot.id,
        guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey ?? "settings.view",
      });
      const [settings, bots, features, commands] = await Promise.all([
        botApp.repository.getInstallationSettings(context.bot.id, guildId),
        botApp.repository.listGuildBots(guildId),
        botApp.repository.listFeatureFlags(context.bot.id, guildId),
        botApp.repository.listCommandPermissions(context.bot.id, guildId),
      ]);
      return {
        guild: settings.installation,
        bot: context.bot,
        installations: bots,
        settings: settings.settings,
        features,
        commands,
      };
    });

    botApp.post("/guilds/:guildId/admins/list", async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const context = leaseContext(request);
      const body = actorBody.parse(request.body ?? {});
      await assertCommandAccess({
        app: botApp,
        botInstanceId: context.bot.id,
        guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: "settings.admin.list",
      });
      const members = await botApp.repository.listGuildAdministrators(guildId);
      return {
        owners: members.filter((member) => member.tenantRole === "OWNER"),
        admins: members.filter((member) => member.tenantRole === "ADMIN"),
      };
    });

    for (const operation of ["add", "remove"] as const) {
      botApp.post(`/guilds/:guildId/admins/${operation}`, async (request) => {
        const { guildId } = guildParams.parse(request.params);
        const context = leaseContext(request);
        const body = adminMutationBody.parse(request.body ?? {});
        const access = await assertCommandAccess({
          app: botApp,
          botInstanceId: context.bot.id,
          guildId,
          actorDiscordUserId: body.actorDiscordUserId,
          channelId: body.channelId,
          commandKey: `settings.admin.${operation}`,
          defaultMinRole: "OWNER",
        });
        if (access.actor?.tenantRole !== "OWNER") {
          throw new ApiError(403, "OWNER_REQUIRED", "Only the guild owner can manage administrators.");
        }

        if (operation === "remove") {
          const membership = await botApp.repository.getMembershipByDiscordUser(
            guildId,
            body.target.discordUserId,
          );
          if (membership?.status === "ACTIVE" && membership.tenantRole === "OWNER") {
            return { changed: false, reason: "OWNER_ALREADY_PRIVILEGED", membership };
          }
          if (!membership || membership.status !== "ACTIVE" || membership.tenantRole !== "ADMIN") {
            return { changed: false, reason: "NOT_ADMIN", membership };
          }
          const updated = await botApp.repository.updateGuildMemberRole({
            guildDiscordId: guildId,
            targetUserId: membership.userId,
            role: "USER",
          });
          if (!updated) throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Guild membership not found.");
          await auditBotCommandMutation({
            app: botApp,
            access,
            botInstanceId: context.bot.id,
            action: "member.admin.removed",
            entityType: "guild_member",
            entityId: `${updated.after.guildId}:${updated.after.userId}`,
            before: { ...updated.before },
            after: { ...updated.after },
            metadata: {
              commandKey: "settings.admin.remove",
              targetDiscordUserId: body.target.discordUserId,
              membershipCreated: false,
            },
          });
          return { changed: true, membership: updated.after };
        }

        const targetUser = await botApp.repository.upsertUserFromDiscord(
          body.target,
          botApp.appConfig.platformAdminDiscordIds.has(body.target.discordUserId),
        );
        const target = await botApp.repository.upsertGuildMembership(guildId, targetUser.id);
        if (!target) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
        if (target.membership.tenantRole === "OWNER") {
          return { changed: false, reason: "OWNER_ALREADY_PRIVILEGED", membership: target.membership };
        }
        if (target.membership.tenantRole === "ADMIN") {
          return { changed: false, reason: "ALREADY_ADMIN", membership: target.membership };
        }
        const updated = await botApp.repository.updateGuildMemberRole({
          guildDiscordId: guildId,
          targetUserId: targetUser.id,
          role: "ADMIN",
        });
        if (!updated) throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Guild membership not found.");
        await auditBotCommandMutation({
          app: botApp,
          access,
          botInstanceId: context.bot.id,
          action: "member.admin.added",
          entityType: "guild_member",
          entityId: `${updated.after.guildId}:${updated.after.userId}`,
          before: { ...updated.before },
          after: { ...updated.after },
          metadata: {
            commandKey: "settings.admin.add",
            targetDiscordUserId: body.target.discordUserId,
            membershipCreated: target.created,
          },
        });
        return { changed: true, membership: updated.after };
      });
    }

    botApp.post("/guilds/:guildId/llm/settings/read", async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const context = leaseContext(request);
      const body = actorBody.parse(request.body ?? {});
      await assertCommandAccess({
        app: botApp,
        botInstanceId: context.bot.id,
        guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey ?? "ai.status",
      });
      const scoped = await botApp.repository.getInstallationSettings(context.bot.id, guildId);
      const effective = await botApp.repository.getEffectiveBotSettings({
        botInstanceId: context.bot.id,
        guildDiscordId: guildId,
      });
      return {
        ...scoped,
        effective,
        effectiveAiEnabled: isEffectiveAiEnabled(botApp.appConfig, effective),
        effectivePrompts: getEffectivePrompts(effective),
      };
    });

    botApp.patch("/guilds/:guildId/llm/settings", async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const context = leaseContext(request);
      const body = llmSettingsPatch.parse(request.body ?? {});
      const access = await assertCommandAccess({
        app: botApp,
        botInstanceId: context.bot.id,
        guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey ?? "ai.prompt.set",
      });
      const before = await botApp.repository.getInstallationSettings(context.bot.id, guildId);
      const { actorDiscordUserId: _actor, channelId: _channel, commandKey: _command, ...patch } = body;
      const settings = await botApp.repository.updateInstallationSettings({
        botInstanceId: context.bot.id,
        guildDiscordId: guildId,
        ...patch,
      });
      await auditBotCommandMutation({
        app: botApp,
        access,
        botInstanceId: context.bot.id,
        action: "bot.installation.llm_settings.updated",
        entityType: "llm_installation_settings",
        entityId: settings.id,
        before: sanitizeLlmSettingsForAudit(before.settings),
        after: sanitizeLlmSettingsForAudit(settings),
        metadata: {
          commandKey: body.commandKey ?? "ai.prompt.set",
        },
      });
      const effective = await botApp.repository.getEffectiveBotSettings({
        botInstanceId: context.bot.id,
        guildDiscordId: guildId,
      });
      return {
        installation: effective.installation,
        settings,
        effective,
        effectiveAiEnabled: isEffectiveAiEnabled(botApp.appConfig, effective),
        effectivePrompts: getEffectivePrompts(effective),
      };
    });

    for (const enabled of [true, false]) {
      botApp.post(`/guilds/:guildId/llm/channels/${enabled ? "enable" : "disable"}`, async (request) => {
        const { guildId } = guildParams.parse(request.params);
        const context = leaseContext(request);
        const body = channelBody.parse(request.body ?? {});
        const access = await assertCommandAccess({
          app: botApp,
          botInstanceId: context.bot.id,
          guildId,
          actorDiscordUserId: body.actorDiscordUserId,
          channelId: body.channelId,
          commandKey: body.commandKey ?? (enabled ? "ai.enable" : "ai.disable"),
        });
        const previous = await botApp.repository.getLlmChannelSettings(context.bot.id, guildId, body.channelId);
        if (enabled) {
          await botApp.repository.updateInstallationSettings({
            botInstanceId: context.bot.id,
            guildDiscordId: guildId,
            llmEnabledByGuild: true,
          });
        }
        const channel = await botApp.repository.upsertLlmChannelSettings({
          botInstanceId: context.bot.id,
          guildDiscordId: guildId,
          channelId: body.channelId,
          enabled,
          respondOnMentionOnly: body.respondOnMentionOnly ?? previous?.respondOnMentionOnly ?? false,
        });
        await auditBotCommandMutation({
          app: botApp,
          access,
          botInstanceId: context.bot.id,
          action: enabled
            ? "bot.installation.llm_channel.updated"
            : "bot.installation.llm_channel.disabled",
          entityType: "llm_channel_settings",
          entityId: channel.id,
          before: previous ? { ...previous } : null,
          after: { ...channel },
          metadata: {
            commandKey: body.commandKey ?? (enabled ? "ai.enable" : "ai.disable"),
            channelId: body.channelId,
            enabled,
          },
        });
        return {
          channel,
        };
      });
    }

    botApp.post("/guilds/:guildId/llm/channels/memory/clear", async (request) => {
      const { guildId } = guildParams.parse(request.params);
      const context = leaseContext(request);
      const body = channelBody.parse(request.body ?? {});
      const access = await assertCommandAccess({
        app: botApp,
        botInstanceId: context.bot.id,
        guildId,
        actorDiscordUserId: body.actorDiscordUserId,
        channelId: body.channelId,
        commandKey: body.commandKey ?? "ai.memory.clear",
      });
      const result = await botApp.repository.clearLlmChannelMemory(context.bot.id, guildId, body.channelId);
      await auditBotCommandMutation({
        app: botApp,
        access,
        botInstanceId: context.bot.id,
        action: "bot.installation.llm_memory.cleared",
        entityType: "llm_channel",
        entityId: body.channelId,
        after: { ...result },
        metadata: {
          commandKey: body.commandKey ?? "ai.memory.clear",
          channelId: body.channelId,
        },
      });
      return result;
    });

    botApp.post("/events/receipts", async (request) => {
      const context = leaseContext(request);
      const body = receiptBody.parse(request.body ?? {});
      const now = new Date();
      return botApp.repository.acquireDiscordEvent({
        botInstanceId: context.bot.id,
        discordEventId: body.discordEventId,
        eventType: body.eventType,
        leaseGeneration: context.lease.leaseGeneration,
        now,
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
        staleBefore: new Date(now.getTime() - 60_000),
        maxAttempts: 3,
      });
    });

    botApp.post("/events/receipts/:receiptId/complete", async (request) => {
      const context = leaseContext(request);
      const { receiptId } = receiptParams.parse(request.params);
      await botApp.repository.completeDiscordEvent({
        receiptId,
        botInstanceId: context.bot.id,
        leaseGeneration: context.lease.leaseGeneration,
      });
      return { completed: true };
    });

    botApp.post("/events/receipts/:receiptId/fail", async (request) => {
      const context = leaseContext(request);
      const { receiptId } = receiptParams.parse(request.params);
      const { errorCode } = failureBody.parse(request.body ?? {});
      await botApp.repository.failDiscordEvent({
        receiptId,
        botInstanceId: context.bot.id,
        leaseGeneration: context.lease.leaseGeneration,
        errorCode,
      });
      return { failed: true };
    });

    botApp.post("/llm/respond", async (request) => {
      const context = leaseContext(request);
      const body = llmRespondBody.parse(request.body ?? {});
      return llmService.respondToMessage({ botInstanceId: context.bot.id, ...body });
    });
  };

  await app.register(botRoutes, { prefix: "/internal" });
}
