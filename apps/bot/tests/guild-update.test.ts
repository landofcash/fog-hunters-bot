import type { Guild } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { handleGuildUpdateEvent } from "../src/events/guild-update";
import { createApiClientMock, createLoggerMock } from "./helpers/fixtures";

function createGuild(input: {
  ownerId: string;
  fetchOwner?: ReturnType<typeof vi.fn>;
}): Guild {
  return {
    id: "guild-1",
    name: "Guild",
    ownerId: input.ownerId,
    fetchOwner: input.fetchOwner ?? vi.fn(),
  } as unknown as Guild;
}

describe("guild update event", () => {
  it("reconciles the new Discord owner when ownership changes", async () => {
    const bootstrapGuild = vi.fn().mockResolvedValue(undefined);
    const apiClient = createApiClientMock({ bootstrapGuild });
    const logger = createLoggerMock();
    const oldGuild = createGuild({ ownerId: "old-owner" });
    const newGuild = createGuild({
      ownerId: "new-owner",
      fetchOwner: vi.fn().mockResolvedValue({
        user: {
          id: "new-owner",
          username: "new_owner",
          globalName: "New Owner",
          displayAvatarURL: vi.fn().mockReturnValue("https://avatar.test/new-owner.png"),
        },
      }),
    });

    await handleGuildUpdateEvent({ oldGuild, newGuild, apiClient, logger });

    expect(bootstrapGuild).toHaveBeenCalledWith("guild-1", {
      guildName: "Guild",
      owner: {
        discordUserId: "new-owner",
        username: "new_owner",
        globalName: "New Owner",
        avatarUrl: "https://avatar.test/new-owner.png",
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        previousOwnerDiscordUserId: "old-owner",
        ownerDiscordUserId: "new-owner",
      }),
      "Guild ownership reconciled",
    );
  });

  it("reconciles metadata without fetching the unchanged owner", async () => {
    const fetchOwner = vi.fn();
    const bootstrapGuild = vi.fn();
    const oldGuild = createGuild({ ownerId: "same-owner" });
    const newGuild = createGuild({ ownerId: "same-owner", fetchOwner });

    await handleGuildUpdateEvent({
      oldGuild,
      newGuild,
      apiClient: createApiClientMock({ bootstrapGuild }),
      logger: createLoggerMock(),
    });

    expect(fetchOwner).not.toHaveBeenCalled();
    expect(bootstrapGuild).toHaveBeenCalledWith("guild-1", {
      guildName: "Guild",
    });
  });

  it("preserves persisted ownership when the current owner cannot be resolved", async () => {
    const bootstrapGuild = vi.fn();
    const logger = createLoggerMock();
    const oldGuild = createGuild({ ownerId: "old-owner" });
    const newGuild = createGuild({
      ownerId: "new-owner",
      fetchOwner: vi.fn().mockRejectedValue(new Error("Discord unavailable")),
    });

    await handleGuildUpdateEvent({
      oldGuild,
      newGuild,
      apiClient: createApiClientMock({ bootstrapGuild }),
      logger,
    });

    expect(bootstrapGuild).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ ownerDiscordUserId: "new-owner" }),
      "Failed to reconcile guild ownership",
    );
  });
});
