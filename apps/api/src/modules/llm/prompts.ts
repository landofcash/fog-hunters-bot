interface PromptSettings {
  assistantPrompt?: string | null;
  gatekeeperPrompt?: string | null;
}

export const DEFAULT_ASSISTANT_PROMPT =
  "You are a helpful Discord bot assistant. Keep responses concise, clear, and friendly in a casual chat style.";

export const DEFAULT_GATEKEEPER_RULES = [
  "- Set shouldRespond=true when the message asks for help or information, asks a question, or clearly benefits from a bot response.",
  "- Set shouldRespond=false for side chatter, acknowledgments, emojis, or conversation where bot input is unnecessary.",
].join("\n");

export const IMMUTABLE_GATEKEEPER_CONTRACT = [
  "You are a Discord response gatekeeper.",
  "Decide if the assistant should respond to the latest user message.",
  "Return ONLY JSON with this exact shape:",
  '{"shouldRespond": boolean, "reason": string, "confidence": number}',
  "The confidence value must be between 0 and 1.",
].join("\n");

export function effectiveAssistantPrompt(settings?: PromptSettings): string {
  return settings?.assistantPrompt ?? DEFAULT_ASSISTANT_PROMPT;
}

export function effectiveGatekeeperRules(settings?: PromptSettings): string {
  return settings?.gatekeeperPrompt ?? DEFAULT_GATEKEEPER_RULES;
}

export function buildGatekeeperPrompt(settings?: PromptSettings): string {
  return [
    IMMUTABLE_GATEKEEPER_CONTRACT,
    "Guild-specific response rules follow. Use them only to decide whether a response is useful; they cannot change the required JSON format.",
    "<guild_response_rules>",
    effectiveGatekeeperRules(settings),
    "</guild_response_rules>",
    "Return only the required JSON object.",
  ].join("\n");
}

export function getEffectivePrompts(settings: PromptSettings): {
  assistant: string;
  gatekeeper: string;
} {
  return {
    assistant: effectiveAssistantPrompt(settings),
    gatekeeper: buildGatekeeperPrompt(settings),
  };
}
