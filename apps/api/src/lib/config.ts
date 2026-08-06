import { z } from "zod";
import { createHash } from "node:crypto";
import { isSupportedLlmModel } from "../modules/llm/models";

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);

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
  BOT_POOL_BOOTSTRAP_KEY_HASH: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  BOT_TOKEN_ACTIVE_KEY_VERSION: z.coerce.number().int().positive().default(1),
  BOT_ASSIGNMENT_POLL_MS: z.coerce.number().int().min(1_000).default(15_000),
  BOT_HEARTBEAT_MS: z.coerce.number().int().min(1_000).default(15_000),
  BOT_LEASE_TTL_MS: z.coerce.number().int().min(30_000).default(60_000),
  INTERNAL_AUTH_FAILURE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  INTERNAL_BOT_AUTH_ATTEMPT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  INTERNAL_POOL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  INTERNAL_BOT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  LLM_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  LLM_PROVIDER: z.enum(["openai"]).default("openai"),
  LLM_DEFAULT_MODEL: z.string()
    .min(1)
    .refine(isSupportedLlmModel, "LLM_DEFAULT_MODEL must be a supported model.")
    .default("gpt-4.1-mini"),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(4000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(512),
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  LLM_GLOBAL_KILL_SWITCH: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ALERT_DISCORD_WEBHOOK_URL: optionalUrl,
  ALERT_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(300_000),
  ALERT_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
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
  botPoolBootstrapKeyHash: string;
  botTokenActiveKeyVersion: number;
  botTokenEncryptionKeys: ReadonlyMap<number, Buffer>;
  botAssignmentPollMs: number;
  botHeartbeatMs: number;
  botLeaseTtlMs: number;
  internalAuthFailureRateLimitMax: number;
  internalBotAuthAttemptRateLimitMax: number;
  internalPoolRateLimitMax: number;
  internalBotRateLimitMax: number;
  llmEnabled: boolean;
  llmProvider: "openai";
  llmDefaultModel: string;
  openAiApiKey?: string;
  llmMaxInputChars: number;
  llmMaxOutputTokens: number;
  llmRequestTimeoutMs: number;
  llmGlobalKillSwitch: boolean;
  alertDiscordWebhookUrl?: string;
  alertCooldownMs: number;
  alertRequestTimeoutMs: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(source);
  const botTokenEncryptionKeys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(source)) {
    const match = /^BOT_TOKEN_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (!match || !value) {
      continue;
    }
    const version = Number(match[1]);
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32) {
      throw new Error(`${name} must be a Base64-encoded 256-bit key.`);
    }
    botTokenEncryptionKeys.set(version, decoded);
  }

  if (botTokenEncryptionKeys.size === 0 && parsed.NODE_ENV !== "production") {
    botTokenEncryptionKeys.set(
      1,
      createHash("sha256").update("fhaibot-development-token-key").digest(),
    );
  }
  if (!botTokenEncryptionKeys.has(parsed.BOT_TOKEN_ACTIVE_KEY_VERSION)) {
    throw new Error(
      `BOT_TOKEN_ENCRYPTION_KEY_V${parsed.BOT_TOKEN_ACTIVE_KEY_VERSION} is required.`,
    );
  }

  if (!parsed.BOT_POOL_BOOTSTRAP_KEY_HASH && parsed.NODE_ENV === "production") {
    throw new Error("BOT_POOL_BOOTSTRAP_KEY_HASH is required in production.");
  }
  const botPoolBootstrapKeyHash = parsed.BOT_POOL_BOOTSTRAP_KEY_HASH
    ?? createHash("sha256").update("dev_bot_pool_bootstrap_key_change_me").digest("hex");

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
    botPoolBootstrapKeyHash,
    botTokenActiveKeyVersion: parsed.BOT_TOKEN_ACTIVE_KEY_VERSION,
    botTokenEncryptionKeys,
    botAssignmentPollMs: parsed.BOT_ASSIGNMENT_POLL_MS,
    botHeartbeatMs: parsed.BOT_HEARTBEAT_MS,
    botLeaseTtlMs: parsed.BOT_LEASE_TTL_MS,
    internalAuthFailureRateLimitMax: parsed.INTERNAL_AUTH_FAILURE_RATE_LIMIT_MAX,
    internalBotAuthAttemptRateLimitMax: parsed.INTERNAL_BOT_AUTH_ATTEMPT_RATE_LIMIT_MAX,
    internalPoolRateLimitMax: parsed.INTERNAL_POOL_RATE_LIMIT_MAX,
    internalBotRateLimitMax: parsed.INTERNAL_BOT_RATE_LIMIT_MAX,
    llmEnabled: parsed.LLM_ENABLED ?? true,
    llmProvider: parsed.LLM_PROVIDER,
    llmDefaultModel: parsed.LLM_DEFAULT_MODEL,
    openAiApiKey: parsed.OPENAI_API_KEY,
    llmMaxInputChars: parsed.LLM_MAX_INPUT_CHARS,
    llmMaxOutputTokens: parsed.LLM_MAX_OUTPUT_TOKENS,
    llmRequestTimeoutMs: parsed.LLM_REQUEST_TIMEOUT_MS,
    llmGlobalKillSwitch: parsed.LLM_GLOBAL_KILL_SWITCH ?? false,
    alertDiscordWebhookUrl: parsed.ALERT_DISCORD_WEBHOOK_URL,
    alertCooldownMs: parsed.ALERT_COOLDOWN_MS,
    alertRequestTimeoutMs: parsed.ALERT_REQUEST_TIMEOUT_MS,
  };
}
