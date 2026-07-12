import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  auditLogsQuerySchema,
  jobRunsQuerySchema,
  paginationQuerySchema,
  updateCommandPermissionBodySchema,
  updateFeatureFlagBodySchema,
  updateGuildMemberRoleBodySchema,
} from "../../contracts/guilds";
import { ApiError } from "../../lib/errors";
import { requireAuth } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { requireGuildScope } from "../../middleware/guild-scope";
import { requireRole } from "../../middleware/require-role";

const guildParamsSchema = z.object({
  guildId: z.string().min(1),
});

const featureParamsSchema = guildParamsSchema.extend({
  featureKey: z.string().min(1),
});

const commandParamsSchema = guildParamsSchema.extend({
  commandKey: z.string().min(1),
});

const memberParamsSchema = guildParamsSchema.extend({
  userId: z.string().uuid(),
});

function actorTypeForRequest(request: FastifyRequest): "USER" | "PLATFORM_ADMIN" {
  return request.auth?.platformRole === "PLATFORM_ADMIN" ? "PLATFORM_ADMIN" : "USER";
}

export async function registerGuildRoutes(app: FastifyInstance): Promise<void> {
  const guildPlugin = async (guildApp: FastifyInstance): Promise<void> => {
    guildApp.addHook("preHandler", requireAuth);
    guildApp.addHook("preHandler", requireGuildScope);

    guildApp.get("/:guildId/settings", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const settings = await guildApp.repository.getGuildSettings(params.guildId);
      if (!settings) {
        throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
      }
      return settings;
    });

    guildApp.patch(
      "/:guildId/features/:featureKey",
      {
        preHandler: [requireCsrf, requireRole("ADMIN")],
      },
      async (request) => {
        const params = featureParamsSchema.parse(request.params);
        const body = updateFeatureFlagBodySchema.parse(request.body);
        const auth = request.auth;
        const guildContext = request.guildContext;

        if (!auth || !guildContext) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        }

        const updated = await guildApp.repository.upsertFeatureFlag({
          guildDiscordId: params.guildId,
          featureKey: params.featureKey,
          enabled: body.enabled,
          configJson: body.config,
          expectedVersion: body.expectedVersion,
        });

        const audit = await guildApp.repository.createAuditLog({
          guildId: guildContext.guild.id,
          actorUserId: auth.userId,
          actorType: actorTypeForRequest(request),
          action: "feature.updated",
          entityType: "feature_flag",
          entityId: updated.current.id,
          before: (updated.previous as unknown as Record<string, unknown> | undefined) ?? null,
          after: updated.current as unknown as Record<string, unknown>,
          metadata: { featureKey: params.featureKey },
        });

        await guildApp.jobs.enqueueFeatureUpdate({
          guildDiscordId: params.guildId,
          featureKey: params.featureKey,
          actorUserId: auth.userId,
        });

        return {
          feature: updated.current,
          auditLogId: audit.id,
        };
      },
    );

    guildApp.patch(
      "/:guildId/commands/:commandKey",
      {
        preHandler: [requireCsrf, requireRole("ADMIN")],
      },
      async (request) => {
        const params = commandParamsSchema.parse(request.params);
        const body = updateCommandPermissionBodySchema.parse(request.body);
        const auth = request.auth;
        const guildContext = request.guildContext;

        if (!auth || !guildContext) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        }

        const updated = await guildApp.repository.upsertCommandPermission({
          guildDiscordId: params.guildId,
          commandKey: params.commandKey,
          minRole: body.minRole,
          allowChannels: body.allowChannels,
          denyChannels: body.denyChannels,
        });

        const audit = await guildApp.repository.createAuditLog({
          guildId: guildContext.guild.id,
          actorUserId: auth.userId,
          actorType: actorTypeForRequest(request),
          action: "command_permission.updated",
          entityType: "command_permission",
          entityId: updated.current.id,
          before: (updated.previous as unknown as Record<string, unknown> | undefined) ?? null,
          after: updated.current as unknown as Record<string, unknown>,
          metadata: { commandKey: params.commandKey },
        });

        return {
          commandPermission: updated.current,
          auditLogId: audit.id,
        };
      },
    );

    guildApp.get("/:guildId/members", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const query = paginationQuerySchema.parse(request.query ?? {});
      return guildApp.repository.listGuildMembers(params.guildId, query.limit, query.cursor);
    });

    guildApp.put(
      "/:guildId/roles/:userId",
      {
        preHandler: [requireCsrf, requireRole("ADMIN")],
      },
      async (request) => {
        const params = memberParamsSchema.parse(request.params);
        const body = updateGuildMemberRoleBodySchema.parse(request.body);
        const auth = request.auth;
        const guildContext = request.guildContext;
        if (!auth || !guildContext) {
          throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
        }

        const actorRole = guildContext.membership.tenantRole;
        if (body.tenantRole === "OWNER" && actorRole !== "OWNER" && auth.platformRole !== "PLATFORM_ADMIN") {
          throw new ApiError(403, "OWNER_ASSIGN_FORBIDDEN", "Only OWNER can assign OWNER role.");
        }

        const update = await guildApp.repository.updateGuildMemberRole({
          guildDiscordId: params.guildId,
          targetUserId: params.userId,
          role: body.tenantRole,
        });

        if (!update) {
          throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Guild membership not found.");
        }

        const audit = await guildApp.repository.createAuditLog({
          guildId: update.guild.id,
          actorUserId: auth.userId,
          actorType: actorTypeForRequest(request),
          action: "member.role.updated",
          entityType: "guild_member",
          entityId: `${update.after.guildId}:${update.after.userId}`,
          before: update.before as unknown as Record<string, unknown>,
          after: update.after as unknown as Record<string, unknown>,
        });

        return { membership: update.after, auditLogId: audit.id };
      },
    );

    guildApp.get("/:guildId/audit-logs", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const query = auditLogsQuerySchema.parse(request.query ?? {});
      return guildApp.repository.listAuditLogs({
        guildDiscordId: params.guildId,
        cursor: query.cursor,
        limit: query.limit,
        actorUserId: query.actorUserId,
        action: query.action,
        from: query.from,
        to: query.to,
      });
    });

    guildApp.get("/:guildId/jobs", async (request) => {
      const params = guildParamsSchema.parse(request.params);
      const query = jobRunsQuerySchema.parse(request.query ?? {});
      return guildApp.repository.listJobRuns({
        guildDiscordId: params.guildId,
        cursor: query.cursor,
        limit: query.limit,
        status: query.status,
      });
    });
  };

  await app.register(guildPlugin, { prefix: "/guilds" });
}
