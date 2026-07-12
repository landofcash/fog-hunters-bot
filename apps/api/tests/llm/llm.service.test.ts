import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/errors";
import { LlmService } from "../../src/modules/llm/llm.service";
import type { LlmProvider } from "../../src/modules/llm/providers/types";
import { createTestApp } from "../helpers/test-app";

async function createLlmFixture(options: { channelEnabled?: boolean; mentionOnly?: boolean } = {}) {
  const fixture = await createTestApp();
  const guild = fixture.repo.seedGuild("guild-llm-prompt", "LLM Prompt Guild");
  fixture.repo.llmGuildSettings.set(guild.id, {
    id: "llm-settings-id",
    guildId: guild.id,
    enabled: true,
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
      const service = new LlmService(config, repo, app.log, { generateChat });

      await expect(service.respondToMessage(messageInput())).resolves.toMatchObject({
        shouldRespond: false,
        reason: "LLM_TIMEOUT",
      });
      expect(repo.llmGenerations[0]).toMatchObject({ status: "FAILED", errorCode: "LLM_TIMEOUT" });
      expect(repo.llmModerationEvents[0]).toMatchObject({ category: "generation_error" });
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
