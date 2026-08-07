import type { Message } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import { isApiClientError } from "../runtime/errors";
import { touchUserFromMessage } from "../runtime/user-touch";

export const MESSAGE_BUFFER_IDLE_MS = 4_000;
export const MESSAGE_BUFFER_MAX_WAIT_MS = 10_000;
export const MESSAGE_BUFFER_MAX_MESSAGES = 20;
export const DIRECT_MENTION_FAILURE_REPLY =
  "Sorry, I couldn't complete that response in time. Please try again.";

const DIRECT_MENTION_FAILURE_REASONS = new Set([
  "EMPTY_RESPONSE",
  "LLM_PROVIDER_EMPTY_RESPONSE",
  "LLM_PROVIDER_ERROR",
  "LLM_TIMEOUT",
]);

interface PendingMessageBatch {
  messages: Message[];
  completionWaiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>;
  idleTimer: ReturnType<typeof setTimeout>;
  maxWaitTimer: ReturnType<typeof setTimeout>;
}

function splitForDiscord(content: string): string[] {
  if (content.length <= 2000) {
    return [content];
  }

  const parts: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, 2000);
    parts.push(chunk);
    remaining = remaining.slice(2000);
  }
  return parts;
}

export function shouldIgnoreMessage(message: Message): boolean {
  return message.author.bot || Boolean(message.webhookId) || !message.content.trim();
}

function wasBotMentioned(message: Message): boolean {
  const botUserId = message.client.user?.id;
  return botUserId ? message.mentions.has(botUserId) : false;
}

