import {
  AuditLogEvent,
  Collection,
  PermissionsBitField,
  type Guild,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { resolveGuildInstaller } from "../src/discord/resolve-guild-installer";
import { createLoggerMock } from "./helpers/fixtures";

function createGuild(overrides: Record<string, unknown> = {}): Guild {
  return {
    id: "guild-1",
    members: {
      me: {
        permissions: new PermissionsBitField(PermissionsBitField.Flags.ViewAuditLog),
      },
    },
    ...overrides,
  } as unknown as Guild;
}

describe("guild installer resolution", () => {
  it("returns the user who added the current bot", async () => {
    const installer = {
      id: "installer-1",
      username: "installer",
      globalName: "Installer",
      bot: false,
      displayAvatarURL: vi.fn().mockReturnValue("https://avatar.test/installer.png"),
    };
    const fetchAuditLogs = vi.fn().mockResolvedValue({
      entries: new Collection([
        [
          "entry-other",
          {
            id: "entry-other",
            targetId: "other-bot",
            executor: installer,
          },
        ],
        [
          "entry-current",
          {
            id: "entry-current",
            targetId: "bot-1",
            executor: installer,
          },
        ],
      ]),
    });

    const result = await resolveGuildInstaller({
      guild: createGuild({ fetchAuditLogs }),
      discordBotUserId: "bot-1",
      logger: createLoggerMock(),
    });

    expect(fetchAuditLogs).toHaveBeenCalledWith({
      type: AuditLogEvent.BotAdd,
      limit: 10,
    });
    expect(result).toEqual({
      auditLogEntryId: "entry-current",
      profile: {
        discordUserId: "installer-1",
        username: "installer",
        globalName: "Installer",
        avatarUrl: "https://avatar.test/installer.png",
      },
    });
  });

  it("does not fetch audit logs without View Audit Log permission", async () => {
    const fetchAuditLogs = vi.fn();
    const logger = createLoggerMock();
    const result = await resolveGuildInstaller({
      guild: createGuild({
        members: {
          me: {
            permissions: new PermissionsBitField(),
          },
        },
        fetchAuditLogs,
      }),
      discordBotUserId: "bot-1",
      logger,
    });

    expect(result).toBeUndefined();
    expect(fetchAuditLogs).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { guildId: "guild-1" },
      "Cannot resolve the bot installer because View Audit Log permission is missing",
    );
  });
});
