import type { Client, Guild } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { handleGuildCreateEvent } from "../src/events/guild-create";
import { handleGuildDeleteEvent } from "../src/events/guild-delete";
import { handleReadyEvent } from "../src/events/ready";
import { createApiClientMock, createLoggerMock } from "./helpers/fixtures";

function guild(overrides: Record<string, unknown> = {}): Guild {
  return {
    id: "guild-1",
    name: "Guild",
    available: true,
    ...overrides,
  } as Guild;
}

describe("Discord guild lifecycle", () => {
  it("does not reactivate temporarily unavailable guilds", async () => {
    const apiClient = createApiClientMock();
    await handleGuildCreateEvent({
      guild: guild({ available: false }),
      apiClient,
      botToken: "not-used",
      discordApplicationId: "application-1",
      logger: createLoggerMock(),
    });

    const client = {
      user: { id: "bot-1", tag: "bot#0001" },
      guilds: {
        cache: new Map([["guild-1", guild({ available: false })]]),
      },
    } as unknown as Client<true>;
    await handleReadyEvent({
      client,
      apiClient,
      botToken: "not-used",
      discordApplicationId: "application-1",
      logger: createLoggerMock(),
    });

    expect(apiClient.bootstrapGuild).not.toHaveBeenCalled();
    expect(apiClient.reconcileGuilds).toHaveBeenCalledWith(["guild-1"]);
  });

  it("reconciles available and unavailable guild IDs from the ready snapshot", async () => {
    const apiClient = createApiClientMock({
      bootstrapGuild: vi.fn().mockResolvedValue({
        installation: {
          lastCommandManifestHash: null,
          lastCommandSyncErrorCode: null,
        },
      }),
    });
    const availableGuild = guild({
      id: "available-guild",
      fetchOwner: vi.fn().mockRejectedValue(new Error("owner unavailable")),
    });
    const unavailableGuild = guild({
      id: "unavailable-guild",
      available: false,
    });
    const client = {
      user: { id: "bot-1", tag: "bot#0001" },
      guilds: {
        cache: new Map([
          [availableGuild.id, availableGuild],
          [unavailableGuild.id, unavailableGuild],
        ]),
      },
    } as unknown as Client<true>;

    await handleReadyEvent({
      client,
      apiClient,
      botToken: "bot-token",
      discordApplicationId: "application-1",
      logger: createLoggerMock(),
    });

    expect(apiClient.reconcileGuilds).toHaveBeenCalledWith([
      "available-guild",
      "unavailable-guild",
    ]);
    expect(apiClient.bootstrapGuild).toHaveBeenCalledTimes(1);
    expect(apiClient.bootstrapGuild).toHaveBeenCalledWith(
      "available-guild",
      { guildName: "Guild", owner: undefined },
    );
  });

  it("preserves outage deletions and marks authoritative departures left", async () => {
    const apiClient = createApiClientMock({
      markGuildLeft: vi.fn().mockResolvedValue(undefined),
    });

    await handleGuildDeleteEvent({
      guild: guild({ available: false }),
      apiClient,
      logger: createLoggerMock(),
    });
    expect(apiClient.markGuildLeft).not.toHaveBeenCalled();

    await handleGuildDeleteEvent({
      guild: guild({ available: true }),
      apiClient,
      logger: createLoggerMock(),
    });
    expect(apiClient.markGuildLeft).toHaveBeenCalledWith("guild-1");
  });
});
