import type { ChatInputCommandInteraction, Interaction, Message } from "discord.js";
import type { Logger } from "pino";
import { vi } from "vitest";
import type { ApiClient } from "../../src/api/client";
import type { BotConfig } from "../../src/config";

export function createBotConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    nodeEnv: "test",
    logLevel: "info",
    discordBotToken: "bot-token",
    discordClientId: "client-id",
    discordGuildIds: [],
    apiBaseUrl: "https://api.test/api/v1",
    apiInternalKey: "internal-key-long-enough",
    httpTimeoutMs: 100,
    httpRetryMax: 2,
    commandSyncOnStart: false,
    ...overrides,
  };
}

export function createLoggerMock(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

export function createApiClientMock(overrides: Record<string, unknown> = {}): ApiClient {
  return {
    touchUser: vi.fn().mockResolvedValue(undefined),
    respondWithLlm: vi.fn().mockResolvedValue({ shouldRespond: false }),
    readGuildSettings: vi.fn(),
    readLlmGuildSettings: vi.fn(),
    patchLlmGuildSettings: vi.fn(),
    enableLlmChannel: vi.fn(),
    disableLlmChannel: vi.fn(),
    clearLlmChannelMemory: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

export function createMessageMock(overrides: Record<string, unknown> = {}): Message {
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    author: {
      id: "user-1",
      username: "user",
      globalName: "User",
      bot: false,
      displayAvatarURL: vi.fn().mockReturnValue("https://avatar.test/user.png"),
    },
    webhookId: null,
    content: "Hello bot",
    guildId: "guild-1",
    channelId: "channel-1",
    id: "message-1",
    client: { user: { id: "bot-1" } },
    mentions: { has: vi.fn().mockReturnValue(false) },
    reply: vi.fn().mockResolvedValue(undefined),
    channel: { send },
    ...overrides,
  } as unknown as Message;
}

export function createInteractionMock(overrides: Record<string, unknown> = {}): ChatInputCommandInteraction {
  return {
    isChatInputCommand: vi.fn().mockReturnValue(true),
    commandName: "ai",
    guildId: "guild-1",
    channelId: "channel-1",
    user: {
      id: "user-1",
      username: "user",
      globalName: "User",
      displayAvatarURL: vi.fn().mockReturnValue("https://avatar.test/user.png"),
    },
    options: {
      getSubcommand: vi.fn().mockReturnValue("status"),
      getChannel: vi.fn().mockReturnValue({ id: "channel-1" }),
      getBoolean: vi.fn().mockReturnValue(null),
      getString: vi.fn().mockReturnValue(null),
      getInteger: vi.fn().mockReturnValue(30),
    },
    deferred: false,
    replied: false,
    deferReply: vi.fn().mockImplementation(async function (this: { deferred: boolean }) { this.deferred = true; }),
    reply: vi.fn().mockImplementation(async function (this: { replied: boolean }) { this.replied = true; }),
    editReply: vi.fn().mockResolvedValue(undefined),
    createdTimestamp: Date.now() - 5,
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
}

export function asInteraction(interaction: ChatInputCommandInteraction): Interaction {
  return interaction as unknown as Interaction;
}
