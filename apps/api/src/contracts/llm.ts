import { z } from "zod";

export const llmPromptOverrideSchema = z
  .string()
  .max(32_000)
  .refine((value) => value.trim().length > 0, "Prompt cannot be blank.")
  .nullable();

export const llmGuildSettingsPatchBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultModel: z.string().min(1).optional(),
    assistantPrompt: llmPromptOverrideSchema.optional(),
    gatekeeperPrompt: llmPromptOverrideSchema.optional(),
    retentionDays: z.coerce.number().int().min(1).max(3650).optional(),
    dmEnabled: z.boolean().optional(),
    maxInputChars: z.coerce.number().int().min(128).max(32000).optional(),
    maxOutputTokens: z.coerce.number().int().min(64).max(4096).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one setting must be provided.");

export const llmChannelSettingsBodySchema = z.object({
  respondOnMentionOnly: z.boolean().optional(),
});
