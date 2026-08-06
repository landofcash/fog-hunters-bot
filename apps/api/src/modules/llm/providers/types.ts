import type { ReasoningEffort } from "../../../contracts/llm";

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateChatInput {
  model: string;
  messages: LlmChatMessage[];
  maxTokens: number;
  timeoutMs: number;
  reasoningEffort: ReasoningEffort;
  allowWebSearch?: boolean;
}

export interface GenerateChatOutput {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LlmProvider {
  generateChat(input: GenerateChatInput): Promise<GenerateChatOutput>;
}
