import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedAgent, createTestApp } from "../helpers/test-app";

describe("guild isolation", () => {
  let closeApp: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeApp) await closeApp();
    closeApp = undefined;
  });

  it("blocks user from reading another guild's settings", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();

    const guildA = repo.seedGuild("guild-a", "Guild A");
    const guildB = repo.seedGuild("guild-b", "Guild B");
    const auth = await createAuthenticatedAgent(app, "discord_user_a");
    repo.seedMembership({ guildId: guildA.id, userId: auth.userId, tenantRole: "ADMIN" });

    const response = await auth.agent.get("/api/v1/guilds/guild-b/settings");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("GUILD_ACCESS_DENIED");

    const allowed = await auth.agent.get("/api/v1/guilds/guild-a/settings");
    expect(allowed.status).toBe(200);
    expect(allowed.body.guild.discordGuildId).toBe("guild-a");
    expect(allowed.body.guild.id).toBe(guildA.id);
    expect(guildB.id).not.toBe(guildA.id);
  });
});
