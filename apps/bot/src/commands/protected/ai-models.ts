export const AI_MODEL_CHOICES = [
  {
    name: "GPT-5.6 Terra (balanced, recommended)",
    value: "gpt-5.6-terra",
  },
  {
    name: "GPT-5.6 Sol (highest quality)",
    value: "gpt-5.6-sol",
  },
  {
    name: "GPT-5.6 Luna (fastest, lowest cost)",
    value: "gpt-5.6-luna",
  },
  {
    name: "GPT-4.1 mini (existing default)",
    value: "gpt-4.1-mini",
  },
] as const;

const supportedModelIds = new Set<string>(AI_MODEL_CHOICES.map((choice) => choice.value));

export function isSupportedAiModel(model: string): boolean {
  return supportedModelIds.has(model);
}
