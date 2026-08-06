import { describe, expect, it } from "vitest";
import {
  sanitizeBotProfileForAudit,
  sanitizeLlmSettingsForAudit,
} from "../../src/modules/llm/settings-audit";

describe("LLM audit sanitizers", () => {
  it("replaces installation prompt overrides with non-content metadata", () => {
    const sanitized = sanitizeLlmSettingsForAudit({
      id: "settings-id",
      botInstallationId: "installation-id",
      llmEnabledByGuild: true,
      llmEnabledByPlatform: true,
      modelOverride: null,
      reasoningEffortOverride: null,
      assistantPromptOverride: "private assistant instructions",
      gatekeeperPromptOverride: null,
      retentionDaysOverride: 30,
      maxInputCharsOverride: null,
      maxOutputTokensOverride: null,
      settingsVersion: 2,
      createdAt: new Date("2026-08-03T00:00:00.000Z"),
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    });

    expect(sanitized).toMatchObject({
      assistantPromptOverride: {
        configured: true,
        length: "private assistant instructions".length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      gatekeeperPromptOverride: {
        configured: false,
        length: 0,
        sha256: null,
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("private assistant instructions");
  });

  it("replaces profile prompts with non-content metadata", () => {
    const sanitized = sanitizeBotProfileForAudit({
      id: "profile-id",
      botInstanceId: "bot-id",
      defaultModel: "gpt-5.6-luna",
      reasoningEffort: "low",
      assistantPrompt: null,
      gatekeeperPrompt: "private gatekeeper instructions",
      dmEnabled: false,
      retentionDays: 30,
      maxInputChars: 4_000,
      maxOutputTokens: 512,
      settingsVersion: 3,
      createdAt: new Date("2026-08-03T00:00:00.000Z"),
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    });

    expect(sanitized).toMatchObject({
      assistantPrompt: {
        configured: false,
        length: 0,
        sha256: null,
      },
      gatekeeperPrompt: {
        configured: true,
        length: "private gatekeeper instructions".length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("private gatekeeper instructions");
  });
});
