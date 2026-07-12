import type { Logger } from "pino";
import type { BotConfig } from "../config";
import { ApiClientError } from "../runtime/errors";
import type {
  CommandCheckResponse,
  InternalBootstrapRequest,
  InternalGuildSettingsResponse,
  InternalLlmSettingsResponse,
  InternalLlmRespondRequest,
  InternalLlmRespondResponse,
  InternalUserTouchRequest,
} from "./contracts";

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class ApiClient {
  constructor(
    private readonly config: BotConfig,
    private readonly logger: Logger,
  ) {}

  private async request<T>(path: string, init: RequestInit, retriesLeft = this.config.httpRetryMax): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);
    try {
      const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-internal-key": this.config.apiInternalKey,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        throw new ApiClientError(
          response.status,
          body.error?.message ?? `Request failed with status ${response.status}`,
          body.error?.code,
          body.error?.details,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      const retriable =
        error instanceof ApiClientError ? error.statusCode >= 500 : true;

      if (retriesLeft > 0 && retriable) {
        this.logger.warn({ err: error, path, retriesLeft }, "API request failed, retrying");
        return this.request<T>(path, init, retriesLeft - 1);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async bootstrapGuild(guildId: string, payload: InternalBootstrapRequest): Promise<void> {
    await this.request(`/internal/guilds/${guildId}/bootstrap`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async touchUser(payload: InternalUserTouchRequest): Promise<void> {
    await this.request("/internal/interactions/user-touch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async checkCommandAccess(input: {
    guildId: string;
    commandKey: string;
    actorDiscordUserId: string;
    channelId?: string;
    defaultMinRole?: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
  }): Promise<CommandCheckResponse> {
    return this.request<CommandCheckResponse>(
      `/internal/guilds/${input.guildId}/commands/${input.commandKey}/check`,
      {
        method: "POST",
        body: JSON.stringify({
          actorDiscordUserId: input.actorDiscordUserId,
          channelId: input.channelId,
          defaultMinRole: input.defaultMinRole ?? "ADMIN",
        }),
      },
    );
  }

  async readGuildSettings(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId?: string;
    commandKey?: string;
  }): Promise<InternalGuildSettingsResponse> {
    return this.request<InternalGuildSettingsResponse>(`/internal/guilds/${input.guildId}/settings/read`, {
      method: "POST",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
        commandKey: input.commandKey ?? "settings.view",
      }),
    });
  }

  async respondWithLlm(payload: InternalLlmRespondRequest): Promise<InternalLlmRespondResponse> {
    return this.request<InternalLlmRespondResponse>("/internal/llm/respond", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async readLlmGuildSettings(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId?: string;
    commandKey?: string;
  }): Promise<InternalLlmSettingsResponse> {
    return this.request<InternalLlmSettingsResponse>(`/internal/guilds/${input.guildId}/llm/settings/read`, {
      method: "POST",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
        commandKey: input.commandKey ?? "ai.status",
      }),
    });
  }

  async patchLlmGuildSettings(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId?: string;
    commandKey?: string;
    patch: {
      enabled?: boolean;
      defaultModel?: string;
      stylePrompt?: string | null;
      retentionDays?: number;
      dmEnabled?: boolean;
      maxInputChars?: number;
      maxOutputTokens?: number;
    };
  }): Promise<InternalLlmSettingsResponse> {
    return this.request<InternalLlmSettingsResponse>(`/internal/guilds/${input.guildId}/llm/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
        commandKey: input.commandKey ?? "ai.style",
        ...input.patch,
      }),
    });
  }

  async enableLlmChannel(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId: string;
    commandKey?: string;
    respondOnMentionOnly?: boolean;
  }): Promise<void> {
    await this.request(`/internal/guilds/${input.guildId}/llm/channels/enable`, {
      method: "POST",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
        commandKey: input.commandKey ?? "ai.enable",
        respondOnMentionOnly: input.respondOnMentionOnly,
      }),
    });
  }

  async disableLlmChannel(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId: string;
    commandKey?: string;
  }): Promise<void> {
    await this.request(`/internal/guilds/${input.guildId}/llm/channels/disable`, {
      method: "POST",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
        commandKey: input.commandKey ?? "ai.disable",
      }),
    });
  }

  async clearLlmChannelMemory(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId: string;
    commandKey?: string;
  }): Promise<{ deletedMessages: number; deletedConversations: number }> {
    return this.request<{ deletedMessages: number; deletedConversations: number }>(
      `/internal/guilds/${input.guildId}/llm/channels/memory/clear`,
      {
        method: "POST",
        body: JSON.stringify({
          actorDiscordUserId: input.actorDiscordUserId,
          channelId: input.channelId,
          commandKey: input.commandKey ?? "ai.memory.clear",
        }),
      },
    );
  }
}
