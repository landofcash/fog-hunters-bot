import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedAgent, createTestApp } from "../helpers/test-app";

describe("guild behavior", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("rejects stale feature versions without changing state or adding an audit", async () => {
    const { app, repo } = await createTestApp();
    closers.push(() => app.close());
    const guild = repo.seedGuild("guild-version", "Version Guild");
    const admin = await createAuthenticatedAgent(app, "discord_version_admin");
    repo.seedMembership({ guildId: guild.id, userId: admin.userId, tenantRole: "ADMIN" });

    const created = await admin.agent
      .patch(`/api/v1/guilds/${guild.discordGuildId}/features/custom`)
      .set("x-csrf-token", admin.csrfToken)
      .send({ enabled: true, config: { mode: "first" } });
    expect(created.status).toBe(200);
    const auditCount = repo.auditLogs.length;

    const conflict = await admin.agent
      .patch(`/api/v1/guilds/${guild.discordGuildId}/features/custom`)
      .set("x-csrf-token", admin.csrfToken)
      .send({ enabled: false, config: { mode: "stale" }, expectedVersion: 99 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("FEATURE_VERSION_CONFLICT");
    expect(repo.auditLogs).toHaveLength(auditCount);

    const settings = await repo.getGuildSettings(guild.discordGuildId);
    expect(settings?.features.find((feature) => feature.featureKey === "custom")).toMatchObject({
      enabled: true,
      configJson: { mode: "first" },
      version: 1,
    });
  });

  it("applies role, deny-channel, and allow-channel command policies", async () => {
    const { app, repo } = await createTestApp();
    closers.push(() => app.close());
    const guild = repo.seedGuild("guild-policy", "Policy Guild");
    const user = await repo.upsertUserFromDiscord({ discordUserId: "policy-user", username: "policy" }, false);
    repo.seedMembership({ guildId: guild.id, userId: user.id, tenantRole: "MODERATOR" });
    await repo.upsertCommandPermission({
      guildDiscordId: guild.discordGuildId,
      commandKey: "purge",
      minRole: "MODERATOR",
      allowChannels: ["allowed", "denied"],
      denyChannels: ["denied"],
    });

    await expect(repo.checkCommandAccess({ guildDiscordId: guild.discordGuildId, commandKey: "purge", actorDiscordUserId: user.discordUserId, channelId: "allowed", defaultMinRole: "ADMIN" }))
      .resolves.toMatchObject({ allowed: true });
    await expect(repo.checkCommandAccess({ guildDiscordId: guild.discordGuildId, commandKey: "purge", actorDiscordUserId: user.discordUserId, channelId: "denied", defaultMinRole: "ADMIN" }))
      .resolves.toMatchObject({ allowed: false, reason: "CHANNEL_DENIED" });
    await expect(repo.checkCommandAccess({ guildDiscordId: guild.discordGuildId, commandKey: "purge", actorDiscordUserId: user.discordUserId, channelId: "other", defaultMinRole: "ADMIN" }))
      .resolves.toMatchObject({ allowed: false, reason: "CHANNEL_NOT_ALLOWED" });
  });

  it("paginates guild members", async () => {
    const { app, repo } = await createTestApp();
    closers.push(() => app.close());
    const guild = repo.seedGuild("guild-members", "Members Guild");
    const owner = await createAuthenticatedAgent(app, "discord_members_owner");
    repo.seedMembership({ guildId: guild.id, userId: owner.userId, tenantRole: "OWNER" });
    for (const index of [1, 2, 3]) {
      const user = await repo.upsertUserFromDiscord({ discordUserId: `member-${index}`, username: `member-${index}` }, false);
      repo.seedMembership({ guildId: guild.id, userId: user.id, tenantRole: "USER" });
    }

    const first = await owner.agent.get(`/api/v1/guilds/${guild.discordGuildId}/members`).query({ limit: 2 });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTypeOf("string");

    const second = await owner.agent.get(`/api/v1/guilds/${guild.discordGuildId}/members`).query({ limit: 2, cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextCursor).toBeUndefined();
  });
});
