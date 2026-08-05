import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BotInstallationSettingsResponse,
  BotSummary,
} from "./types";
import {
  api,
  asLlmSettings,
  asLlmSettingsUpdatePayload,
} from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function botSummary(index: number): BotSummary {
  return {
    id: `bot-${index}`,
    slug: `bot-${index}`,
    displayName: `Bot ${index}`,
    discordApplicationId: `application-${index}`,
    desiredStatus: "ACTIVE",
    tokenVersion: 1,
    tokenConfigured: true,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

function installationSettingsResponse(): BotInstallationSettingsResponse {
  return {
    installation: {
      id: "installation-1",
      botInstanceId: "bot-1",
      guildId: "guild-record-1",
      guildDiscordId: "guild-1",
      guildName: "Guild 1",
      guildStatus: "ACTIVE",
      presenceStatus: "PRESENT",
      operationalStatus: "ENABLED",
      installedAt: "2026-08-04T00:00:00.000Z",
      lastSeenAt: "2026-08-04T00:00:00.000Z",
    },
    settings: {
      id: "settings-1",
      botInstallationId: "installation-1",
      llmEnabledByGuild: true,
      llmEnabledByPlatform: true,
      assistantPromptOverride: null,
      gatekeeperPromptOverride: null,
      retentionDaysOverride: null,
      maxInputCharsOverride: null,
      maxOutputTokensOverride: null,
      settingsVersion: 1,
    },
    profile: {
      id: "profile-1",
      botInstanceId: "bot-1",
      defaultModel: "gpt-4.1-mini",
      dmEnabled: true,
      retentionDays: 90,
      maxInputChars: 8_000,
      maxOutputTokens: 1_024,
      settingsVersion: 1,
    },
    effective: {
      model: "gpt-4.1-mini",
      assistantPrompt: null,
      gatekeeperPrompt: null,
      retentionDays: 90,
      maxInputChars: 8_000,
      maxOutputTokens: 1_024,
      dmEnabled: true,
    },
    effectiveAiEnabled: true,
    effectivePrompts: {
      assistant: "Default assistant prompt",
      gatekeeper: "Default gatekeeper prompt",
    },
    channels: [],
    features: [],
    commands: [],
  };
}

describe("Admin LLM settings mapping", () => {
  it("keeps inherited numeric overrides null while exposing effective values", () => {
    const mapped = asLlmSettings("guild-1", installationSettingsResponse());

    expect(mapped.settings).toMatchObject({
      retentionDays: null,
      maxInputChars: null,
      maxOutputTokens: null,
    });
    expect(mapped.effective).toMatchObject({
      retentionDays: 90,
      maxInputChars: 8_000,
      maxOutputTokens: 1_024,
    });
  });

  it("sends null overrides instead of materializing effective profile values", () => {
    const mapped = asLlmSettings("guild-1", installationSettingsResponse());

    expect(asLlmSettingsUpdatePayload({
      ...mapped.settings,
      enabled: false,
    })).toMatchObject({
      llmEnabledByGuild: false,
      retentionDaysOverride: null,
      maxInputCharsOverride: null,
      maxOutputTokensOverride: null,
    });
  });
});

describe("platform bot directory", () => {
  it("loads every cursor page", async () => {
    vi.stubGlobal("document", { cookie: "" });
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      botSummary(index + 1));
    const finalBot = botSummary(101);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: firstPage,
        nextCursor: "cursor+/=",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [finalBot],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.platformBots();

    expect(result.items).toHaveLength(101);
    expect(result.items.at(-1)).toEqual(finalBot);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/platform/bots?limit=100",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/platform/bots?limit=100&cursor=cursor%2B%2F%3D",
      expect.any(Object),
    );
  });
});
