import type { AppConfig } from "../../../lib/config";
import { ApiError } from "../../../lib/errors";
import { OpenAiProvider } from "./openai.provider";
import type { LlmProvider } from "./types";

export function createLlmProvider(config: AppConfig): LlmProvider {
  if (config.llmProvider === "openai") {
    if (!config.openAiApiKey) {
      throw new ApiError(500, "LLM_PROVIDER_CONFIG_INVALID", "OPENAI_API_KEY is required when LLM_PROVIDER=openai.");
    }
    return new OpenAiProvider(config.openAiApiKey);
  }

  throw new ApiError(500, "LLM_PROVIDER_NOT_SUPPORTED", "Configured LLM provider is not supported.");
}
