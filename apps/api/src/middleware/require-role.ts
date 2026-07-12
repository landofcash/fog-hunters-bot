import type { FastifyReply, FastifyRequest } from "fastify";
import type { TenantRole } from "../lib/domain";
import { ApiError } from "../lib/errors";

const roleRank: Record<TenantRole, number> = {
  USER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function requireRole(minRole: TenantRole) {
  return async function roleGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (request.auth?.platformRole === "PLATFORM_ADMIN") {
      return;
    }

    const memberRole = request.guildContext?.membership.tenantRole;
    if (!memberRole || roleRank[memberRole] < roleRank[minRole]) {
      throw new ApiError(403, "INSUFFICIENT_ROLE", "Insufficient role for this action.");
    }
  };
}
