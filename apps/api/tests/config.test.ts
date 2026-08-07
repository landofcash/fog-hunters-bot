import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config";
import { SUPPORTED_LLM_MODELS } from "../src/modules/llm/models";

describe("loadConfig", () => {
  it("defaults to Luna and exposes only GPT-5.6 models", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(config.llmDefaultModel).toBe("gpt-5.6-luna");
    expect(config.llmRequestTimeoutMs).toBe(60_000);
    expect(SUPPORTED_LLM_MODELS.map((model) => model.id)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
    ]);
  });

  it("accepts a supported configured default model", () => {
    expect(loadConfig({
      NODE_ENV: "test",
      LLM_DEFAULT_MODEL: "gpt-5.6-luna",
    }).llmDefaultModel).toBe("gpt-5.6-luna");
  });

  it("rejects an unsupported configured default model", () => {
    expect(() => loadConfig({
      NODE_ENV: "test",
      LLM_DEFAULT_MODEL: "unsupported-model",
    })).toThrow("LLM_DEFAULT_MODEL must be a supported model.");
  });
});
