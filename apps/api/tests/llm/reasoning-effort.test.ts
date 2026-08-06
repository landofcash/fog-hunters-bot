import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/lib/config";
import { LlmService } from "../../src/modules/llm/llm.service";
import type { LlmProvider } from "../../src/modules/llm/providers/types";
import type {
  AppRepository,
  EffectiveBotSettings,
  LlmConversationRecord,
  LlmMessageRecord,
} from "../../src/repositories/types";

function loggerMock(): FastifyBaseLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function settings(reasoningEffort: EffectiveBotSettings["reasoningEffort"]): EffectiveBotSettings {
  return {
    bot: {} as EffectiveBotSettings["bot"],
    profile: {} as EffectiveBotSettings["profile"],
    model: "gpt-5.6-luna",
    reasoningEffort,
    assistantPrompt: null,
    gatekeeperPrompt: null,
    retentionDays: 30,
    maxInputChars: 4_000,
    maxOutputTokens: 512,
    dmEnabled: true,
  };
}

const conversation = {
  id: "conversation-1",
  summaryText: null,
} as LlmConversationRecord;

const currentMessage = {
  id: "message-1",
  role: "USER",
  content: "Hello",
} as LlmMessageRecord;

function serviceWith(input: {
  reasoningEffort: EffectiveBotSettings["reasoningEffort"];
  provider: LlmProvider;
  recentMessages?: LlmMessageRecord[][];
}): LlmService {
  const repository = {
    getEffectiveBotSettings: vi.fn().mockResolvedValue(settings(input.reasoningEffort)),
    getOrCreateConversation: vi.fn().mockResolvedValue(conversation),
    listRecentConversationMessages: vi.fn()
      .mockResolvedValueOnce(input.recentMessages?.[0] ?? [])
      .mockResolvedValueOnce(input.recentMessages?.[1] ?? [])
      .mockResolvedValueOnce(input.recentMessages?.[2] ?? []),
    appendConversationMessage: vi.fn().mockResolvedValue(currentMessage),
    recordLlmGeneration: vi.fn(),
  } as unknown as AppRepository;

  return new LlmService(
    loadConfig({ NODE_ENV: "test", LLM_ENABLED: "true" }),
    repository,
    loggerMock(),
    input.provider,
  );
}

describe("LlmService reasoning effort", () => {
  it("keeps gatekeeper reasoning fixed at none", async () => {
    const generateChat = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        shouldRespond: false,
        reason: "NOT_NEEDED",
        confidence: 0.9,
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const service = serviceWith({
      reasoningEffort: "max",
      provider: { generateChat },
    });

    await service.respondToMessage({
      botInstanceId: "bot-1",
      channelId: "dm-1",
      discordUserId: "user-1",
      content: "Hello",
      isDm: true,
      botWasMentioned: false,
    });

    expect(generateChat).toHaveBeenCalledOnce();
    expect(generateChat).toHaveBeenCalledWith(expect.objectContaining({
      reasoningEffort: "none",
    }));
    expect(generateChat.mock.calls[0]?.[0].allowWebSearch).toBeUndefined();
  });

  it("uses the effective reasoning setting for the final answer", async () => {
    const generateChat = vi.fn().mockResolvedValue({
      text: "Final answer",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const service = serviceWith({
      reasoningEffort: "high",
      provider: { generateChat },
    });

    await service.respondToMessage({
      botInstanceId: "bot-1",
      channelId: "dm-1",
      discordUserId: "user-1",
      content: "Hello",
      isDm: true,
      botWasMentioned: true,
    });

    expect(generateChat).toHaveBeenCalledOnce();
    expect(generateChat).toHaveBeenCalledWith(expect.objectContaining({
      reasoningEffort: "high",
      allowWebSearch: true,
    }));
  });
});