function compareDiscordSnowflakes(left: Message, right: Message): number {
  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

async function sendMessageChunks(input: {
  message: Message;
  content: string;
  logger: Logger;
  canProcess: () => boolean;
}): Promise<boolean> {
  const { message, content, logger, canProcess } = input;
  if (!("send" in message.channel) || typeof message.channel.send !== "function") {
    return false;
  }

  for (const chunk of splitForDiscord(content)) {
    if (!canProcess()) {
      logger.warn(
        { guildId: message.guildId, channelId: message.channelId },
        "Message reply cancelled because the runtime is quarantined",
      );
      return false;
    }
    await message.channel.send({ content: chunk });
  }
  return true;
}

async function processMessageBatch(input: {
  messages: Message[];
  apiClient: ApiClient;
  logger: Logger;
  canProcess?: () => boolean;
}): Promise<void> {
  const { messages, apiClient, logger, canProcess = () => true } = input;
  const message = messages.at(-1);
  if (!message || !canProcess()) {
    return;
  }

  const content = message.content.trim();
  const isDm = !message.guildId;
  const botWasMentioned = wasBotMentioned(message);

  try {
    const response = await apiClient.respondWithLlm({
      guildId: message.guildId ?? undefined,
      channelId: message.channelId,
      discordUserId: message.author.id,
      content,
      messageId: message.id,
      contextMessages: messages.slice(0, -1).map((contextMessage) => ({
        discordUserId: contextMessage.author.id,
        content: contextMessage.content.trim(),
        messageId: contextMessage.id,
      })),
      isDm,
      botWasMentioned,
    });

    if (!response.shouldRespond || !response.replyText) {
      if (
        botWasMentioned
        && response.reason
        && DIRECT_MENTION_FAILURE_REASONS.has(response.reason)
      ) {
        logger.warn(
          {
            guildId: message.guildId,
            channelId: message.channelId,
            discordUserId: message.author.id,
            reason: response.reason,
          },
          "Direct mention LLM response failed",
        );
        await sendMessageChunks({
          message,
          content: DIRECT_MENTION_FAILURE_REPLY,
          logger,
          canProcess,
        });
      }
      return;
    }

    await sendMessageChunks({
      message,
      content: response.replyText,
      logger,
      canProcess,
    });
  } catch (error) {
    if (isApiClientError(error) && (error.statusCode === 403 || error.statusCode === 404)) {
      logger.debug(
        {
          guildId: message.guildId,
          channelId: message.channelId,
          discordUserId: message.author.id,
          code: error.code,
        },
        "Message LLM response denied",
      );
      return;
    }

    logger.warn(
      {
        err: error,
        guildId: message.guildId,
        channelId: message.channelId,
        discordUserId: message.author.id,
        batchSize: messages.length,
      },
      "Failed to process message for LLM response",
    );

    if (botWasMentioned) {
      try {
        const fallbackSent = await sendMessageChunks({
          message,
          content: DIRECT_MENTION_FAILURE_REPLY,
          logger,
          canProcess,
        });
        if (fallbackSent) {
          return;
        }
      } catch (fallbackError) {
        logger.warn(
          {
            err: fallbackError,
            guildId: message.guildId,
            channelId: message.channelId,
          },
          "Failed to send direct mention failure reply",
        );
      }
    }

    throw error;
  }
}

export async function handleMessageCreateEvent(input: {
  message: Message;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { message, apiClient, logger } = input;
  if (shouldIgnoreMessage(message)) {
    return;
  }

  await touchUserFromMessage(apiClient, message, logger);
  await processMessageBatch({ messages: [message], apiClient, logger });
}

export class MessageResponseBuffer {
  private readonly batches = new Map<string, PendingMessageBatch>();
  private readonly idleMs: number;
  private readonly maxWaitMs: number;
  private readonly maxMessages: number;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly logger: Logger,
    options: {
      idleMs?: number;
      maxWaitMs?: number;
      maxMessages?: number;
    } = {},
    private readonly canProcess: () => boolean = () => true,
  ) {
    this.idleMs = options.idleMs ?? MESSAGE_BUFFER_IDLE_MS;
    this.maxWaitMs = options.maxWaitMs ?? MESSAGE_BUFFER_MAX_WAIT_MS;
    this.maxMessages = options.maxMessages ?? MESSAGE_BUFFER_MAX_MESSAGES;
  }

  async enqueue(message: Message): Promise<void> {
    await this.enqueueInternal(message, false);
  }

  async enqueueAndWait(message: Message): Promise<void> {
    await this.enqueueInternal(message, true);
  }

  private async enqueueInternal(
    message: Message,
    waitForProcessing: boolean,
  ): Promise<void> {
    if (shouldIgnoreMessage(message) || !this.canProcess()) {
      return;
    }

    const touchPromise = touchUserFromMessage(this.apiClient, message, this.logger);

    if (!message.guildId) {
      await Promise.all([
        touchPromise,
        processMessageBatch({
          messages: [message],
          apiClient: this.apiClient,
          logger: this.logger,
          canProcess: this.canProcess,
        }),
      ]);
      return;
    }

    const key = `${this.apiClient.botInstanceId}:${message.guildId}:${message.channelId}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = {
        messages: [],
        completionWaiters: [],
        idleTimer: setTimeout(() => {
          void this.flush(key).catch(() => undefined);
        }, this.idleMs),
        maxWaitTimer: setTimeout(() => {
          void this.flush(key).catch(() => undefined);
        }, this.maxWaitMs),
      };
      this.batches.set(key, batch);
    }

    batch.messages.push(message);
    const completion = waitForProcessing
      ? new Promise<void>((resolve, reject) =>
          batch?.completionWaiters.push({ resolve, reject }),
        )
      : Promise.resolve();
    clearTimeout(batch.idleTimer);
    batch.idleTimer = setTimeout(() => {
      void this.flush(key).catch(() => undefined);
    }, this.idleMs);

    const shouldFlushImmediately =
      wasBotMentioned(message) || batch.messages.length >= this.maxMessages;
    const flushPromise = shouldFlushImmediately ? this.flush(key) : Promise.resolve();
    await Promise.all([touchPromise, flushPromise, completion]);
  }

  async flushAll(): Promise<void> {
    await Promise.all(Array.from(this.batches.keys(), (key) => this.flush(key)));
  }

  cancelAll(): void {
    for (const batch of this.batches.values()) {
      clearTimeout(batch.idleTimer);
      clearTimeout(batch.maxWaitTimer);
      for (const waiter of batch.completionWaiters) waiter.resolve();
    }
    this.batches.clear();
  }

  private async flush(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) {
      return;
    }

    this.batches.delete(key);
    clearTimeout(batch.idleTimer);
    clearTimeout(batch.maxWaitTimer);
    try {
      await processMessageBatch({
        messages: [...batch.messages].sort(compareDiscordSnowflakes),
        apiClient: this.apiClient,
        logger: this.logger,
        canProcess: this.canProcess,
      });
      for (const waiter of batch.completionWaiters) waiter.resolve();
    } catch (error) {
      for (const waiter of batch.completionWaiters) waiter.reject(error);
      throw error;
    }
  }
}
