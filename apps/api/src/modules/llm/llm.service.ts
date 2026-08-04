import type { FastifyBaseLogger } from "fastify";
import {
  DiscordWebhookAlertNotifier,
  type AlertNotifier,
} from "../../lib/alerts";
import type { AppConfig } from "../../lib/config";
import { ApiError } from "../../lib/errors";
import type {
  AppRepository,
  EffectiveBotSettings,
  LlmConversationRecord,
  LlmMessageRecord,
} from "../../repositories/types";
import { createLlmProvider } from "./providers/provider-router";
import type {
  GenerateChatInput,
  GenerateChatOutput,
  LlmChatMessage,
  LlmProvider,
} from "./providers/types";
import { buildGatekeeperPrompt, effectiveAssistantPrompt } from "./prompts";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function capByChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

export function buildMessages(input: {
  systemPrompt: string;
  summary?: string | null;
  recentMessages: LlmMessageRecord[];
  currentContent: string;
  maxInputChars: number;
}): LlmChatMessage[] {
  const messages: LlmChatMessage[] = [{ role: "system", content: input.systemPrompt }];

  const budget = Math.max(1024, input.maxInputChars);
  const currentContent = capByChars(input.currentContent, budget);
  let remainingChars = budget - currentContent.length;

  if (input.summary) {
    const summary = capByChars(`Conversation summary: ${input.summary}`, remainingChars);
    if (summary) {
      messages.push({ role: "system", content: summary });
      remainingChars -= summary.length;
    }
  }

  const selectedHistory: LlmChatMessage[] = [];
  const tail = input.recentMessages.slice(-20).reverse();
  for (const row of tail) {
    const role = row.role === "ASSISTANT" ? "assistant" : row.role === "SYSTEM" ? "system" : "user";
    const content = row.content;
    if (content.length > remainingChars) {
      continue;
    }
    selectedHistory.push({ role, content });
    remainingChars -= content.length;
  }
  messages.push(...selectedHistory.reverse());

  messages.push({ role: "user", content: currentContent });
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
  botInstanceId: string;
  guildId?: string;
  channelId?: string;
  discordUserId: string;
  content: string;
  messageId?: string;
  contextMessages?: Array<{
    discordUserId: string;
    content: string;
    messageId?: string;
  }>;
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
  private readonly alerts: AlertNotifier;

  constructor(
    private readonly config: AppConfig,
    private readonly repository: AppRepository,
    private readonly logger: FastifyBaseLogger,
    provider?: LlmProvider,
    alerts?: AlertNotifier,
  ) {
    this.provider = provider ?? null;
    this.alerts = alerts ?? new DiscordWebhookAlertNotifier(
      config.alertDiscordWebhookUrl,
      "fhaibot-api",
      logger,
      config.alertCooldownMs,
      config.alertRequestTimeoutMs,
    );
  }

  private getProvider(): LlmProvider {
    if (!this.provider) {
      this.provider = createLlmProvider(this.config);
    }
    return this.provider;
  }

  private async generateChat(
    input: GenerateChatInput,
    context: {
      phase: "gatekeeper" | "generation";
      guildId?: string;
      channelId?: string;
    },
  ): Promise<GenerateChatOutput> {
    try {
      return await this.getProvider().generateChat(input);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      await this.alerts.notify({
        event: "api.openai.failure",
        title: "OpenAI request failed",
        severity: "error",
        details: {
          phase: context.phase,
          model: input.model,
          code: apiError?.code ?? "UNKNOWN",
          statusCode: apiError?.statusCode,
          guildId: context.guildId,
          channelId: context.channelId,
        },
      });
      throw error;
    }
  }

  private async decideShouldRespond(input: {
    model: string;
    isDm: boolean;
    botWasMentioned: boolean;
    content: string;
    recentMessages: LlmMessageRecord[];
    settings?: EffectiveBotSettings;
    guildId?: string;
    channelId?: string;
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
        content: buildGatekeeperPrompt(input.settings),
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

    const response = await this.generateChat(
      {
        model: input.model,
        messages: decisionMessages,
        maxTokens: 120,
        timeoutMs: this.config.llmRequestTimeoutMs,
      },
      {
        phase: "gatekeeper",
        guildId: input.guildId,
        channelId: input.channelId,
      },
    );

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

    let settings: EffectiveBotSettings;
    let guildInternalId: string | undefined;
    let botInstallationId: string | undefined;
    let mentionRequired = false;

    if (input.isDm) {
      if (input.guildId) {
        throw new ApiError(400, "LLM_SCOPE_INVALID", "DM requests cannot select a guild installation.");
      }
      settings = await this.repository.getEffectiveBotSettings({
        botInstanceId: input.botInstanceId,
      });
      if (!settings.dmEnabled) {
        return {
          shouldRespond: false,
          reason: "DM_DISABLED",
        };
      }
    } else {
      if (!input.guildId || !input.channelId) {
        throw new ApiError(400, "LLM_SCOPE_INVALID", "guildId and channelId are required for guild messages.");
      }

      settings = await this.repository.getEffectiveBotSettings({
        botInstanceId: input.botInstanceId,
        guildDiscordId: input.guildId,
      });
      const installation = settings.installation;
      const installationSettings = settings.installationSettings;
      if (!installation || !installationSettings) {
        throw new ApiError(404, "BOT_NOT_INSTALLED", "The bot is not installed in this guild.");
      }
      guildInternalId = installation.guildId;
      botInstallationId = installation.id;

      if (installation.guildStatus !== "ACTIVE") {
        return {
          shouldRespond: false,
          reason: "GUILD_DISABLED",
        };
      }
      if (installation.presenceStatus !== "PRESENT") {
        return {
          shouldRespond: false,
          reason: "BOT_NOT_INSTALLED",
        };
      }
      if (installation.operationalStatus !== "ENABLED") {
        return {
          shouldRespond: false,
          reason: "BOT_DISABLED",
        };
      }
      if (!installationSettings.llmEnabledByPlatform) {
        return {
          shouldRespond: false,
          reason: "LLM_DISABLED_BY_PLATFORM",
        };
      }

      if (!installationSettings.llmEnabledByGuild) {
        return {
          shouldRespond: false,
          reason: "LLM_DISABLED",
        };
      }

      const channelSettings = await this.repository.getLlmChannelSettings(
        input.botInstanceId,
        input.guildId,
        input.channelId,
      );
      if (!channelSettings?.enabled) {
        if (!input.botWasMentioned) {
          return {
            shouldRespond: false,
            reason: "CHANNEL_NOT_ENABLED",
          };
        }
      } else if (channelSettings.respondOnMentionOnly && !input.botWasMentioned) {
        mentionRequired = true;
      }
    }

    const scopeType = input.isDm ? "DM" : "GUILD_CHANNEL";
    const conversation = await this.repository.getOrCreateConversation({
      botInstanceId: input.botInstanceId,
      type: scopeType,
      guildDiscordId: input.guildId,
      channelId: input.channelId,
      discordUserId: input.discordUserId,
    });

    const maxInputChars = Math.min(settings.maxInputChars, this.config.llmMaxInputChars);
    for (const contextMessage of (input.contextMessages ?? []).slice(-19)) {
      const contextContent = contextMessage.content.trim();
      if (!contextContent) {
        continue;
      }
      const storedContent = capByChars(contextContent, maxInputChars);
      await this.repository.appendConversationMessage({
        conversationId: conversation.id,
        role: "USER",
        content: storedContent,
        tokenCount: estimateTokens(storedContent),
      });
    }

    const content = capByChars(trimmed, maxInputChars);

    if (mentionRequired) {
      await this.repository.appendConversationMessage({
        conversationId: conversation.id,
        role: "USER",
        content,
        tokenCount: estimateTokens(content),
      });
      return {
        shouldRespond: false,
        reason: "MENTION_REQUIRED",
        conversationId: conversation.id,
      };
    }

    const recentMessages = await this.repository.listRecentConversationMessages(conversation.id, 20);
    const model = settings.model;

    const decision = await this.decideShouldRespond({
      model,
      isDm: input.isDm,
      botWasMentioned: input.botWasMentioned,
      content,
      recentMessages,
      settings,
      guildId: input.guildId,
      channelId: input.channelId,
    });

    const currentMessage = await this.repository.appendConversationMessage({
      conversationId: conversation.id,
      role: "USER",
      content,
      tokenCount: estimateTokens(content),
    });

    if (!decision.shouldRespond) {
      return {
        shouldRespond: false,
        reason: "LLM_DECISION_NO_RESPONSE",
        conversationId: conversation.id,
        decision,
      };
    }

    const generationContext = await this.repository.listRecentConversationMessages(conversation.id, 20);

    const maxOutputTokens = Math.min(
      settings.maxOutputTokens,
      this.config.llmMaxOutputTokens,
    );

    const promptMessages = buildMessages({
      systemPrompt: effectiveAssistantPrompt(settings),
      summary: conversation.summaryText,
      recentMessages: generationContext.filter((message) => message.id !== currentMessage.id),
      currentContent: content,
      maxInputChars,
    });

    const startedAt = Date.now();
    try {
      const completion = await this.generateChat(
        {
          model,
          messages: promptMessages,
          maxTokens: maxOutputTokens,
          timeoutMs: this.config.llmRequestTimeoutMs,
        },
        {
          phase: "generation",
          guildId: input.guildId,
          channelId: input.channelId,
        },
      );

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
        botInstanceId: input.botInstanceId,
        botInstallationId,
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
        botInstanceId: input.botInstanceId,
        botInstallationId,
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
        botInstanceId: input.botInstanceId,
        botInstallationId,
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
