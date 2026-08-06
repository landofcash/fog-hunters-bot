import { describe, expect, it } from "vitest";
import { isEffectiveAiEnabled } from "../../src/modules/llm/effective-ai";

type Config = Parameters<typeof isEffectiveAiEnabled>[0];
type Effective = Parameters<typeof isEffectiveAiEnabled>[1];

const activeConfig: Config = {
  llmEnabled: true,
  llmGlobalKillSwitch: false,
};

const activeSettings: Effective = {
  bot: { desiredStatus: "ACTIVE" },
  installation: {
    guildStatus: "ACTIVE",
    presenceStatus: "PRESENT",
    operationalStatus: "ENABLED",
  },
  installationSettings: {
    llmEnabledByGuild: true,
    llmEnabledByPlatform: true,
  },
};

describe("effective AI status", () => {
  it("is enabled only when every runtime and policy gate is open", () => {
    expect(isEffectiveAiEnabled(activeConfig, activeSettings)).toBe(true);
  });

  it.each([
    ["global AI is disabled", { ...activeConfig, llmEnabled: false }, activeSettings],
    ["the kill switch is active", { ...activeConfig, llmGlobalKillSwitch: true }, activeSettings],
    [
      "the bot is not active",
      activeConfig,
      { ...activeSettings, bot: { desiredStatus: "DISABLED" as const } },
    ],
    [
      "the guild is disabled",
      activeConfig,
      {
        ...activeSettings,
        installation: { ...activeSettings.installation!, guildStatus: "DISABLED" as const },
      },
    ],
    [
      "the bot left the guild",
      activeConfig,
      {
        ...activeSettings,
        installation: { ...activeSettings.installation!, presenceStatus: "LEFT" as const },
      },
    ],
    [
      "the installation is disabled",
      activeConfig,
      {
        ...activeSettings,
        installation: {
          ...activeSettings.installation!,
          operationalStatus: "DISABLED" as const,
        },
      },
    ],
    [
      "the guild AI preference is disabled",
      activeConfig,
      {
        ...activeSettings,
        installationSettings: {
          ...activeSettings.installationSettings!,
          llmEnabledByGuild: false,
        },
      },
    ],
    [
      "platform AI access is disabled",
      activeConfig,
      {
        ...activeSettings,
        installationSettings: {
          ...activeSettings.installationSettings!,
          llmEnabledByPlatform: false,
        },
      },
    ],
  ])("is disabled when %s", (_reason, config, effective) => {
    expect(isEffectiveAiEnabled(config, effective)).toBe(false);
  });
});
