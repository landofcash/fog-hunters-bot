import { afterEach, describe, expect, it, vi } from "vitest";
import { BotPoolSupervisor } from "../src/runtime/bot-pool-supervisor";
import { createBotConfig, createLoggerMock } from "./helpers/fixtures";

const runtimeMocks = vi.hoisted(() => ({
  starts: [] as string[],
  stops: [] as string[],
  instances: [] as Array<{
    botInstanceId: string;
    tokenVersion: number;
    runtimeState: "READY";
  }>,
  terminalHandlers: [] as Array<(
    runtime: {
      botInstanceId: string;
      tokenVersion: number;
      runtimeState: "READY";
    },
    reason: "HEARTBEAT_FAILED_AT_LEASE_SAFETY_MARGIN" | "LEASE_SAFETY_MARGIN_REACHED",
  ) => void>,
}));

vi.mock("../src/runtime/managed-bot-runtime", () => ({
  ManagedBotRuntime: class {
    readonly botInstanceId: string;
    readonly tokenVersion: number;
    readonly runtimeState = "READY";

    constructor(
      _config: unknown,
      claim: { bot: { id: string; tokenVersion: number } },
      _logger: unknown,
      onTerminal: (
        runtime: {
          botInstanceId: string;
          tokenVersion: number;
          runtimeState: "READY";
        },
        reason: "HEARTBEAT_FAILED_AT_LEASE_SAFETY_MARGIN" | "LEASE_SAFETY_MARGIN_REACHED",
      ) => void,
    ) {
      this.botInstanceId = claim.bot.id;
      this.tokenVersion = claim.bot.tokenVersion;
      runtimeMocks.instances.push(this);
      runtimeMocks.terminalHandlers.push(onTerminal);
    }

    async start() {
      runtimeMocks.starts.push(this.botInstanceId);
      if (this.botInstanceId === "bot-failing") {
        throw new Error("invalid token");
      }
    }

    async stop() {
      runtimeMocks.stops.push(this.botInstanceId);
    }
  },
}));

function assignment(botInstanceId: string, claimRequestId?: string) {
  return {
    botInstanceId,
    slug: botInstanceId,
    displayName: botInstanceId,
    discordApplicationId: `application-${botInstanceId}`,
    tokenVersion: 1,
    runtime: {
      botInstanceId,
      runtimeInstanceId: claimRequestId ? "test-runtime" : null,
      claimRequestId: claimRequestId ?? null,
      leaseGeneration: claimRequestId ? 3 : 0,
      runtimeState: claimRequestId ? "CLAIMED" : "STOPPED",
    },
  };
}

function claim(botInstanceId: string) {
  return {
    bot: {
      id: botInstanceId,
      slug: botInstanceId,
      displayName: botInstanceId,
      discordApplicationId: `application-${botInstanceId}`,
      desiredStatus: "ACTIVE",
      tokenVersion: 1,
      tokenConfigured: true,
    },
    profile: {
      id: `profile-${botInstanceId}`,
      botInstanceId,
      defaultModel: "gpt-4.1-mini",
      dmEnabled: false,
      retentionDays: 30,
      maxInputChars: 4_000,
      maxOutputTokens: 512,
    },
    lease: {
      botInstanceId,
      runtimeInstanceId: "test-runtime",
      leaseGeneration: 3,
      runtimeState: "CLAIMED",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      claimedTokenVersion: 1,
    },
    leaseToken: `lease-${botInstanceId}`,
    discordToken: `discord-${botInstanceId}`,
    heartbeatAfterMs: 15_000,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  runtimeMocks.starts.length = 0;
  runtimeMocks.stops.length = 0;
  runtimeMocks.instances.length = 0;
  runtimeMocks.terminalHandlers.length = 0;
});

