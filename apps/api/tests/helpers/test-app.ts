import supertest from "supertest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app";
import type { AppConfig } from "../../src/lib/config";
import { InMemoryRepository } from "./in-memory.repository";

function parseCookieValue(setCookieHeaders: string[] | undefined, cookieName: string): string {
  const header = (setCookieHeaders ?? []).find((entry) => entry.startsWith(`${cookieName}=`));
  if (!header) {
    throw new Error(`Cookie ${cookieName} not found.`);
  }
  const firstSegment = header.split(";")[0] ?? "";
  return firstSegment.split("=").slice(1).join("=");
}

export async function createTestApp(): Promise<{
  app: FastifyInstance;
  repo: InMemoryRepository;
  config: AppConfig;
}> {
  const config: AppConfig = {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    databaseUrl: undefined,
    sessionCookieName: "fhaibot_session",
    sessionSecret: "test_secret_key_that_is_long_enough_123456",
    sessionTtlHours: 24,
    csrfCookieName: "fhaibot_csrf",
    discordClientId: "test-client",
    discordClientSecret: "test-secret",
    discordRedirectUri: "http://localhost/callback",
    discordApiBase: "https://discord.com/api",
    discordBotScope: "identify guilds",
    mockDiscordOauth: true,
    platformAdminDiscordIds: new Set(),
    pgBossEnabled: false,
    internalApiKey: "test_internal_api_key",
    llmEnabled: true,
    llmProvider: "openai",
    llmDefaultModel: "gpt-4.1-mini",
    openAiApiKey: undefined,
    llmMaxInputChars: 4000,
    llmMaxOutputTokens: 512,
    llmRequestTimeoutMs: 15000,
    llmGlobalKillSwitch: false,
  };

  const repo = new InMemoryRepository();
  const app = await buildApp({ config, repository: repo });
  await app.ready();
  return { app, repo, config };
}

export async function createAuthenticatedAgent(app: FastifyInstance, code: string): Promise<{
  agent: ReturnType<typeof supertest.agent>;
  userId: string;
  csrfToken: string;
}> {
  const agent = supertest.agent(app.server);
  const callbackResponse = await agent.get("/api/v1/auth/discord/callback").query({ code });
  const userId: string = callbackResponse.body.userId;
  const csrfToken = parseCookieValue(
    callbackResponse.headers["set-cookie"] as string[] | undefined,
    "fhaibot_csrf",
  );
  return { agent, userId, csrfToken };
}
