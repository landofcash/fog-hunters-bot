export interface SupportedLlmModel {
  id: string;
  name: string;
  description: string;
}

export const SUPPORTED_LLM_MODELS: SupportedLlmModel[] = [
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Efficient model for high-volume workloads.",
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Balanced model for general-purpose workloads.",
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Flagship model for the most demanding workloads.",
  },
];

const supportedModelIds = new Set(SUPPORTED_LLM_MODELS.map((model) => model.id));

export function isSupportedLlmModel(model: string): boolean {
  return supportedModelIds.has(model);
}
