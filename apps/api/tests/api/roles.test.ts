import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedAgent, createTestApp } from "../helpers/test-app";

describe("role enforcement", () => {
  let closeApp: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeApp) await closeApp();
    closeApp = undefined;
  });

  it("prevents MODERATOR from changing roles", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const guild = repo.seedGuild("guild-role-1", "Guild Role 1");

    const actor = await createAuthenticatedAgent(app, "discord_actor_mod");
    const target = await createAuthenticatedAgent(app, "discord_target_user");

    repo.seedMembership({ guildId: guild.id, userId: actor.userId, tenantRole: "MODERATOR" });
    repo.seedMembership({ guildId: guild.id, userId: target.userId, tenantRole: "USER" });

    const response = await actor.agent
      .put(`/api/v1/guilds/${guild.discordGuildId}/roles/${target.userId}`)
      .set("x-csrf-token", actor.csrfToken)
      .send({ tenantRole: "ADMIN" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INSUFFICIENT_ROLE");
  });

  it("prevents demoting the last owner", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const guild = repo.seedGuild("guild-role-2", "Guild Role 2");

    const owner = await createAuthenticatedAgent(app, "discord_owner");
    repo.seedMembership({ guildId: guild.id, userId: owner.userId, tenantRole: "OWNER" });

    const response = await owner.agent
      .put(`/api/v1/guilds/${guild.discordGuildId}/roles/${owner.userId}`)
      .set("x-csrf-token", owner.csrfToken)
      .send({ tenantRole: "ADMIN" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("LAST_OWNER_PROTECTED");

    const membership = await repo.ensureGuildMembership(guild.discordGuildId, owner.userId);
    expect(membership?.membership.tenantRole).toBe("OWNER");
  });

  it("allows an owner demotion when another active owner remains", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const guild = repo.seedGuild("guild-role-3", "Guild Role 3");

    const firstOwner = await createAuthenticatedAgent(app, "discord_owner_one");
    const secondOwner = await createAuthenticatedAgent(app, "discord_owner_two");
    repo.seedMembership({ guildId: guild.id, userId: firstOwner.userId, tenantRole: "OWNER" });
    repo.seedMembership({ guildId: guild.id, userId: secondOwner.userId, tenantRole: "OWNER" });

    const response = await firstOwner.agent
      .put(`/api/v1/guilds/${guild.discordGuildId}/roles/${firstOwner.userId}`)
      .set("x-csrf-token", firstOwner.csrfToken)
      .send({ tenantRole: "ADMIN" });

    expect(response.status).toBe(200);
    expect(response.body.membership.tenantRole).toBe("ADMIN");
  });
});
