import { ApiError } from "../../../lib/errors";
import type { LlmProvider, GenerateChatInput, GenerateChatOutput } from "./types";

interface OpenAiChatChoice {
  message?: {
    content?: string | null;
  };
}

interface OpenAiChatResponse {
  choices?: OpenAiChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
  };
}

export class OpenAiProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly apiBaseUrl = "https://api.openai.com/v1") {}

  async generateChat(input: GenerateChatInput): Promise<GenerateChatOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as OpenAiChatResponse;
      if (!response.ok) {
        throw new ApiError(
          502,
          "LLM_PROVIDER_ERROR",
          payload.error?.message ?? `OpenAI request failed with status ${response.status}.`,
          {
            provider: "openai",
            status: response.status,
            providerType: payload.error?.type,
          },
        );
      }

      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new ApiError(502, "LLM_PROVIDER_EMPTY_RESPONSE", "Provider returned an empty response.");
      }

      return {
        text,
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(504, "LLM_TIMEOUT", "LLM provider request timed out.");
      }

      throw new ApiError(502, "LLM_PROVIDER_ERROR", "Failed to complete LLM provider request.", {
        provider: "openai",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
