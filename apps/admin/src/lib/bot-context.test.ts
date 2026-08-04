import { describe, expect, it } from "vitest";
import type { GuildBotListItem } from "@/api/types";
import {
  botContextQueryKey,
  isInstallationReadOnly,
  selectGuildBotId,
} from "./bot-context";

function item(botId: string): GuildBotListItem {
  return {
    bot: { id: botId } as GuildBotListItem["bot"],
    installation: {
      id: `installation-${botId}`,
      presenceStatus: "PRESENT",
    } as GuildBotListItem["installation"],
  };
}

describe("guild bot context", () => {
  it("auto-selects one installation and honors a valid remembered bot", () => {
    expect(selectGuildBotId([item("bot-a")])).toBe("bot-a");
    expect(selectGuildBotId([item("bot-a"), item("bot-b")], "bot-b")).toBe(
      "bot-b",
    );
    expect(selectGuildBotId([item("bot-a")], "missing")).toBe("bot-a");
    expect(selectGuildBotId([])).toBeUndefined();
  });

  it("isolates cache keys and identifies left installations as read-only", () => {
    expect(botContextQueryKey("guild-a", "bot-a", "settings")).not.toEqual(
      botContextQueryKey("guild-a", "bot-b", "settings"),
    );
    expect(isInstallationReadOnly({ presenceStatus: "LEFT" })).toBe(true);
    expect(isInstallationReadOnly({ presenceStatus: "PRESENT" })).toBe(false);
  });
});
