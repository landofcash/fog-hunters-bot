import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, PoolApiClient } from "../src/api/client";
import { ApiClientError } from "../src/runtime/errors";
import { createBotConfig, createLoggerMock } from "./helpers/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ApiClient", () => {
  function createLeaseClient(config = createBotConfig()) {
    return new ApiClient(config, createLoggerMock(), {
      botInstanceId: "bot-instance-1",
      leaseGeneration: 7,
      leaseToken: "opaque-lease-token",
    });
  }

  it("sends bot lease authentication and maps request payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ shouldRespond: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createLeaseClient();
    await client.respondWithLlm({ guildId: "guild-1", channelId: "channel-1", discordUserId: "user-1", content: "hello", isDm: false, botWasMentioned: false });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/internal/llm/respond");
    expect(request.headers).toMatchObject({
      authorization: "Bearer opaque-lease-token",
      "x-bot-instance-id": "bot-instance-1",
      "x-bot-lease-generation": "7",
    });
    expect(JSON.parse(String(request.body))).toMatchObject({ guildId: "guild-1", content: "hello" });
  });

  it("maps admin management requests to protected internal endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ changed: true, membership: { tenantRole: "ADMIN" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createLeaseClient();
    const target = { discordUserId: "target-1", username: "target" };

    await client.addGuildAdmin({
      guildId: "guild-1",
      actorDiscordUserId: "owner-1",
      channelId: "channel-1",
      target,
    });
    await client.removeGuildAdmin({
      guildId: "guild-1",
      actorDiscordUserId: "owner-1",
      channelId: "channel-1",
      target,
    });
    await client.listGuildAdmins({
      guildId: "guild-1",
      actorDiscordUserId: "owner-1",
      channelId: "channel-1",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.test/api/v1/internal/guilds/guild-1/admins/add",
      "https://api.test/api/v1/internal/guilds/guild-1/admins/remove",
      "https://api.test/api/v1/internal/guilds/guild-1/admins/list",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      actorDiscordUserId: "owner-1",
      channelId: "channel-1",
      target,
    });
  });

  it("normalizes settings mutation responses with installation metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      installation: {
        guildId: "internal-guild-1",
        guildName: "Guild One",
        presenceStatus: "PRESENT",
        operationalStatus: "ENABLED",
      },
      settings: {
        llmEnabledByGuild: true,
        llmEnabledByPlatform: true,
      },
      effective: {
        model: "gpt-test",
        assistantPrompt: null,
        gatekeeperPrompt: null,
        retentionDays: 45,
        maxInputChars: 4_000,
        maxOutputTokens: 512,
        dmEnabled: true,
      },
      effectiveAiEnabled: false,
      effectivePrompts: {
        assistant: "Default assistant",
        gatekeeper: "Fixed contract\nDefault rules",
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createLeaseClient();

    const result = await client.patchLlmGuildSettings({
      guildId: "guild-1",
      actorDiscordUserId: "admin-1",
      commandKey: "ai.retention",
      patch: { retentionDays: 45 },
    });

    expect(result).toMatchObject({
      guild: { id: "internal-guild-1", name: "Guild One" },
      settings: { retentionDays: 45 },
      effectiveAiEnabled: false,
      effectivePrompts: {
        assistant: "Default assistant",
        gatekeeper: "Fixed contract\nDefault rules",
      },
    });
  });

  it("returns structured API errors without retrying 4xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "COMMAND_ACCESS_DENIED", message: "Denied", details: { reason: "ROLE_TOO_LOW" } } }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createLeaseClient();
    const error = await client.readGuildSettings({ guildId: "guild-1", actorDiscordUserId: "user-1" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ statusCode: 403, code: "COMMAND_ACCESS_DENIED", details: { reason: "ROLE_TOO_LOW" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry rate-limit responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded for managed bot traffic.",
      },
    }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createLeaseClient(createBotConfig({ httpRetryMax: 3 }));

    await expect(client.pendingCommandManifests()).rejects.toMatchObject({
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network and server failures up to the configured limit", async () => {
    const logger = createLoggerMock();
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ touched: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(createBotConfig({ httpRetryMax: 2 }), logger, {
      botInstanceId: "bot-instance-1",
      leaseGeneration: 7,
      leaseToken: "opaque-lease-token",
    });
    await client.touchUser({ discordUserId: "user-1", username: "user" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("surfaces the final error after retry exhaustion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createLeaseClient(createBotConfig({ httpRetryMax: 1 }));
    await expect(client.touchUser({ discordUserId: "user-1", username: "user" })).rejects.toMatchObject({ statusCode: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts timed-out requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, request: RequestInit) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    const client = createLeaseClient(createBotConfig({ httpTimeoutMs: 10, httpRetryMax: 0 }));
    const result = client.touchUser({ discordUserId: "user-1", username: "user" });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
  });

  it("uses the pool credential only for assignment and claim requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], pollAfterMs: 15_000 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = createBotConfig();
    const client = new PoolApiClient(config, createLoggerMock());

    await client.listAssignments();

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/internal/runtime/assignments");
    expect(request.headers).toMatchObject({
      authorization: `Bearer ${config.poolBootstrapKey}`,
    });
    expect(request.headers).not.toHaveProperty("x-bot-instance-id");
  });
});
