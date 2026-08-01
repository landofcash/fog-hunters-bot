import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AlertNotifier } from "../../src/lib/alerts";
import { ApiError } from "../../src/lib/errors";
import { buildMessages, LlmService } from "../../src/modules/llm/llm.service";
import {
  DEFAULT_ASSISTANT_PROMPT,
  IMMUTABLE_GATEKEEPER_CONTRACT,
} from "../../src/modules/llm/prompts";
import type { LlmProvider } from "../../src/modules/llm/providers/types";
import { createTestApp } from "../helpers/test-app";

async function createLlmFixture(options: { channelEnabled?: boolean; mentionOnly?: boolean } = {}) {
  const fixture = await createTestApp();
  const guild = fixture.repo.seedGuild("guild-llm-prompt", "LLM Prompt Guild");
  fixture.repo.llmGuildSettings.set(guild.id, {
    id: "llm-settings-id",
    guildId: guild.id,
    enabled: true,
    platformEnabled: true,
    defaultModel: "test-model",
    retentionDays: 90,
    dmEnabled: true,
    maxInputChars: 4000,
    maxOutputTokens: 256,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (options.channelEnabled !== false) {
    fixture.repo.llmChannelSettings.set(`${guild.id}:channel-1`, {
      id: "llm-channel-id",
      guildId: guild.id,
      discordChannelId: "channel-1",
      enabled: true,
      respondOnMentionOnly: options.mentionOnly ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return { ...fixture, guild };
}

function messageInput(overrides: Record<string, unknown> = {}) {
  return {
    guildId: "guild-llm-prompt",
    channelId: "channel-1",
    discordUserId: "discord-user",
    content: "What is the answer?",
    isDm: false,
    botWasMentioned: false,
    ...overrides,
  };
}

describe("LlmService", () => {
  it("includes the current user message only once in the generation prompt", async () => {
    const { app, repo, config } = await createLlmFixture();
    try {
      const generateChat = vi
        .fn<LlmProvider["generateChat"]>()
        .mockResolvedValueOnce({
          text: JSON.stringify({ shouldRespond: true, reason: "QUESTION", confidence: 1 }),
          usage: { inputTokens: 5, outputTokens: 5 },
        })
        .mockResolvedValueOnce({
          text: "The answer",
          usage: { inputTokens: 10, outputTokens: 3 },
        });
      const provider: LlmProvider = { generateChat };
      const service = new LlmService(config, repo, app.log as FastifyBaseLogger, provider);

      await service.respondToMessage(messageInput());

      const generationCall = generateChat.mock.calls[1]?.[0];
      expect(generationCall).toBeDefined();
      expect(generationCall?.messages.filter((message) => message.content === "What is the answer?")).toHaveLength(1);
      expect(generationCall?.messages[0]).toEqual({ role: "system", content: DEFAULT_ASSISTANT_PROMPT });
    } finally {
      await app.close();
    }
  });

  it("keeps large system prompts outside the conversation budget and preserves current input", () => {
    const systemPrompt = "s".repeat(32_000);
    const currentContent = "current question";
    const messages = buildMessages({
      systemPrompt,
      summary: "Earlier context",
      recentMessages: Array.from({ length: 20 }, (_, index) => ({
        id: `message-${index}`,
        conversationId: "conversation",
        role: "USER" as const,
        content: "h".repeat(200),
        createdAt: new Date(),
      })),
      currentContent,
      maxInputChars: 1_024,
    });

    expect(messages[0]).toEqual({ role: "system", content: systemPrompt });
    expect(messages.at(-1)).toEqual({ role: "user", content: currentContent });
    expect(messages.slice(1).reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(1_024);
  });

  it("uses isolated assistant and gatekeeper prompts for each guild", async () => {
    const { app, repo, config, guild: guildA } = await createLlmFixture();
    try {
      repo.llmGuildSettings.set(guildA.id, {
        ...(repo.llmGuildSettings.get(guildA.id)!),
        assistantPrompt: "Assistant prompt A",
        gatekeeperPrompt: "Gatekeeper rules A",
      });

      const guildB = repo.seedGuild("guild-llm-b", "LLM Guild B");
      repo.llmGuildSettings.set(guildB.id, {
        id: "llm-settings-b",
        guildId: guildB.id,
        enabled: true,
        platformEnabled: true,
        defaultModel: "test-model",
        assistantPrompt: "Assistant prompt B",
        gatekeeperPrompt: "Gatekeeper rules B",
        retentionDays: 90,
        dmEnabled: true,
        maxInputChars: 4_000,
        maxOutputTokens: 256,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.llmChannelSettings.set(`${guildB.id}:channel-1`, {
        id: "llm-channel-b",
        guildId: guildB.id,
        discordChannelId: "channel-1",
        enabled: true,
        respondOnMentionOnly: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const generateChat = vi
        .fn<LlmProvider["generateChat"]>()
        .mockResolvedValueOnce({
          text: JSON.stringify({ shouldRespond: true, reason: "QUESTION", confidence: 1 }),
          usage: { inputTokens: 1, outputTokens: 1 },
        })
        .mockResolvedValueOnce({
          text: "Answer A",
          usage: { inputTokens: 1, outputTokens: 1 },
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({ shouldRespond: true, reason: "QUESTION", confidence: 1 }),
          usage: { inputTokens: 1, outputTokens: 1 },
        })
        .mockResolvedValueOnce({
          text: "Answer B",
          usage: { inputTokens: 1, outputTokens: 1 },
        });
      const service = new LlmService(config, repo, app.log, { generateChat });

      await service.respondToMessage(messageInput());
      await service.respondToMessage(messageInput({ guildId: "guild-llm-b" }));

      const gatekeeperA = generateChat.mock.calls[0]?.[0].messages[0]?.content ?? "";
      const assistantA = generateChat.mock.calls[1]?.[0].messages[0]?.content ?? "";
      const gatekeeperB = generateChat.mock.calls[2]?.[0].messages[0]?.content ?? "";
      const assistantB = generateChat.mock.calls[3]?.[0].messages[0]?.content ?? "";

      expect(gatekeeperA).toContain("Gatekeeper rules A");
      expect(gatekeeperA).toContain(IMMUTABLE_GATEKEEPER_CONTRACT);
      expect(gatekeeperA).not.toContain("Gatekeeper rules B");
      expect(assistantA).toBe("Assistant prompt A");
      expect(gatekeeperB).toContain("Gatekeeper rules B");
      expect(gatekeeperB).not.toContain("Gatekeeper rules A");
      expect(assistantB).toBe("Assistant prompt B");
    } finally {
      await app.close();
    }
  });

  it("keeps direct messages on global defaults", async () => {
    const { app, repo, config } = await createLlmFixture();
    try {
      const generateChat = vi.fn<LlmProvider["generateChat"]>().mockResolvedValue({
        text: "DM response",
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      const service = new LlmService(config, repo, app.log, { generateChat });

      await service.respondToMessage(messageInput({
        guildId: undefined,
        channelId: undefined,
        isDm: true,
        botWasMentioned: true,
      }));

      expect(generateChat).toHaveBeenCalledTimes(1);
      expect(generateChat.mock.calls[0]?.[0]).toMatchObject({ model: config.llmDefaultModel });
      expect(generateChat.mock.calls[0]?.[0].messages[0]).toEqual({
        role: "system",
        content: DEFAULT_ASSISTANT_PROMPT,
      });
    } finally {
      await app.close();
    }
  });

  it.each([
    ["global disable", { llmEnabled: false }, "LLM_DISABLED"],
    ["kill switch", { llmGlobalKillSwitch: true }, "LLM_DISABLED"],
  ])("short-circuits for %s", async (_label, configPatch, reason) => {
    const { app, repo, config } = await createLlmFixture();
    try {
      const provider: LlmProvider = { generateChat: vi.fn() };
      const service = new LlmService({ ...config, ...configPatch }, repo, app.log, provider);
      await expect(service.respondToMessage(messageInput())).resolves.toMatchObject({ shouldRespond: false, reason });
      expect(provider.generateChat).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ["empty input", { content: "   " }, "EMPTY_INPUT"],
    ["oversized input", { content: "x".repeat(12_001) }, "INPUT_TOO_LARGE"],
  ])("rejects %s without calling the provider", async (_label, overrides, reason) => {
    const { app, repo, config } = await createLlmFixture();
    try {
      const provider: LlmProvider = { generateChat: vi.fn() };
      const service = new LlmService(config, repo, app.log, provider);
      await expect(service.respondToMessage(messageInput(overrides))).resolves.toMatchObject({ shouldRespond: false, reason });
      expect(provider.generateChat).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("requires guild and channel scope for guild messages", async () => {
    const { app, repo, config } = await createLlmFixture();
    try {
      const service = new LlmService(config, repo, app.log, { generateChat: vi.fn() });
      await expect(service.respondToMessage(messageInput({ guildId: undefined }))).rejects.toMatchObject({
        code: "LLM_SCOPE_INVALID",
      });
    } finally {
      await app.close();
    }
  });

  it("enforces disabled and mention-only channel settings", async () => {
    const disabled = await createLlmFixture({ channelEnabled: false });
    const mentionOnly = await createLlmFixture({ mentionOnly: true });
    try {
      const disabledService = new LlmService(disabled.config, disabled.repo, disabled.app.log, { generateChat: vi.fn() });
      await expect(disabledService.respondToMessage(messageInput())).resolves.toMatchObject({ reason: "CHANNEL_NOT_ENABLED" });

      const mentionService = new LlmService(mentionOnly.config, mentionOnly.repo, mentionOnly.app.log, { generateChat: vi.fn() });
      await expect(mentionService.respondToMessage(messageInput())).resolves.toMatchObject({ reason: "MENTION_REQUIRED" });
    } finally {
      await disabled.app.close();
      await mentionOnly.app.close();
    }
  });

  it("bypasses the decision call when the bot is mentioned and caps output tokens", async () => {
    const { app, repo, config } = await createLlmFixture({ channelEnabled: false });
    try {
      const generateChat = vi.fn<LlmProvider["generateChat"]>().mockResolvedValue({
        text: "Mention response",
        usage: { inputTokens: 4, outputTokens: 2 },
      });
      const service = new LlmService(config, repo, app.log, { generateChat });
      const result = await service.respondToMessage(messageInput({ botWasMentioned: true }));

      expect(result).toMatchObject({ shouldRespond: true, replyText: "Mention response" });
      expect(generateChat).toHaveBeenCalledTimes(1);
      expect(generateChat.mock.calls[0]?.[0].maxTokens).toBe(256);
      expect(repo.llmGenerations[0]).toMatchObject({ status: "SUCCESS", outputTokens: 2 });
    } finally {
      await app.close();
    }
  });

  it("does not persist a user message when the gatekeeper rejects or is unparseable", async () => {
    for (const text of [JSON.stringify({ shouldRespond: false, reason: "CHATTER", confidence: 0.9 }), "not-json"]) {
      const { app, repo, config } = await createLlmFixture();
      try {
        const provider: LlmProvider = {
          generateChat: vi.fn().mockResolvedValue({ text, usage: { inputTokens: 1, outputTokens: 1 } }),
        };
        const service = new LlmService(config, repo, app.log, provider);
        const result = await service.respondToMessage(messageInput());
        expect(result.shouldRespond).toBe(false);
        expect(repo.llmMessages).toHaveLength(0);
      } finally {
        await app.close();
      }
    }
  });

  it("records failed generations and moderation metadata", async () => {
    const { app, repo, config } = await createLlmFixture();
    try {
      const generateChat = vi
        .fn<LlmProvider["generateChat"]>()
        .mockResolvedValueOnce({
          text: JSON.stringify({ shouldRespond: true, reason: "QUESTION", confidence: 1 }),
          usage: { inputTokens: 1, outputTokens: 1 },
        })
        .mockRejectedValueOnce(new ApiError(504, "LLM_TIMEOUT", "Timed out"));
      const alerts: AlertNotifier = {
        notify: vi.fn().mockResolvedValue(true),
      };
      const service = new LlmService(config, repo, app.log, { generateChat }, alerts);

      await expect(service.respondToMessage(messageInput())).resolves.toMatchObject({
        shouldRespond: false,
        reason: "LLM_TIMEOUT",
      });
      expect(repo.llmGenerations[0]).toMatchObject({ status: "FAILED", errorCode: "LLM_TIMEOUT" });
      expect(repo.llmModerationEvents[0]).toMatchObject({ category: "generation_error" });
      expect(alerts.notify).toHaveBeenCalledWith({
        event: "api.openai.failure",
        title: "OpenAI request failed",
        severity: "error",
        details: {
          phase: "generation",
          model: "test-model",
          code: "LLM_TIMEOUT",
          statusCode: 504,
          guildId: "guild-llm-prompt",
          channelId: "channel-1",
        },
      });
    } finally {
      await app.close();
    }
  });

  it("does not call the provider when platform AI access is suspended", async () => {
    const { app, repo, config, guild } = await createLlmFixture();
    try {
      repo.llmGuildSettings.set(guild.id, {
        ...repo.llmGuildSettings.get(guild.id)!,
        platformEnabled: false,
      });
      const provider: LlmProvider = { generateChat: vi.fn() };
      const service = new LlmService(config, repo, app.log, provider);

      await expect(service.respondToMessage(messageInput())).resolves.toMatchObject({
        shouldRespond: false,
        reason: "LLM_DISABLED_BY_PLATFORM",
      });
      expect(provider.generateChat).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("alerts when the OpenAI gatekeeper call fails without persisting message content", async () => {
    const { app, repo, config } = await createLlmFixture();
    try {
      const alerts: AlertNotifier = {
        notify: vi.fn().mockResolvedValue(true),
      };
      const generateChat = vi.fn<LlmProvider["generateChat"]>()
        .mockRejectedValue(new ApiError(502, "LLM_PROVIDER_ERROR", "Provider unavailable"));
      const service = new LlmService(config, repo, app.log, { generateChat }, alerts);

      await expect(service.respondToMessage(messageInput())).rejects.toMatchObject({
        code: "LLM_PROVIDER_ERROR",
      });
      expect(alerts.notify).toHaveBeenCalledWith(expect.objectContaining({
        event: "api.openai.failure",
        details: expect.objectContaining({
          phase: "gatekeeper",
          model: "test-model",
          guildId: "guild-llm-prompt",
          channelId: "channel-1",
        }),
      }));
      expect(JSON.stringify(vi.mocked(alerts.notify).mock.calls)).not.toContain("What is the answer?");
      expect(repo.llmMessages).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("summarizes conversations only after the message threshold", async () => {
    const { app, repo, config } = await createLlmFixture();
    try {
      const conversation = await repo.getOrCreateConversation({
        type: "GUILD_CHANNEL",
        guildDiscordId: "guild-llm-prompt",
        channelId: "summary-channel",
      });
      const service = new LlmService(config, repo, app.log, { generateChat: vi.fn() });
      const shortHistory = Array.from({ length: 29 }, (_, index) => ({
        id: `short-${index}`,
        conversationId: conversation.id,
        role: "USER" as const,
        content: `message ${index}`,
        createdAt: new Date(),
      }));
      await service.summarizeConversation(conversation, shortHistory);
      expect((await repo.getOrCreateConversation({ type: "GUILD_CHANNEL", guildDiscordId: "guild-llm-prompt", channelId: "summary-channel" })).summaryText).toBeNull();

      await service.summarizeConversation(conversation, [...shortHistory, {
        id: "threshold",
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "threshold message",
        createdAt: new Date(),
      }]);
      expect((await repo.getOrCreateConversation({ type: "GUILD_CHANNEL", guildDiscordId: "guild-llm-prompt", channelId: "summary-channel" })).summaryText)
        .toContain("threshold message");
    } finally {
      await app.close();
    }
  });
});
