import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { ApiClientError } from "../src/runtime/errors";
import { createBotConfig, createLoggerMock } from "./helpers/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ApiClient", () => {
  it("sends internal authentication and maps request payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ shouldRespond: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(createBotConfig(), createLoggerMock());
    await client.respondWithLlm({ guildId: "guild-1", channelId: "channel-1", discordUserId: "user-1", content: "hello", isDm: false, botWasMentioned: false });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/internal/llm/respond");
    expect(request.headers).toMatchObject({ "x-internal-key": "internal-key-long-enough" });
    expect(JSON.parse(String(request.body))).toMatchObject({ guildId: "guild-1", content: "hello" });
  });

  it("returns structured API errors without retrying 4xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "COMMAND_ACCESS_DENIED", message: "Denied", details: { reason: "ROLE_TOO_LOW" } } }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(createBotConfig(), createLoggerMock());
    const error = await client.readGuildSettings({ guildId: "guild-1", actorDiscordUserId: "user-1" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ statusCode: 403, code: "COMMAND_ACCESS_DENIED", details: { reason: "ROLE_TOO_LOW" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network and server failures up to the configured limit", async () => {
    const logger = createLoggerMock();
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ touched: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(createBotConfig({ httpRetryMax: 2 }), logger);
    await client.touchUser({ discordUserId: "user-1", username: "user" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("surfaces the final error after retry exhaustion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(createBotConfig({ httpRetryMax: 1 }), createLoggerMock());
    await expect(client.touchUser({ discordUserId: "user-1", username: "user" })).rejects.toMatchObject({ statusCode: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts timed-out requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, request: RequestInit) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    const client = new ApiClient(createBotConfig({ httpTimeoutMs: 10, httpRetryMax: 0 }), createLoggerMock());
    const result = client.touchUser({ discordUserId: "user-1", username: "user" });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
  });
});
