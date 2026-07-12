import type { Message } from "discord.js";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";
import { isApiClientError } from "../runtime/errors";
import { touchUserFromMessage } from "../runtime/user-touch";

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

export async function handleMessageCreateEvent(input: {
  message: Message;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { message, apiClient, logger } = input;

  if (message.author.bot || message.webhookId) {
    return;
  }

  const content = message.content.trim();
  if (!content) {
    return;
  }

  await touchUserFromMessage(apiClient, message, logger);

  const isDm = !message.guildId;
  const botUserId = message.client.user?.id;
  const botWasMentioned = botUserId ? message.mentions.has(botUserId) : false;

  try {
    const response = await apiClient.respondWithLlm({
      guildId: message.guildId ?? undefined,
      channelId: message.channelId,
      discordUserId: message.author.id,
      content,
      messageId: message.id,
      isDm,
      botWasMentioned,
    });

    if (!response.shouldRespond || !response.replyText) {
      return;
    }

    const chunks = splitForDiscord(response.replyText);
    for (const [index, chunk] of chunks.entries()) {
      if (index === 0) {
        await message.reply({ content: chunk });
      } else if ("send" in message.channel && typeof message.channel.send === "function") {
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
      },
      "Failed to process message for LLM response",
    );
  }
}
