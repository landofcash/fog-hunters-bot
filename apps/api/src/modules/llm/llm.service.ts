import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../../lib/config";
import { ApiError } from "../../lib/errors";
import type {
  AppRepository,
  LlmConversationRecord,
  LlmGuildSettingsRecord,
  LlmMessageRecord,
} from "../../repositories/types";
import { createLlmProvider } from "./providers/provider-router";
import type { LlmChatMessage, LlmProvider } from "./providers/types";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function capByChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

function buildSystemPrompt(settings?: LlmGuildSettingsRecord): string {
  const base = "You are a helpful Discord bot assistant. Keep responses concise, clear, and friendly in a casual chat style.";
  if (!settings?.stylePrompt) {
    return base;
  }
  return `${settings.stylePrompt}`;
}

export function buildMessages(input: {
  systemPrompt: string;
  summary?: string | null;
  recentMessages: LlmMessageRecord[];
  currentContent: string;
  maxInputChars: number;
}): LlmChatMessage[] {
  const messages: LlmChatMessage[] = [{ role: "system", content: input.systemPrompt }];

  if (input.summary) {
    messages.push({ role: "system", content: `Conversation summary: ${input.summary}` });
  }

  const budget = Math.max(1024, input.maxInputChars);
  let usedChars = messages.reduce((sum, item) => sum + item.content.length, 0);

  const tail = input.recentMessages.slice(-20);
  for (const row of tail) {
    const role = row.role === "ASSISTANT" ? "assistant" : row.role === "SYSTEM" ? "system" : "user";
    const content = row.content;
    if (usedChars + content.length > budget) {
      continue;
    }
    messages.push({ role, content });
    usedChars += content.length;
  }

  const content = capByChars(input.currentContent, Math.max(1, budget - usedChars));
  messages.push({ role: "user", content });
  return messages;
}

interface LlmDecision {
  shouldRespond: boolean;
  reason: string;
  confidence: number;
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return withoutFence.slice(start, end + 1);
}

function parseDecision(raw: string): LlmDecision | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      shouldRespond?: unknown;
      reason?: unknown;
      confidence?: unknown;
    };
    if (typeof parsed.shouldRespond !== "boolean") {
      return null;
    }
    const reason = typeof parsed.reason === "string" ? parsed.reason : "UNSPECIFIED";
    const confidenceRaw = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    const confidence = Math.min(1, Math.max(0, confidenceRaw));
    return {
      shouldRespond: parsed.shouldRespond,
      reason,
      confidence,
    };
  } catch {
    return null;
  }
}

export interface InternalLlmRespondInput {
  guildId?: string;
  channelId?: string;
  discordUserId: string;
  content: string;
  messageId?: string;
  isDm: boolean;
  botWasMentioned: boolean;
}

