import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { ApiError } from "../lib/errors";

const RATE_LIMIT_WINDOW = "1 minute";

function isInternalRoute(request: FastifyRequest): boolean {
  const pathname = request.url.split("?", 1)[0] ?? "";
  return pathname === "/api/v1/internal" || pathname.startsWith("/api/v1/internal/");
}

function rateLimitError(scope: string, retryAfterSeconds: number): ApiError {
  return new ApiError(
    429,
    "RATE_LIMIT_EXCEEDED",
    `Rate limit exceeded for ${scope}.`,
    { retryAfterSeconds, scope },
  );
}

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(import("@fastify/rate-limit"), {
    max: 120,
    timeWindow: RATE_LIMIT_WINDOW,
    skipOnError: true,
    allowList: isInternalRoute,
    errorResponseBuilder: (_request, context) =>
      rateLimitError("public API traffic", Math.ceil(context.ttl / 1_000)),
  });
}

type InternalRateLimitHook = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface InternalRateLimiters {
  authenticationFailure: InternalRateLimitHook;
  botAuthenticationAttempt: InternalRateLimitHook;
  pool: InternalRateLimitHook;
  bot: InternalRateLimitHook;
}

export function createInternalRateLimiters(app: FastifyInstance): InternalRateLimiters {
  const authenticationFailureLimit = app.createRateLimit({
    max: app.appConfig.internalAuthFailureRateLimitMax,
    timeWindow: RATE_LIMIT_WINDOW,
    allowList: [],
    keyGenerator: (request) => `internal-auth-failure:${request.ip}`,
  });
  const botAuthenticationAttemptLimit = app.createRateLimit({
    max: app.appConfig.internalBotAuthAttemptRateLimitMax,
    timeWindow: RATE_LIMIT_WINDOW,
    allowList: [],
    keyGenerator: (request) => `internal-bot-auth-attempt:${request.ip}`,
  });
  const poolLimit = app.createRateLimit({
    max: app.appConfig.internalPoolRateLimitMax,
    timeWindow: RATE_LIMIT_WINDOW,
    allowList: [],
    keyGenerator: () => `internal-pool:${app.appConfig.botPoolBootstrapKeyHash}`,
  });
  const botLimit = app.createRateLimit({
    max: app.appConfig.internalBotRateLimitMax,
    timeWindow: RATE_LIMIT_WINDOW,
    allowList: [],
    keyGenerator: (request) => {
      if (!request.botLeaseContext) {
        throw new ApiError(
          500,
          "BOT_LEASE_CONTEXT_MISSING",
          "Validated bot lease context is required before rate limiting.",
        );
      }
      return `internal-bot:${request.botLeaseContext.bot.id}`;
    },
  });

  const enforce = (
    limiter: ReturnType<FastifyInstance["createRateLimit"]>,
    scope: string,
  ): InternalRateLimitHook => async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await limiter(request);
    if (result.isAllowed) return;

    reply.header("x-ratelimit-limit", result.max);
    reply.header("x-ratelimit-remaining", result.remaining);
    reply.header("x-ratelimit-reset", result.ttlInSeconds);
    if (!result.isExceeded) return;

    reply.header("retry-after", result.ttlInSeconds);
    throw rateLimitError(scope, result.ttlInSeconds);
  };

  return {
    authenticationFailure: enforce(authenticationFailureLimit, "internal authentication failures"),
    botAuthenticationAttempt: enforce(
      botAuthenticationAttemptLimit,
      "managed bot authentication attempts",
    ),
    pool: enforce(poolLimit, "bot pool traffic"),
    bot: enforce(botLimit, "managed bot traffic"),
  };
}
