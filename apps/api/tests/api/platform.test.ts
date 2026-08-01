import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedAgent, createTestApp } from "../helpers/test-app";

describe("platform administration", () => {
  let closeApp: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeApp) await closeApp();
    closeApp = undefined;
  });

  it("keeps model and platform AI policy changes exclusive to platform admins", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const guild = repo.seedGuild("guild-platform-policy", "Platform Policy Guild");
    const owner = await createAuthenticatedAgent(app, "discord_platform_policy_owner");
    const platform = await createAuthenticatedAgent(app, "discord_platform_operator");
    repo.seedMembership({ guildId: guild.id, userId: owner.userId, tenantRole: "OWNER" });
    const platformUser = repo.users.get(platform.userId);
    expect(platformUser).toBeDefined();
    repo.users.set(platform.userId, {
      ...platformUser!,
      platformRole: "PLATFORM_ADMIN",
    });

    const ownerDenied = await owner.agent
      .patch(`/api/v1/guilds/${guild.discordGuildId}/llm/settings`)
      .set("x-csrf-token", owner.csrfToken)
      .send({ defaultModel: "gpt-5.6-terra" });
    expect(ownerDenied.status).toBe(403);
    expect(ownerDenied.body.error.code).toBe("PLATFORM_ADMIN_REQUIRED");

    const policy = await platform.agent
      .patch(`/api/v1/platform/guilds/${guild.discordGuildId}/llm-policy`)
      .set("x-csrf-token", platform.csrfToken)
      .send({
        defaultModel: "gpt-5.6-terra",
        platformEnabled: false,
      });
    expect(policy.status).toBe(200);
    expect(policy.body).toMatchObject({
      settings: {
        defaultModel: "gpt-5.6-terra",
        platformEnabled: false,
      },
      effectiveAiEnabled: false,
    });
    expect(repo.auditLogs.at(-1)).toMatchObject({
      actorType: "PLATFORM_ADMIN",
      action: "llm.platform_policy.updated",
    });

    const ownerView = await owner.agent.get(`/api/v1/guilds/${guild.discordGuildId}/llm/settings`);
    expect(ownerView.status).toBe(200);
    expect(ownerView.body).toMatchObject({
      settings: {
        defaultModel: "gpt-5.6-terra",
        platformEnabled: false,
      },
      effectiveAiEnabled: false,
    });
  });

  it("exposes the guild directory and supported models only to platform admins", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    repo.seedGuild("guild-platform-list-a", "Alpha Guild");
    repo.seedGuild("guild-platform-list-b", "Beta Guild");
    const user = await createAuthenticatedAgent(app, "discord_regular_dashboard_user");
    const platform = await createAuthenticatedAgent(app, "discord_platform_dashboard_user");
    const platformUser = repo.users.get(platform.userId);
    repo.users.set(platform.userId, {
      ...platformUser!,
      platformRole: "PLATFORM_ADMIN",
    });

    const denied = await user.agent.get("/api/v1/platform/guilds");
    expect(denied.status).toBe(403);

    const guilds = await platform.agent.get("/api/v1/platform/guilds").query({ search: "beta" });
    expect(guilds.status).toBe(200);
    expect(guilds.body.items).toEqual([
      expect.objectContaining({
        guildId: "guild-platform-list-b",
        guildName: "Beta Guild",
      }),
    ]);

    const models = await platform.agent.get("/api/v1/platform/llm/models");
    expect(models.status).toBe(200);
    expect(models.body.items.map((item: { id: string }) => item.id)).toContain("gpt-5.6-terra");
  });
});
