import { createHash } from "node:crypto";
import type {
  BotProfileRecord,
  LlmInstallationSettingsRecord,
} from "../../repositories/types";

function promptAuditValue(prompt?: string | null): {
  configured: boolean;
  length: number;
  sha256: string | null;
} {
  return {
    configured: prompt !== null && prompt !== undefined,
    length: prompt?.length ?? 0,
    sha256: prompt === null || prompt === undefined
      ? null
      : createHash("sha256").update(prompt, "utf8").digest("hex"),
  };
}

export function sanitizeLlmSettingsForAudit(
  settings: LlmInstallationSettingsRecord,
): Record<string, unknown> {
  const {
    assistantPromptOverride,
    gatekeeperPromptOverride,
    ...nonPromptSettings
  } = settings;

  return {
    ...nonPromptSettings,
    assistantPromptOverride: promptAuditValue(assistantPromptOverride),
    gatekeeperPromptOverride: promptAuditValue(gatekeeperPromptOverride),
  };
}

export function sanitizeBotProfileForAudit(
  profile: BotProfileRecord,
): Record<string, unknown> {
  const {
    assistantPrompt,
    gatekeeperPrompt,
    ...nonPromptProfile
  } = profile;

  return {
    ...nonPromptProfile,
    assistantPrompt: promptAuditValue(assistantPrompt),
    gatekeeperPrompt: promptAuditValue(gatekeeperPrompt),
  };
}
