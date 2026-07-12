import { z } from "zod";

export const internalBootstrapBodySchema = z.object({
  guildName: z.string().min(1),
  owner: z
    .object({
      discordUserId: z.string().min(1),
      username: z.string().min(1),
      globalName: z.string().nullable().optional(),
      avatarUrl: z.string().nullable().optional(),
    })
    .optional(),
});

export const internalUserTouchBodySchema = z.object({
  discordUserId: z.string().min(1),
  username: z.string().min(1),
  globalName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export const internalSettingsReadBodySchema = z.object({
  actorDiscordUserId: z.string().min(1),
  commandKey: z.string().min(1).default("settings.view"),
  channelId: z.string().optional(),
});

export const internalLlmRespondBodySchema = z.object({
  guildId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  discordUserId: z.string().min(1),
  content: z.string().min(1).max(8000),
  messageId: z.string().optional(),
  isDm: z.boolean().default(false),
  botWasMentioned: z.boolean().default(false),
});

export const internalLlmSettingsReadBodySchema = z.object({
  actorDiscordUserId: z.string().min(1),
  channelId: z.string().optional(),
  commandKey: z.string().min(1).default("ai.status"),
});

export const internalLlmSettingsPatchBodySchema = z.object({
  actorDiscordUserId: z.string().min(1),
  channelId: z.string().optional(),
  commandKey: z.string().min(1).default("ai.style"),
  enabled: z.boolean().optional(),
  defaultModel: z.string().min(1).optional(),
  stylePrompt: z.string().max(2000).nullable().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  dmEnabled: z.boolean().optional(),
  maxInputChars: z.number().int().min(128).max(32000).optional(),
  maxOutputTokens: z.number().int().min(64).max(4096).optional(),
});

export const internalLlmChannelToggleBodySchema = z.object({
  actorDiscordUserId: z.string().min(1),
  channelId: z.string().min(1),
  commandKey: z.string().min(1),
  respondOnMentionOnly: z.boolean().optional(),
});

export const internalLlmMemoryClearBodySchema = z.object({
  actorDiscordUserId: z.string().min(1),
  channelId: z.string().min(1),
  commandKey: z.string().min(1).default("ai.memory.clear"),
});
