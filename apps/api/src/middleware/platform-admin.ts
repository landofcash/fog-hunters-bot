import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../lib/errors";

export async function requirePlatformAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.auth) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
  }
  if (request.auth.platformRole !== "PLATFORM_ADMIN") {
    throw new ApiError(403, "PLATFORM_ADMIN_REQUIRED", "Platform administrator access required.");
  }
}
