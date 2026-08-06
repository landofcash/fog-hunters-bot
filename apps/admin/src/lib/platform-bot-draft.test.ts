import { describe, expect, it } from "vitest";
import type { BotProfile, BotSummary } from "@/api/types";
import {
  reconcilePlatformBotDraft,
  type PlatformBotDraft,
} from "./platform-bot-draft";

const bot = {
  id: "bot-1",
  displayName: "Server name",
} as BotSummary;

const profile = {
  id: "profile-1",
  botInstanceId: "bot-1",
  defaultModel: "gpt-5.6-luna",
  reasoningEffort: "low",
  assistantPrompt: "Server prompt",
  gatekeeperPrompt: null,
  dmEnabled: true,
  retentionDays: 30,
  maxInputChars: 4_000,
  maxOutputTokens: 512,
  settingsVersion: 1,
} satisfies BotProfile;

describe("reconcilePlatformBotDraft", () => {
  it("preserves dirty name and profile fields during runtime-only polling", () => {
    const draft: PlatformBotDraft = {
      botId: bot.id,
      displayName: "Unsaved name",
      displayNameDirty: true,
      profile: {
        defaultModel: profile.defaultModel,
        reasoningEffort: profile.reasoningEffort,
        assistantPrompt: "Unsaved prompt",
        gatekeeperPrompt: profile.gatekeeperPrompt,
        dmEnabled: profile.dmEnabled,
        retentionDays: profile.retentionDays,
        maxInputChars: profile.maxInputChars,
        maxOutputTokens: profile.maxOutputTokens,
      },
      profileDirty: true,
    };

    expect(reconcilePlatformBotDraft(draft, { bot, profile })).toBe(draft);
  });

  it("refreshes clean fields independently and resets both forms for another bot", () => {
    const dirtyProfile: PlatformBotDraft = {
      botId: bot.id,
      displayName: "Old server name",
      displayNameDirty: false,
      profile: {
        defaultModel: profile.defaultModel,
        reasoningEffort: profile.reasoningEffort,
        assistantPrompt: "Unsaved prompt",
        gatekeeperPrompt: profile.gatekeeperPrompt,
        dmEnabled: profile.dmEnabled,
        retentionDays: profile.retentionDays,
        maxInputChars: profile.maxInputChars,
        maxOutputTokens: profile.maxOutputTokens,
      },
      profileDirty: true,
    };

    const refreshed = reconcilePlatformBotDraft(dirtyProfile, { bot, profile });
    expect(refreshed.displayName).toBe("Server name");
    expect(refreshed.profile.assistantPrompt).toBe("Unsaved prompt");

    const otherBot = { ...bot, id: "bot-2", displayName: "Other bot" };
    const otherProfile = {
      ...profile,
      id: "profile-2",
      botInstanceId: "bot-2",
      assistantPrompt: "Other prompt",
    };
    expect(reconcilePlatformBotDraft(refreshed, {
      bot: otherBot,
      profile: otherProfile,
    })).toMatchObject({
      botId: "bot-2",
      displayName: "Other bot",
      displayNameDirty: false,
      profile: { assistantPrompt: "Other prompt" },
      profileDirty: false,
    });
  });
});
