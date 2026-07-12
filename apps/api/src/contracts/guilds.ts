import { z } from "zod";

export const tenantRoleSchema = z.enum(["OWNER", "ADMIN", "MODERATOR", "USER"]);
export const jobStatusSchema = z.enum(["QUEUED", "RUNNING", "FAILED", "COMPLETED", "CANCELLED"]);

export const updateFeatureFlagBodySchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).default({}),
  expectedVersion: z.number().int().positive().optional(),
});

export const updateCommandPermissionBodySchema = z.object({
  minRole: tenantRoleSchema,
  allowChannels: z.array(z.string()).default([]),
  denyChannels: z.array(z.string()).default([]),
});

export const updateGuildMemberRoleBodySchema = z.object({
  tenantRole: tenantRoleSchema,
});

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const auditLogsQuerySchema = paginationQuerySchema.extend({
  actorUserId: z.string().optional(),
  action: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const jobRunsQuerySchema = paginationQuerySchema.extend({
  status: jobStatusSchema.optional(),
});
