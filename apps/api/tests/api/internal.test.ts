import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/test-app";

describe("internal bot integration routes", () => {
  let closeApp: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeApp) await closeApp();
    closeApp = undefined;
  });

  it("bootstraps guild and allows owner to read settings via internal endpoint", async () => {
    const { app } = await createTestApp();
    closeApp = () => app.close();

    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/internal/guilds/guild-internal/bootstrap",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        guildName: "Guild Internal",
        owner: {
          discordUserId: "discord_owner_1",
          username: "owner_1",
        },
      },
    });

    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().guildCreated).toBe(true);

    const settings = await app.inject({
      method: "POST",
      url: "/api/v1/internal/guilds/guild-internal/settings/read",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        actorDiscordUserId: "discord_owner_1",
        commandKey: "settings.view",
      },
    });

    expect(settings.statusCode).toBe(200);
    expect(settings.json().guild.discordGuildId).toBe("guild-internal");
  });

  it("denies internal settings read when actor has no guild membership", async () => {
    const { app } = await createTestApp();
    closeApp = () => app.close();

    await app.inject({
      method: "POST",
      url: "/api/v1/internal/guilds/guild-internal-2/bootstrap",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        guildName: "Guild Internal 2",
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/internal/interactions/user-touch",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        discordUserId: "discord_random_user",
        username: "random",
      },
    });

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/internal/guilds/guild-internal-2/settings/read",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        actorDiscordUserId: "discord_random_user",
        commandKey: "settings.view",
      },
    });

    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("COMMAND_ACCESS_DENIED");
  });

  it("lets a platform administrator manage admins in any guild through Discord commands", async () => {
    const { app, repo, config } = await createTestApp();
    closeApp = () => app.close();
    const headers = { "x-internal-key": "test_internal_api_key" };
    const guildId = "guild-platform-discord-admin";
    const platformDiscordUserId = "discord_platform_command_admin";
    const targetDiscordUserId = "discord_platform_managed_admin";
    config.platformAdminDiscordIds.add(platformDiscordUserId);

    await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/bootstrap`,
      headers,
      payload: {
        guildName: "Platform Command Guild",
        owner: {
          discordUserId: "discord_other_guild_owner",
          username: "other_guild_owner",
        },
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/internal/interactions/user-touch",
      headers,
      payload: {
        discordUserId: platformDiscordUserId,
        username: "platform_command_admin",
      },
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/add`,
      headers,
      payload: {
        actorDiscordUserId: platformDiscordUserId,
        channelId: "platform-admin-channel",
        target: {
          discordUserId: targetDiscordUserId,
          username: "platform_managed_admin",
        },
      },
    });

    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({
      changed: true,
      membership: { tenantRole: "ADMIN", status: "ACTIVE" },
    });
    expect(repo.auditLogs.at(-1)).toMatchObject({
      actorType: "PLATFORM_ADMIN",
      action: "member.admin.added",
    });

    const removed = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/remove`,
      headers,
      payload: {
        actorDiscordUserId: platformDiscordUserId,
        target: {
          discordUserId: targetDiscordUserId,
          username: "platform_managed_admin",
        },
      },
    });

    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({
      changed: true,
      membership: { tenantRole: "USER" },
    });
    expect(repo.auditLogs.at(-1)).toMatchObject({
      actorType: "PLATFORM_ADMIN",
      action: "member.admin.removed",
    });
  });

  it("lets the owner manage admins while admins can only list them", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const headers = { "x-internal-key": "test_internal_api_key" };
    const guildId = "guild-admin-management";
    const ownerDiscordUserId = "discord_admin_owner";
    const adminDiscordUserId = "discord_new_admin";

    await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/bootstrap`,
      headers,
      payload: {
        guildName: "Admin Management Guild",
        owner: {
          discordUserId: ownerDiscordUserId,
          username: "admin_owner",
        },
      },
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/add`,
      headers,
      payload: {
        actorDiscordUserId: ownerDiscordUserId,
        channelId: "settings-channel",
        target: {
          discordUserId: adminDiscordUserId,
          username: "new_admin",
        },
      },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({
      changed: true,
      membership: { tenantRole: "ADMIN", status: "ACTIVE" },
    });
    expect(await repo.getMembershipByDiscordUser(guildId, adminDiscordUserId)).toMatchObject({
      tenantRole: "ADMIN",
    });
    expect(repo.auditLogs.at(-1)?.action).toBe("member.admin.added");

    const repeated = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/add`,
      headers,
      payload: {
        actorDiscordUserId: ownerDiscordUserId,
        target: {
          discordUserId: adminDiscordUserId,
          username: "new_admin",
        },
      },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({ changed: false, reason: "ALREADY_ADMIN" });

    const listed = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/list`,
      headers,
      payload: {
        actorDiscordUserId: adminDiscordUserId,
      },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().owners).toEqual([
      expect.objectContaining({ discordUserId: ownerDiscordUserId, tenantRole: "OWNER" }),
    ]);
    expect(listed.json().admins).toEqual([
      expect.objectContaining({ discordUserId: adminDiscordUserId, tenantRole: "ADMIN" }),
    ]);

    const adminCannotAdd = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/add`,
      headers,
      payload: {
        actorDiscordUserId: adminDiscordUserId,
        target: {
          discordUserId: "discord_other_admin",
          username: "other_admin",
        },
      },
    });
    expect(adminCannotAdd.statusCode).toBe(403);
    expect(adminCannotAdd.json().error.code).toBe("COMMAND_ACCESS_DENIED");

    const removed = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/remove`,
      headers,
      payload: {
        actorDiscordUserId: ownerDiscordUserId,
        target: {
          discordUserId: adminDiscordUserId,
          username: "new_admin",
        },
      },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({
      changed: true,
      membership: { tenantRole: "USER" },
    });
    expect(repo.auditLogs.at(-1)?.action).toBe("member.admin.removed");

    const ownerProtected = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/remove`,
      headers,
      payload: {
        actorDiscordUserId: ownerDiscordUserId,
        target: {
          discordUserId: ownerDiscordUserId,
          username: "admin_owner",
        },
      },
    });
    expect(ownerProtected.statusCode).toBe(409);
    expect(ownerProtected.json().error.code).toBe("OWNER_PROTECTED");
  });

  it("reconciles Discord ownership before authorizing admin mutations", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const headers = { "x-internal-key": "test_internal_api_key" };
    const guildId = "guild-owner-transfer";
    const bootstrapUrl = `/api/v1/internal/guilds/${guildId}/bootstrap`;

    await app.inject({
      method: "POST",
      url: bootstrapUrl,
      headers,
      payload: {
        guildName: "Ownership Transfer Guild",
        owner: {
          discordUserId: "former-owner",
          username: "former_owner",
        },
      },
    });

    const coOwner = await repo.upsertUserFromDiscord({
      discordUserId: "co-owner",
      username: "co_owner",
    }, false);
    await repo.upsertGuildMembership(guildId, coOwner.id);
    await repo.updateGuildMemberRole({
      guildDiscordId: guildId,
      targetUserId: coOwner.id,
      role: "OWNER",
    });

    await app.inject({
      method: "POST",
      url: bootstrapUrl,
      headers,
      payload: {
        guildName: "Ownership Transfer Guild",
        owner: {
          discordUserId: "former-owner",
          username: "former_owner",
        },
      },
    });
    expect(await repo.getMembershipByDiscordUser(guildId, "co-owner")).toMatchObject({
      tenantRole: "OWNER",
      status: "ACTIVE",
    });

    await app.inject({
      method: "POST",
      url: bootstrapUrl,
      headers,
      payload: {
        guildName: "Ownership Transfer Guild",
        owner: {
          discordUserId: "current-owner",
          username: "current_owner",
        },
      },
    });

    expect(await repo.getMembershipByDiscordUser(guildId, "former-owner")).toMatchObject({
      tenantRole: "USER",
      status: "ACTIVE",
    });
    expect(await repo.getMembershipByDiscordUser(guildId, "current-owner")).toMatchObject({
      tenantRole: "OWNER",
      status: "ACTIVE",
    });
    expect(await repo.getMembershipByDiscordUser(guildId, "co-owner")).toMatchObject({
      tenantRole: "OWNER",
      status: "ACTIVE",
    });

    const formerOwnerDenied = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/add`,
      headers,
      payload: {
        actorDiscordUserId: "former-owner",
        target: {
          discordUserId: "former-owner-target",
          username: "former_owner_target",
        },
      },
    });
    expect(formerOwnerDenied.statusCode).toBe(403);

    const currentOwnerAllowed = await app.inject({
      method: "POST",
      url: `/api/v1/internal/guilds/${guildId}/admins/add`,
      headers,
      payload: {
        actorDiscordUserId: "current-owner",
        target: {
          discordUserId: "current-owner-target",
          username: "current_owner_target",
        },
      },
    });
    expect(currentOwnerAllowed.statusCode).toBe(200);
    expect(currentOwnerAllowed.json()).toMatchObject({
      changed: true,
      membership: { tenantRole: "ADMIN" },
    });

    await app.inject({
      method: "POST",
      url: bootstrapUrl,
      headers,
      payload: {
        guildName: "Ownership Transfer Guild",
      },
    });
    expect(await repo.getMembershipByDiscordUser(guildId, "current-owner")).toMatchObject({
      tenantRole: "OWNER",
      status: "ACTIVE",
    });
  });

  it("supports internal LLM admin flows and respects disabled defaults", async () => {
    const { app } = await createTestApp();
    closeApp = () => app.close();

    await app.inject({
      method: "POST",
      url: "/api/v1/internal/guilds/guild-llm/bootstrap",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        guildName: "Guild LLM",
        owner: {
          discordUserId: "discord_owner_llm",
          username: "owner_llm",
        },
      },
    });

    const settings = await app.inject({
      method: "POST",
      url: "/api/v1/internal/guilds/guild-llm/llm/settings/read",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        actorDiscordUserId: "discord_owner_llm",
      },
    });

    expect(settings.statusCode).toBe(200);
    expect(settings.json().settings.enabled).toBe(false);

    const modelDenied = await app.inject({
      method: "PATCH",
      url: "/api/v1/internal/guilds/guild-llm/llm/settings",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        actorDiscordUserId: "discord_owner_llm",
        commandKey: "ai.prompt.set",
        defaultModel: "gpt-5.6-terra",
      },
    });

    expect(modelDenied.statusCode).toBe(403);
    expect(modelDenied.json().error.code).toBe("PLATFORM_ADMIN_REQUIRED");

    const disabledResponse = await app.inject({
      method: "POST",
      url: "/api/v1/internal/llm/respond",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        guildId: "guild-llm",
        channelId: "channel-1",
        discordUserId: "discord_owner_llm",
        content: "hello",
        isDm: false,
        botWasMentioned: false,
      },
    });

    expect(disabledResponse.statusCode).toBe(200);
    expect(disabledResponse.json().shouldRespond).toBe(false);
    expect(disabledResponse.json().reason).toBe("LLM_DISABLED");

    const enabled = await app.inject({
      method: "POST",
      url: "/api/v1/internal/guilds/guild-llm/llm/channels/enable",
      headers: {
        "x-internal-key": "test_internal_api_key",
      },
      payload: {
        actorDiscordUserId: "discord_owner_llm",
        channelId: "channel-1",
        commandKey: "ai.enable",
      },
    });

    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().channel.enabled).toBe(true);
  });

  it("accepts the legacy style prompt alias during rollout", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();

    await app.inject({
      method: "POST",
      url: "/api/v1/internal/guilds/guild-legacy-style/bootstrap",
      headers: { "x-internal-key": "test_internal_api_key" },
      payload: {
        guildName: "Legacy Style Guild",
        owner: {
          discordUserId: "discord_legacy_owner",
          username: "legacy_owner",
        },
      },
    });
    const guild = await repo.getGuildByDiscordId("guild-legacy-style");
    expect(guild).not.toBeNull();
    repo.commandPermissions.set(`${guild!.id}:ai.style`, {
      id: "legacy-style-policy",
      guildId: guild!.id,
      commandKey: "ai.style",
      minRole: "ADMIN",
      allowChannels: [],
      denyChannels: [],
      updatedAt: new Date(),
    });

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/v1/internal/guilds/guild-legacy-style/llm/settings",
      headers: { "x-internal-key": "test_internal_api_key" },
      payload: {
        actorDiscordUserId: "discord_legacy_owner",
        commandKey: "ai.style",
        stylePrompt: "Legacy assistant prompt",
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings.assistantPrompt).toBe("Legacy assistant prompt");
    expect(updated.json().settings).not.toHaveProperty("stylePrompt");
  });

  it("retires ai.style and bootstraps the new prompt policies", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const headers = { "x-internal-key": "test_internal_api_key" };
    const url = "/api/v1/internal/guilds/guild-policy-reconcile/bootstrap";

    await app.inject({
      method: "POST",
      url,
      headers,
      payload: { guildName: "Policy Guild" },
    });
    const guild = await repo.getGuildByDiscordId("guild-policy-reconcile");
    expect(guild).not.toBeNull();
    repo.commandPermissions.set(`${guild!.id}:ai.style`, {
      id: "retired-policy",
      guildId: guild!.id,
      commandKey: "ai.style",
      minRole: "ADMIN",
      allowChannels: [],
      denyChannels: [],
      updatedAt: new Date(),
    });

    await app.inject({
      method: "POST",
      url,
      headers,
      payload: { guildName: "Policy Guild" },
    });

    const commandKeys = Array.from(repo.commandPermissions.values())
      .filter((policy) => policy.guildId === guild!.id)
      .map((policy) => policy.commandKey);
    expect(commandKeys).not.toContain("ai.style");
    expect(commandKeys).toEqual(expect.arrayContaining([
      "settings.admin.list",
      "settings.admin.add",
      "settings.admin.remove",
      "ai.prompt.view",
      "ai.prompt.set",
      "ai.prompt.reset",
    ]));
  });
});
