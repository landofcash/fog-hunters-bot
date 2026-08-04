import { hostname } from "node:os";
import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_BASE_URL: z.string().url(),
  BOT_POOL_BOOTSTRAP_KEY: z.string().min(32),
  RUNTIME_INSTANCE_ID: z.string().min(1).max(200).optional(),
  ASSIGNMENT_POLL_MS: z.coerce.number().int().min(1_000).default(15_000),
  LEASE_SAFETY_MARGIN_MS: z.coerce.number().int().min(5_000).default(20_000),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  HTTP_RETRY_MAX: z.coerce.number().int().min(0).max(10).default(3),
  LOGIN_RETRY_MAX: z.coerce.number().int().min(0).max(10).default(5),
  LOGIN_RETRY_BASE_MS: z.coerce.number().int().positive().default(2_000),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
  ALERT_DISCORD_WEBHOOK_URL: optionalUrl,
  ALERT_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(300_000),
  ALERT_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
});

export interface BotConfig {
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  apiBaseUrl: string;
  poolBootstrapKey: string;
  runtimeInstanceId: string;
  assignmentPollMs: number;
  leaseSafetyMarginMs: number;
  httpTimeoutMs: number;
  httpRetryMax: number;
  loginRetryMax: number;
  loginRetryBaseMs: number;
  port: number;
  alertDiscordWebhookUrl?: string;
  alertCooldownMs: number;
  alertRequestTimeoutMs: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = envSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    apiBaseUrl: parsed.API_BASE_URL.replace(/\/$/, ""),
    poolBootstrapKey: parsed.BOT_POOL_BOOTSTRAP_KEY,
    runtimeInstanceId: parsed.RUNTIME_INSTANCE_ID ?? `${hostname()}:${process.pid}`,
    assignmentPollMs: parsed.ASSIGNMENT_POLL_MS,
    leaseSafetyMarginMs: parsed.LEASE_SAFETY_MARGIN_MS,
    httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
    httpRetryMax: parsed.HTTP_RETRY_MAX,
    loginRetryMax: parsed.LOGIN_RETRY_MAX,
    loginRetryBaseMs: parsed.LOGIN_RETRY_BASE_MS,
    port: parsed.PORT,
    alertDiscordWebhookUrl: parsed.ALERT_DISCORD_WEBHOOK_URL,
    alertCooldownMs: parsed.ALERT_COOLDOWN_MS,
    alertRequestTimeoutMs: parsed.ALERT_REQUEST_TIMEOUT_MS,
  };
}
