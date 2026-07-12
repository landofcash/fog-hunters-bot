import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_IDS: z.string().optional(),
  API_BASE_URL: z.string().url(),
  API_INTERNAL_KEY: z.string().min(16),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  HTTP_RETRY_MAX: z.coerce.number().int().min(0).max(10).default(3),
  COMMAND_SYNC_ON_START: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export interface BotConfig {
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  discordBotToken: string;
  discordClientId: string;
  discordGuildIds: string[];
  apiBaseUrl: string;
  apiInternalKey: string;
  httpTimeoutMs: number;
  httpRetryMax: number;
  commandSyncOnStart: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = envSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    discordBotToken: parsed.DISCORD_BOT_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordGuildIds: (parsed.DISCORD_GUILD_IDS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    apiBaseUrl: parsed.API_BASE_URL.replace(/\/$/, ""),
    apiInternalKey: parsed.API_INTERNAL_KEY,
    httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
    httpRetryMax: parsed.HTTP_RETRY_MAX,
    commandSyncOnStart: parsed.COMMAND_SYNC_ON_START ?? true,
  };
}
