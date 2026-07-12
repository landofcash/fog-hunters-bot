import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../lib/errors";
import { hashToken } from "../lib/ids";

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = request.cookies[request.server.appConfig.sessionCookieName];
  if (!token) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
  }

  const tokenHash = hashToken(token, request.server.appConfig.sessionSecret);
  const session = await request.server.repository.getSessionByTokenHash(tokenHash);
  if (!session) {
    throw new ApiError(401, "INVALID_SESSION", "Session is invalid or expired.");
  }

  request.auth = {
    userId: session.user.id,
    discordUserId: session.user.discordUserId,
    platformRole: session.user.platformRole,
    sessionTokenHash: tokenHash,
  };
}
