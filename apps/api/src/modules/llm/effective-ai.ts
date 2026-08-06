import type { AppConfig } from "../../lib/config";
import type {
  BotInstanceRecord,
  BotInstallationRecord,
  LlmInstallationSettingsRecord,
} from "../../repositories/types";

type EffectiveAiConfig = Pick<AppConfig, "llmEnabled" | "llmGlobalKillSwitch">;

type EffectiveAiSettings = {
  bot: Pick<BotInstanceRecord, "desiredStatus">;
  installation?: Pick<
    BotInstallationRecord,
    "guildStatus" | "presenceStatus" | "operationalStatus"
  >;
  installationSettings?: Pick<
    LlmInstallationSettingsRecord,
    "llmEnabledByGuild" | "llmEnabledByPlatform"
  >;
};

export function isEffectiveAiEnabled(
  config: EffectiveAiConfig,
  effective: EffectiveAiSettings,
): boolean {
  const installation = effective.installation;
  const settings = effective.installationSettings;
  return config.llmEnabled
    && !config.llmGlobalKillSwitch
    && effective.bot.desiredStatus === "ACTIVE"
    && installation?.guildStatus === "ACTIVE"
    && installation.presenceStatus === "PRESENT"
    && installation.operationalStatus === "ENABLED"
    && settings?.llmEnabledByGuild === true
    && settings.llmEnabledByPlatform === true;
}
