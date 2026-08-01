import type { Message } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import { isApiClientError } from "../runtime/errors";
import { touchUserFromMessage } from "../runtime/user-touch";

export const MESSAGE_BUFFER_IDLE_MS = 4_000;
export const MESSAGE_BUFFER_MAX_WAIT_MS = 10_000;
export const MESSAGE_BUFFER_MAX_MESSAGES = 20;

interface PendingMessageBatch {
  messages: Message[];
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

function shouldIgnoreMessage(message: Message): boolean {
  return message.author.bot || Boolean(message.webhookId) || !message.content.trim();
}

function wasBotMentioned(message: Message): boolean {
  const botUserId = message.client.user?.id;
  return botUserId ? message.mentions.has(botUserId) : false;
}

async function processMessageBatch(input: {
  messages: Message[];
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { messages, apiClient, logger } = input;
  const message = messages.at(-1);
  if (!message) {
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
      return;
    }

    const chunks = splitForDiscord(response.replyText);
    for (const chunk of chunks) {
      if ("send" in message.channel && typeof message.channel.send === "function") {
        await message.channel.send({ content: chunk });
      }
    }
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
  ) {
    this.idleMs = options.idleMs ?? MESSAGE_BUFFER_IDLE_MS;
    this.maxWaitMs = options.maxWaitMs ?? MESSAGE_BUFFER_MAX_WAIT_MS;
    this.maxMessages = options.maxMessages ?? MESSAGE_BUFFER_MAX_MESSAGES;
  }

  async enqueue(message: Message): Promise<void> {
    if (shouldIgnoreMessage(message)) {
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
        }),
      ]);
      return;
    }

    const key = `${message.guildId}:${message.channelId}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = {
        messages: [],
        idleTimer: setTimeout(() => {
          void this.flush(key);
        }, this.idleMs),
        maxWaitTimer: setTimeout(() => {
          void this.flush(key);
        }, this.maxWaitMs),
      };
      this.batches.set(key, batch);
    }

    batch.messages.push(message);
    clearTimeout(batch.idleTimer);
    batch.idleTimer = setTimeout(() => {
      void this.flush(key);
    }, this.idleMs);

    const shouldFlushImmediately =
      wasBotMentioned(message) || batch.messages.length >= this.maxMessages;
    const flushPromise = shouldFlushImmediately ? this.flush(key) : Promise.resolve();
    await Promise.all([touchPromise, flushPromise]);
  }

  async flushAll(): Promise<void> {
    await Promise.all(Array.from(this.batches.keys(), (key) => this.flush(key)));
  }

  private async flush(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) {
      return;
    }

    this.batches.delete(key);
    clearTimeout(batch.idleTimer);
    clearTimeout(batch.maxWaitTimer);
    await processMessageBatch({
      messages: batch.messages,
      apiClient: this.apiClient,
      logger: this.logger,
    });
  }
}
