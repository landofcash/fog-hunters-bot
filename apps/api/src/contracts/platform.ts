import { z } from "zod";
import { reasoningEffortSchema } from "./llm";

export const platformGuildListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
});

export const platformGuildParamsSchema = z.object({
  guildId: z.string().min(1),
});

export const platformLlmPolicyPatchSchema = z
  .object({
    platformEnabled: z.boolean().optional(),
    defaultModel: z.string().min(1).optional(),
    reasoningEffort: reasoningEffortSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one policy field must be provided.");
