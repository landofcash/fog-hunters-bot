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

  const context = await request.server.repository.ensureGuildMembership(request.params.guildId, auth.userId);
  if (!context) {
    const guild = await request.server.repository.getGuildByDiscordId(request.params.guildId);
    if (!guild) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }
    throw new ApiError(403, "GUILD_ACCESS_DENIED", "You do not have access to this guild.");
  }
  request.guildContext = context;
}
