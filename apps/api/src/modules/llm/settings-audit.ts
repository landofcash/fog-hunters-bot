import { createHash } from "node:crypto";
import type { LlmGuildSettingsRecord } from "../../repositories/types";

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
  settings: LlmGuildSettingsRecord,
): Record<string, unknown> {
  const {
    assistantPrompt,
    gatekeeperPrompt,
    ...nonPromptSettings
  } = settings;

  return {
    ...nonPromptSettings,
    assistantPrompt: promptAuditValue(assistantPrompt),
    gatekeeperPrompt: promptAuditValue(gatekeeperPrompt),
  };
}
