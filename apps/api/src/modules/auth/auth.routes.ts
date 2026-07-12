import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { discordCallbackQuerySchema } from "../../contracts/auth";
import { ApiError } from "../../lib/errors";
import { requireAuth } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { AuthService } from "./auth.service";

const loginQuerySchema = z.object({
  state: z.string().optional(),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const authService = new AuthService(app.appConfig, app.repository);

  app.get("/auth/discord/login", async (request) => {
    const query = loginQuerySchema.parse(request.query ?? {});
    const state = query.state ?? "dashboard";
    const url = authService.getDiscordAuthorizeUrl(state);
    return { url };
  });

  app.get("/auth/discord/callback", async (request, reply) => {
    const query = discordCallbackQuerySchema.parse(request.query ?? {});
    const session = await authService.createSession({
      code: query.code,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    reply.setCookie(app.appConfig.sessionCookieName, session.sessionToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: app.appConfig.nodeEnv === "production",
    });
    reply.setCookie(app.appConfig.csrfCookieName, session.csrfToken, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      secure: app.appConfig.nodeEnv === "production",
    });

    return {
      authenticated: true,
      userId: session.userId,
      discordUserId: session.discordUserId,
    };
  });

  app.post(
    "/auth/logout",
    {
      preHandler: [requireAuth, requireCsrf],
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
      }

      await app.repository.deleteSessionByTokenHash(request.auth.sessionTokenHash);
      reply.clearCookie(app.appConfig.sessionCookieName, { path: "/" });
      reply.clearCookie(app.appConfig.csrfCookieName, { path: "/" });

      return { loggedOut: true };
    },
  );
}
