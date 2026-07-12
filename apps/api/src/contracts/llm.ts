import { z } from "zod";

export const llmGuildSettingsPatchBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultModel: z.string().min(1).optional(),
    stylePrompt: z.string().max(2000).nullable().optional(),
    retentionDays: z.coerce.number().int().min(1).max(3650).optional(),
    dmEnabled: z.boolean().optional(),
    maxInputChars: z.coerce.number().int().min(128).max(32000).optional(),
    maxOutputTokens: z.coerce.number().int().min(64).max(4096).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one setting must be provided.");

export const llmChannelSettingsBodySchema = z.object({
  respondOnMentionOnly: z.boolean().optional(),
});
