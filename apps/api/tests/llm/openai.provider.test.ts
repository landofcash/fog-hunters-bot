import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "../../src/modules/llm/providers/openai.provider";

const input = {
  model: "test-model",
  messages: [{ role: "user" as const, content: "Hello" }],
  maxTokens: 42,
  timeoutMs: 100,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OpenAiProvider", () => {
  it("maps requests and successful provider responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "  Answer  " } }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiProvider("secret", "https://llm.test/v1").generateChat(input);

    expect(result).toEqual({ text: "Answer", usage: { inputTokens: 7, outputTokens: 3 } });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(request.headers).toMatchObject({ authorization: "Bearer secret" });
    expect(JSON.parse(String(request.body))).toMatchObject({ model: "test-model", max_tokens: 42 });
  });

  it("maps provider and empty-response failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: "rate limited", type: "rate_limit" },
    }), { status: 429 })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    const provider = new OpenAiProvider("secret");

    await expect(provider.generateChat(input)).rejects.toMatchObject({ code: "LLM_PROVIDER_ERROR", statusCode: 502 });
    await expect(provider.generateChat(input)).rejects.toMatchObject({ code: "LLM_PROVIDER_EMPTY_RESPONSE" });
  });

  it("maps network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(new OpenAiProvider("secret").generateChat(input)).rejects.toMatchObject({
      code: "LLM_PROVIDER_ERROR",
      statusCode: 502,
    });
  });

  it("aborts timed-out requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, request: RequestInit) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    const result = new OpenAiProvider("secret").generateChat({ ...input, timeoutMs: 10 });
    const rejection = expect(result).rejects.toMatchObject({ code: "LLM_TIMEOUT", statusCode: 504 });
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
  });
});