describe("BotPoolSupervisor", () => {
  it("treats zero bots as healthy after a successful API poll", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [], pollAfterMs: 15_000 }), {
          status: 200,
        }),
      ),
    );
    const supervisor = new BotPoolSupervisor(
      createBotConfig({ assignmentPollMs: 60_000 }),
      createLoggerMock(),
    );

    supervisor.start();
    await vi.waitFor(() => expect(supervisor.health().apiConnected).toBe(true));
    expect(supervisor.health()).toMatchObject({
      healthy: true,
      supervisorRunning: true,
      managedBots: 0,
    });
    await supervisor.stop();
    expect(supervisor.health().supervisorRunning).toBe(false);
  });

  it("recovers a persisted claim ID and isolates one bot startup failure", async () => {
    const recoveredClaimId = "55555555-5555-4555-8555-555555555555";
    const fetchMock = vi.fn(async (url: string, request: RequestInit) => {
      if (url.endsWith("/internal/runtime/assignments")) {
        return new Response(
          JSON.stringify({
            items: [
              assignment("bot-ready", recoveredClaimId),
              assignment("bot-failing"),
            ],
            pollAfterMs: 15_000,
          }),
          { status: 200 },
        );
      }
      const botId = url.includes("bot-ready") ? "bot-ready" : "bot-failing";
      return new Response(JSON.stringify(claim(botId)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const supervisor = new BotPoolSupervisor(
      createBotConfig({ assignmentPollMs: 60_000 }),
      createLoggerMock(),
    );

    supervisor.start();
    await vi.waitFor(() =>
      expect(runtimeMocks.starts).toEqual(
        expect.arrayContaining(["bot-ready", "bot-failing"]),
      ),
    );
    await vi.waitFor(() => expect(runtimeMocks.stops).toContain("bot-failing"));

    const readyClaim = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("bot-ready/claim"),
    );
    expect(JSON.parse(String((readyClaim?.[1] as RequestInit).body))).toMatchObject({
      runtimeInstanceId: "test-runtime",
      claimRequestId: recoveredClaimId,
    });
    expect(supervisor.health().managedBots).toBe(1);

    await supervisor.stop();
    expect(runtimeMocks.stops).toContain("bot-ready");
  });

  it("evicts a terminal runtime, reclaims it, and ignores its stale callback", async () => {
    const recoveredClaimId = "55555555-5555-4555-8555-555555555555";
    const fetchMock = vi.fn(async (url: string, _request: RequestInit) => {
      if (url.endsWith("/internal/runtime/assignments")) {
        return new Response(JSON.stringify({
          items: [assignment("bot-ready", recoveredClaimId)],
          pollAfterMs: 15_000,
        }), { status: 200 });
      }
      return new Response(JSON.stringify(claim("bot-ready")), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const supervisor = new BotPoolSupervisor(
      createBotConfig({ assignmentPollMs: 60_000 }),
      createLoggerMock(),
    );

    supervisor.start();
    await vi.waitFor(() => expect(runtimeMocks.starts).toHaveLength(1));
    expect(supervisor.health().managedBots).toBe(1);

    const firstRuntime = runtimeMocks.instances[0]!;
    const firstTerminalHandler = runtimeMocks.terminalHandlers[0]!;
    firstTerminalHandler(firstRuntime, "LEASE_SAFETY_MARGIN_REACHED");
    expect(supervisor.health().managedBots).toBe(0);

    await vi.waitFor(() => expect(runtimeMocks.starts).toHaveLength(2));
    expect(supervisor.health().managedBots).toBe(1);

    firstTerminalHandler(firstRuntime, "LEASE_SAFETY_MARGIN_REACHED");
    expect(supervisor.health().managedBots).toBe(1);

    const claimRequests = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/claim"),
    );
    expect(claimRequests).toHaveLength(2);
    for (const [, request] of claimRequests) {
      expect(JSON.parse(String((request as RequestInit).body))).toMatchObject({
        runtimeInstanceId: "test-runtime",
        claimRequestId: recoveredClaimId,
      });
    }

    await supervisor.stop();
  });
});
