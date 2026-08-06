import type { FastifyReply, FastifyRequest } from "fastify";
import { validate as isUuid } from "uuid";
import { ApiError } from "../lib/errors";
import { hashOpaqueToken, safeHashEquals } from "../modules/bots/bot-token-crypto";

function bearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function requirePoolCredential(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = bearerToken(request);
  if (
    !token
    || !safeHashEquals(
      request.server.appConfig.botPoolBootstrapKeyHash,
      hashOpaqueToken(token),
    )
  ) {
    throw new ApiError(401, "BOT_POOL_AUTH_FAILED", "Invalid bot-pool credential.");
  }
}

export async function requireBotLease(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = bearerToken(request);
  const botHeader = request.headers["x-bot-instance-id"];
  const generationHeader = request.headers["x-bot-lease-generation"];
  const botInstanceId = Array.isArray(botHeader) ? botHeader[0] : botHeader;
  const generationValue = Array.isArray(generationHeader) ? generationHeader[0] : generationHeader;
  const leaseGeneration = Number(generationValue);
  if (
    !token
    || !botInstanceId
    || !isUuid(botInstanceId)
    || !Number.isInteger(leaseGeneration)
    || leaseGeneration < 1
  ) {
    throw new ApiError(401, "BOT_LEASE_EXPIRED", "Bot lease credentials are required.");
  }
  const leaseTokenHash = hashOpaqueToken(token);
  const context = await request.server.repository.validateRuntimeLease({
    botInstanceId,
    leaseGeneration,
    leaseTokenHash,
    now: new Date(),
  });
  request.botLeaseContext = { ...context, leaseTokenHash };
}
