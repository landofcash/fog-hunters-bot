import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  SESSION_COOKIE_NAME: z.string().default("fhaibot_session"),
  SESSION_SECRET: z.string().min(32).default("change_this_to_a_long_random_secret_32_chars_min"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  CSRF_COOKIE_NAME: z.string().default("fhaibot_csrf"),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_REDIRECT_URI: z.string().url().optional(),
  DISCORD_API_BASE: z.string().url().default("https://discord.com/api"),
  DISCORD_BOT_SCOPE: z.string().default("identify guilds"),
  MOCK_DISCORD_OAUTH: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  PLATFORM_ADMIN_DISCORD_IDS: z.string().optional(),
  PGBOSS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  INTERNAL_API_KEY: z.string().min(16).default("dev_internal_api_key_change_me"),
  LLM_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  LLM_PROVIDER: z.enum(["openai"]).default("openai"),
  LLM_DEFAULT_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(4000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(512),
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  LLM_GLOBAL_KILL_SWITCH: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl?: string;
  sessionCookieName: string;
  sessionSecret: string;
  sessionTtlHours: number;
  csrfCookieName: string;
  discordClientId?: string;
  discordClientSecret?: string;
  discordRedirectUri?: string;
  discordApiBase: string;
  discordBotScope: string;
  mockDiscordOauth: boolean;
  platformAdminDiscordIds: Set<string>;
  pgBossEnabled: boolean;
  internalApiKey: string;
  llmEnabled: boolean;
  llmProvider: "openai";
  llmDefaultModel: string;
  openAiApiKey?: string;
  llmMaxInputChars: number;
  llmMaxOutputTokens: number;
  llmRequestTimeoutMs: number;
  llmGlobalKillSwitch: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    sessionSecret: parsed.SESSION_SECRET,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    csrfCookieName: parsed.CSRF_COOKIE_NAME,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordClientSecret: parsed.DISCORD_CLIENT_SECRET,
    discordRedirectUri: parsed.DISCORD_REDIRECT_URI,
    discordApiBase: parsed.DISCORD_API_BASE,
    discordBotScope: parsed.DISCORD_BOT_SCOPE,
    mockDiscordOauth: parsed.MOCK_DISCORD_OAUTH ?? false,
    platformAdminDiscordIds: new Set(
      (parsed.PLATFORM_ADMIN_DISCORD_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    pgBossEnabled: parsed.PGBOSS_ENABLED ?? false,
    internalApiKey: parsed.INTERNAL_API_KEY,
    llmEnabled: parsed.LLM_ENABLED ?? true,
    llmProvider: parsed.LLM_PROVIDER,
    llmDefaultModel: parsed.LLM_DEFAULT_MODEL,
    openAiApiKey: parsed.OPENAI_API_KEY,
    llmMaxInputChars: parsed.LLM_MAX_INPUT_CHARS,
    llmMaxOutputTokens: parsed.LLM_MAX_OUTPUT_TOKENS,
    llmRequestTimeoutMs: parsed.LLM_REQUEST_TIMEOUT_MS,
    llmGlobalKillSwitch: parsed.LLM_GLOBAL_KILL_SWITCH ?? false,
  };
}
