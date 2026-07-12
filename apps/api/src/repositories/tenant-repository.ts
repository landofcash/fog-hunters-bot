import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../lib/errors";

export class TenantRepositoryBase {
  constructor(protected readonly prisma: PrismaClient) {}

  protected async resolveGuildId(guildDiscordId: string): Promise<string> {
    const guild = await this.prisma.guild.findUnique({
      where: { discordGuildId: guildDiscordId },
      select: { id: true },
    });

    if (!guild) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }

    return guild.id;
  }
}
