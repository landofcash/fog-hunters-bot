import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config";

describe("loadConfig", () => {
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
