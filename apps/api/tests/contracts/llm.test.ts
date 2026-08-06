import { describe, expect, it } from "vitest";
import {
  LLM_PROMPT_MAX_LENGTH,
  llmPromptOverrideSchema,
} from "../../src/contracts/llm";

describe("LLM prompt limits", () => {
  it("accepts 20,000 characters and rejects 20,001", () => {
    expect(llmPromptOverrideSchema.safeParse("a".repeat(LLM_PROMPT_MAX_LENGTH)).success)
      .toBe(true);
    expect(llmPromptOverrideSchema.safeParse("a".repeat(LLM_PROMPT_MAX_LENGTH + 1)).success)
      .toBe(false);
  });
});
