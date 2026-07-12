import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../lib/errors";

export async function requireInternalApiKey(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const provided = request.headers["x-internal-key"];
  const providedKey = Array.isArray(provided) ? provided[0] : provided;
  if (!providedKey || providedKey !== request.server.appConfig.internalApiKey) {
    throw new ApiError(401, "INTERNAL_AUTH_FAILED", "Invalid internal API key.");
  }
}
