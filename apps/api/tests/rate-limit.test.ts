import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config";
import { isApiError } from "../src/lib/errors";
import {
  createInternalRateLimiters,
  registerRateLimit,
} from "../src/plugins/rate-limit";

const apps: FastifyInstance[] = [];

function installApiErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (isApiError(error)) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
      return;
    }
    reply.status(500).send({ error: { code: "INTERNAL_SERVER_ERROR" } });
  });
}

async function createApp(overrides: NodeJS.ProcessEnv = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const config = loadConfig({
    NODE_ENV: "test",
    INTERNAL_AUTH_FAILURE_RATE_LIMIT_MAX: "2",
    INTERNAL_POOL_RATE_LIMIT_MAX: "2",
    INTERNAL_BOT_RATE_LIMIT_MAX: "2",
    ...overrides,
  });
  app.decorate("appConfig", config);
  await registerRateLimit(app);
  installApiErrorHandler(app);
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("API rate limiting", () => {
  it("keeps public traffic in the shared IP bucket and preserves 429 responses", async () => {
    const app = await createApp();
    app.get("/api/v1/public-test", async () => ({ ok: true }));
    await app.ready();

    for (let index = 0; index < 120; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/public-test",
        remoteAddress: "10.0.0.1",
      });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: "GET",
      url: "/api/v1/public-test",
      remoteAddress: "10.0.0.1",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: { code: "RATE_LIMIT_EXCEEDED" },
    });
  });

  it("does not charge internal routes to the public IP bucket", async () => {
    const app = await createApp();
    app.get("/api/v1/internal/test", async () => ({ ok: true }));
    await app.ready();

    for (let index = 0; index < 121; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/internal/test",
        remoteAddress: "10.0.0.2",
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it("uses independent authenticated buckets for bots sharing one IP", async () => {
    const app = await createApp();
    const limits = createInternalRateLimiters(app);
    const authenticateBot = async (
      request: FastifyRequest,
      _reply: FastifyReply,
    ): Promise<void> => {
      const botId = String(request.headers["x-test-bot-id"]);
      request.botLeaseContext = {
        bot: { id: botId } as NonNullable<FastifyRequest["botLeaseContext"]>["bot"],
        lease: {} as NonNullable<FastifyRequest["botLeaseContext"]>["lease"],
        leaseTokenHash: "test",
      };
    };
    app.get("/api/v1/internal/bot-test", {
      preHandler: [authenticateBot, limits.bot],
    }, async () => ({ ok: true }));
    await app.ready();

    for (const botId of ["bot-1", "bot-2"]) {
      for (let index = 0; index < 2; index += 1) {
        const response = await app.inject({
          method: "GET",
          url: "/api/v1/internal/bot-test",
          headers: { "x-test-bot-id": botId },
          remoteAddress: "10.0.0.3",
        });
        expect(response.statusCode).toBe(200);
      }
    }

    const limitedBotOne = await app.inject({
      method: "GET",
      url: "/api/v1/internal/bot-test",
      headers: { "x-test-bot-id": "bot-1" },
      remoteAddress: "10.0.0.3",
    });
    expect(limitedBotOne.statusCode).toBe(429);

    const independentBotTwo = await app.inject({
      method: "GET",
      url: "/api/v1/internal/bot-test",
      headers: { "x-test-bot-id": "bot-2" },
      remoteAddress: "10.0.0.3",
    });
    expect(independentBotTwo.statusCode).toBe(429);
  });

  it("limits repeated internal authentication failures by source IP", async () => {
    const app = await createApp();
    const limits = createInternalRateLimiters(app);
    app.get("/api/v1/internal/auth-test", {
      preHandler: [limits.authenticationFailure],
    }, async () => ({ ok: true }));
    await app.ready();

    for (let index = 0; index < 2; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/internal/auth-test",
        remoteAddress: "10.0.0.4",
      });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: "GET",
      url: "/api/v1/internal/auth-test",
      remoteAddress: "10.0.0.4",
    });
    expect(limited.statusCode).toBe(429);
  });
});
