import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedAgent, createTestApp } from "../helpers/test-app";

describe("authentication and request guards", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("rejects missing sessions and invalid internal keys", async () => {
    const { app } = await createTestApp();
    closers.push(() => app.close());

    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().error.code).toBe("UNAUTHENTICATED");

    const internal = await app.inject({ method: "POST", url: "/api/v1/internal/interactions/user-touch", payload: {
      discordUserId: "user", username: "user",
    } });
    expect(internal.statusCode).toBe(401);
    expect(internal.json().error.code).toBe("INTERNAL_AUTH_FAILED");
  });

  it("requires matching CSRF tokens and invalidates sessions on logout", async () => {
    const { app, repo } = await createTestApp();
    closers.push(() => app.close());
    const auth = await createAuthenticatedAgent(app, "discord_security_user");
    const guild = repo.seedGuild("guild-security", "Security Guild");
    repo.seedMembership({ guildId: guild.id, userId: auth.userId, tenantRole: "ADMIN" });

    const missingCsrf = await auth.agent.patch(`/api/v1/guilds/${guild.discordGuildId}/features/moderation`).send({ enabled: true });
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.error.code).toBe("INVALID_CSRF_TOKEN");

    const logout = await auth.agent.post("/api/v1/auth/logout").set("x-csrf-token", auth.csrfToken);
    expect(logout.status).toBe(200);
    const afterLogout = await auth.agent.get("/api/v1/me");
    expect(afterLogout.status).toBe(401);
  });

  it("allows platform administrators to access a guild without membership", async () => {
    const { app, repo, config } = await createTestApp();
    closers.push(() => app.close());
    config.platformAdminDiscordIds.add("platform_admin");
    const guild = repo.seedGuild("guild-support", "Support Guild");
    const admin = await createAuthenticatedAgent(app, "discord_platform_admin");

    const response = await admin.agent.get(`/api/v1/guilds/${guild.discordGuildId}/settings`);
    expect(response.status).toBe(200);
    expect(response.body.guild.discordGuildId).toBe(guild.discordGuildId);
  });
});
