import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors";
import { requireAuth } from "../../middleware/auth";

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/me",
    {
      preHandler: [requireAuth],
    },
    async (request) => {
      if (!request.auth) {
        throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
      }

      const user = await app.repository.getUserById(request.auth.userId);
      if (!user) {
        throw new ApiError(401, "USER_NOT_FOUND", "Session user not found.");
      }

      const memberships = await app.repository.getUserMemberships(user.id);
      return {
        user: {
          id: user.id,
          discordUserId: user.discordUserId,
          username: user.username,
        },
        memberships,
        platformRole: user.platformRole,
      };
    },
  );
}