export interface InternalLlmRespondResult {
  shouldRespond: boolean;
  reason?: string;
  replyText?: string;
  conversationId?: string;
  decision?: {
    shouldRespond: boolean;
    reason: string;
    confidence: number;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export class LlmService {
  private provider: LlmProvider | null;

  constructor(
    private readonly config: AppConfig,
    private readonly repository: AppRepository,
    private readonly logger: FastifyBaseLogger,
    provider?: LlmProvider,
  ) {
    this.provider = provider ?? null;
  }

  private getProvider(): LlmProvider {
    if (!this.provider) {
      this.provider = createLlmProvider(this.config);
    }
    return this.provider;
  }

  private async decideShouldRespond(input: {
    model: string;
    isDm: boolean;
    botWasMentioned: boolean;
    content: string;
    recentMessages: LlmMessageRecord[];
  }): Promise<LlmDecision> {
    if (input.botWasMentioned) {
      return {
        shouldRespond: true,
        reason: "BOT_MENTIONED",
        confidence: 1,
      };
    }

    const recentContext = input.recentMessages
      .slice(-6)
      .map((row) => `${row.role}: ${capByChars(row.content, 240)}`)
      .join("\n");

    const decisionMessages: LlmChatMessage[] = [
      {
        role: "system",
        content: [
          "You are a Discord response gatekeeper.",
          "Decide if the assistant should respond to the latest user message.",
          "Return ONLY JSON with this exact shape:",
          '{"shouldRespond": boolean, "reason": string, "confidence": number}',
          "Rules:",
          "- shouldRespond=true when the message asks for help/info, asks a question, or clearly benefits from bot response.",
          "- shouldRespond=false for side chatter, acknowledgments, emojis, or conversation where bot input is unnecessary.",
          "- confidence must be between 0 and 1.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          isDm: input.isDm,
          botWasMentioned: input.botWasMentioned,
          currentMessage: capByChars(input.content, 1500),
          recentContext,
        }),
      },
    ];

    const response = await this.getProvider().generateChat({
      model: input.model,
      messages: decisionMessages,
      maxTokens: 120,
      timeoutMs: this.config.llmRequestTimeoutMs,
    });

    const parsed = parseDecision(response.text);
    if (!parsed) {
      return {
        shouldRespond: false,
        reason: "UNPARSEABLE_DECISION",
        confidence: 0,
      };
    }
    return parsed;
  }

  async respondToMessage(input: InternalLlmRespondInput): Promise<InternalLlmRespondResult> {
    if (!this.config.llmEnabled || this.config.llmGlobalKillSwitch) {
      return {
        shouldRespond: false,
        reason: "LLM_DISABLED",
      };
    }

    const trimmed = input.content.trim();
    if (!trimmed) {
      return {
        shouldRespond: false,
        reason: "EMPTY_INPUT",
      };
    }

    if (trimmed.length > this.config.llmMaxInputChars * 3) {
      return {
        shouldRespond: false,
        reason: "INPUT_TOO_LARGE",
      };
    }

    let guildSettings: LlmGuildSettingsRecord | undefined;
    let guildInternalId: string | undefined;

    if (!input.isDm) {
      if (!input.guildId || !input.channelId) {
        throw new ApiError(400, "LLM_SCOPE_INVALID", "guildId and channelId are required for guild messages.");
      }

      const guildSettingsResult = await this.repository.getOrCreateLlmGuildSettings(input.guildId);
      guildSettings = guildSettingsResult.settings;
      guildInternalId = guildSettingsResult.guild.id;

      if (!guildSettings.enabled) {
        return {
          shouldRespond: false,
          reason: "LLM_DISABLED",
        };
      }

      const channelSettings = await this.repository.getLlmChannelSettings(input.guildId, input.channelId);
      if (!channelSettings?.enabled) {
        if (!input.botWasMentioned) {
          return {
            shouldRespond: false,
            reason: "CHANNEL_NOT_ENABLED",
          };
        }
      } else if (channelSettings.respondOnMentionOnly && !input.botWasMentioned) {
        return {
          shouldRespond: false,
          reason: "MENTION_REQUIRED",
        };
      }
    }

    const scopeType = input.isDm ? "DM" : "GUILD_CHANNEL";
    const conversation = await this.repository.getOrCreateConversation({
      type: scopeType,
      guildDiscordId: input.guildId,
      channelId: input.channelId,
      discordUserId: input.discordUserId,
    });

    const content = capByChars(trimmed, guildSettings?.maxInputChars ?? this.config.llmMaxInputChars);
    const recentMessages = await this.repository.listRecentConversationMessages(conversation.id, 20);
    const model = guildSettings?.defaultModel ?? this.config.llmDefaultModel;

    const decision = await this.decideShouldRespond({
      model,
      isDm: input.isDm,
      botWasMentioned: input.botWasMentioned,
      content,
      recentMessages,
    });

    if (!decision.shouldRespond) {
      return {
        shouldRespond: false,
        reason: "LLM_DECISION_NO_RESPONSE",
        conversationId: conversation.id,
        decision,
      };
    }

    const currentMessage = await this.repository.appendConversationMessage({
      conversationId: conversation.id,
      role: "USER",
      content,
      tokenCount: estimateTokens(content),
    });

    const generationContext = await this.repository.listRecentConversationMessages(conversation.id, 20);

    const maxOutputTokens = Math.min(
      guildSettings?.maxOutputTokens ?? this.config.llmMaxOutputTokens,
      this.config.llmMaxOutputTokens,
    );

    const promptMessages = buildMessages({
      systemPrompt: buildSystemPrompt(guildSettings),
      summary: conversation.summaryText,
      recentMessages: generationContext.filter((message) => message.id !== currentMessage.id),
      currentContent: content,
      maxInputChars: guildSettings?.maxInputChars ?? this.config.llmMaxInputChars,
    });

    const startedAt = Date.now();
    try {
      const completion = await this.getProvider().generateChat({
        model,
        messages: promptMessages,
        maxTokens: maxOutputTokens,
        timeoutMs: this.config.llmRequestTimeoutMs,
      });

      const responseText = completion.text.trim();
      if (!responseText) {
        return {
          shouldRespond: false,
          reason: "EMPTY_RESPONSE",
        };
      }

      await this.repository.appendConversationMessage({
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: responseText,
        tokenCount: completion.usage.outputTokens,
      });

      const refreshedMessages = await this.repository.listRecentConversationMessages(conversation.id, 40);
      await this.summarizeConversation(conversation, refreshedMessages);

      await this.repository.recordLlmGeneration({
        conversationId: conversation.id,
        guildId: guildInternalId,
        provider: this.config.llmProvider,
        model,
        status: "SUCCESS",
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
        latencyMs: Date.now() - startedAt,
      });

      return {
        shouldRespond: true,
        replyText: responseText,
        conversationId: conversation.id,
        decision,
        usage: completion.usage,
      };
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;

      await this.repository.recordLlmGeneration({
        conversationId: conversation.id,
        guildId: guildInternalId,
        provider: this.config.llmProvider,
        model,
        status: "FAILED",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - startedAt,
        errorCode: apiError?.code,
        errorText: apiError?.message ?? "Unknown provider error",
      });

      await this.repository.recordLlmModerationEvent({
        guildId: guildInternalId,
        conversationId: conversation.id,
        category: "generation_error",
        action: "allow",
        details: {
          code: apiError?.code ?? "UNKNOWN",
        },
      });

      this.logger.warn(
        {
          err: error,
          guildId: input.guildId,
          channelId: input.channelId,
          conversationId: conversation.id,
        },
        "LLM generation failed",
      );

      return {
        shouldRespond: false,
        reason: apiError?.code ?? "LLM_PROVIDER_ERROR",
      };
    }
  }

  async summarizeConversation(conversation: LlmConversationRecord, recentMessages: LlmMessageRecord[]): Promise<void> {
    if (recentMessages.length < 30) {
      return;
    }

    const summarySource = recentMessages.slice(-8).map((row) => `${row.role}: ${row.content}`).join("\n");
    const summary = capByChars(summarySource, 1000);
    await this.repository.updateConversationSummary(conversation.id, summary);
  }
}
