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

interface OpenAiResponseAnnotation {
  type?: string;
  start_index?: number;
  end_index?: number;
  title?: string;
  url?: string;
}

interface OpenAiResponseContent {
  type?: string;
  text?: string;
  annotations?: OpenAiResponseAnnotation[];
}

interface OpenAiResponsesResponse {
  output?: Array<{
    type?: string;
    content?: OpenAiResponseContent[];
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
  };
}

function renderClickableCitations(part: OpenAiResponseContent): string {
  const original = part.text ?? "";
  let rendered = original;
  let rightBoundary = original.length;

  const annotations = [...(part.annotations ?? [])]
    .filter((annotation) => annotation.type === "url_citation")
    .sort((left, right) => (right.start_index ?? -1) - (left.start_index ?? -1));

  for (const annotation of annotations) {
    const start = annotation.start_index;
    const end = annotation.end_index;

    if (
      typeof start !== "number"
      || typeof end !== "number"
      || !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end <= start
      || end > original.length
      || end > rightBoundary
      || !annotation.url
    ) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(annotation.url);
    } catch {
      continue;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      continue;
    }

    const label = (annotation.title?.trim() || url.hostname)
      .replace(/\s+/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/@/g, "@\u200b")
      .slice(0, 120);
    const destination = url.href
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");

    rendered = `${rendered.slice(0, start)}[${label}](${destination})${rendered.slice(end)}`;
    rightBoundary = start;
  }

  return rendered;
}

export class OpenAiProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly apiBaseUrl = "https://api.openai.com/v1") {}

  async generateChat(input: GenerateChatInput): Promise<GenerateChatOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    const isGpt56Model = input.model === "gpt-5.6" || input.model.startsWith("gpt-5.6-");
    const generationOptions = isGpt56Model
      ? {
          max_completion_tokens: input.maxTokens,
          reasoning_effort: "none",
        }
      : {
          max_tokens: input.maxTokens,
          temperature: 0.7,
        };

    try {
      const useWebSearch = input.allowWebSearch === true;
      const requestBody = useWebSearch
        ? {
            model: input.model,
            input: input.messages,
            tools: [{ type: "web_search" }],
            tool_choice: "auto",
            max_output_tokens: input.maxTokens,
            store: false,
            ...(isGpt56Model
              ? { reasoning: { effort: "none" } }
              : { temperature: 0.7 }),
          }
        : {
            model: input.model,
            messages: input.messages,
            ...generationOptions,
          };
      const endpoint = useWebSearch ? "responses" : "chat/completions";

      const response = await fetch(`${this.apiBaseUrl}/${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as
        | OpenAiChatResponse
        | OpenAiResponsesResponse;
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

      if (useWebSearch) {
        const responsesPayload = payload as OpenAiResponsesResponse;
        const text = (responsesPayload.output ?? [])
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text")
          .map(renderClickableCitations)
          .join("\n")
          .trim();

        if (!text) {
          throw new ApiError(502, "LLM_PROVIDER_EMPTY_RESPONSE", "Provider returned an empty response.");
        }

        return {
          text,
          usage: {
            inputTokens: responsesPayload.usage?.input_tokens ?? 0,
            outputTokens: responsesPayload.usage?.output_tokens ?? 0,
          },
        };
      }

      const chatPayload = payload as OpenAiChatResponse;
      const text = chatPayload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new ApiError(502, "LLM_PROVIDER_EMPTY_RESPONSE", "Provider returned an empty response.");
      }

      return {
        text,
        usage: {
          inputTokens: chatPayload.usage?.prompt_tokens ?? 0,
          outputTokens: chatPayload.usage?.completion_tokens ?? 0,
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
