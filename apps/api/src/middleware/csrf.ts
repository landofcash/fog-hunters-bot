import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../lib/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function requireCsrf(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (SAFE_METHODS.has(request.method)) {
    return;
  }

  const cookieName = request.server.appConfig.csrfCookieName;
  const cookieToken = request.cookies[cookieName];
  const headerToken = request.headers["x-csrf-token"];
  const normalizedHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!cookieToken || !normalizedHeader || cookieToken !== normalizedHeader) {
    throw new ApiError(403, "INVALID_CSRF_TOKEN", "Invalid CSRF token.");
  }
}
