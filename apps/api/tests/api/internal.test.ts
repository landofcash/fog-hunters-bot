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
});
