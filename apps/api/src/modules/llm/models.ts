export interface SupportedLlmModel {
  id: string;
  name: string;
  description: string;
}

export const SUPPORTED_LLM_MODELS: SupportedLlmModel[] = [
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Balanced model recommended for most guilds.",
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Highest-quality option for demanding guilds.",
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Fastest option with the lowest expected cost.",
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 mini",
    description: "Existing compatibility default.",
  },
];

const supportedModelIds = new Set(SUPPORTED_LLM_MODELS.map((model) => model.id));

export function isSupportedLlmModel(model: string): boolean {
  return supportedModelIds.has(model);
}
