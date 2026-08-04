import { describe, expect, it } from "vitest";
import type { BotInstallationSettingsResponse } from "./types";
import {
  asLlmSettings,
  asLlmSettingsUpdatePayload,
} from "./client";

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
