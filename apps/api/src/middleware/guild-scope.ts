import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../lib/errors";

interface GuildParams {
  guildId: string;
}

export async function requireGuildScope(request: FastifyRequest<{ Params: GuildParams }>, _reply: FastifyReply): Promise<void> {
  const auth = request.auth;
  if (!auth) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
  }

  if (auth.platformRole === "PLATFORM_ADMIN") {
    const settings = await request.server.repository.getGuildSettings(request.params.guildId);
    if (!settings) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }

    request.guildContext = {
      guild: settings.guild,
      membership: {
        guildId: settings.guild.id,
        userId: auth.userId,
        tenantRole: "OWNER",
        status: "ACTIVE",
      },
    };
    return;
  }

  const context = await request.server.repository.ensureGuildMembership(request.params.guildId, auth.userId);
  if (!context) {
    const settings = await request.server.repository.getGuildSettings(request.params.guildId);
    if (!settings) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }
    throw new ApiError(403, "GUILD_ACCESS_DENIED", "You do not have access to this guild.");
  }
  request.guildContext = context;
}
