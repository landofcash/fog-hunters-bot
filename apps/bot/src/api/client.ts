import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { BotConfig } from "../config";
import { ApiClientError } from "../runtime/errors";
import type {
  AssignmentListResponse,
  BotClaimResponse,
  BotInstallationSummary,
  BootstrapInstallationResponse,
  BotLeaseCredentials,
  BotRuntimeState,
  BotRuntimeStatus,
  CommandCheckResponse,
  DiscordEventReceiptResponse,
  InternalAdminListResponse,
  InternalAdminMutationResponse,
  InternalBootstrapRequest,
  InternalGuildSettingsResponse,
  InternalLlmRespondRequest,
  InternalLlmRespondResponse,
  InternalLlmSettingsResponse,
  InternalUserTouchRequest,
  ReasoningEffort,
} from "./contracts";

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

interface EffectiveSettingsWireResponse {
  installation: {
    guildId: string;
    guildName: string;
    presenceStatus: "PRESENT" | "LEFT";
    operationalStatus: "ENABLED" | "DISABLED";
  };
  settings: {
    llmEnabledByGuild: boolean;
    llmEnabledByPlatform: boolean;
  };
  effective: {
    model: string;
    reasoningEffort: ReasoningEffort;
    assistantPrompt?: string | null;
    gatekeeperPrompt?: string | null;
    retentionDays: number;
    maxInputChars: number;
    maxOutputTokens: number;
    dmEnabled: boolean;
  };
  effectiveAiEnabled: boolean;
  effectivePrompts: {
    assistant: string;
    gatekeeper: string;
  };
}

async function requestJson<T>(input: {
  config: BotConfig;
  logger: Logger;
  path: string;
  init: RequestInit;
  authHeaders: Record<string, string>;
  retriesLeft?: number;
}): Promise<T> {
  const retriesLeft = input.retriesLeft ?? input.config.httpRetryMax;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.httpTimeoutMs);
  try {
    const response = await fetch(`${input.config.apiBaseUrl}${input.path}`, {
      ...input.init,
      headers: {
        "content-type": "application/json",
        ...input.authHeaders,
        ...(input.init.headers ?? {}),
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
    const retriable = error instanceof ApiClientError ? error.statusCode >= 500 : true;
    if (retriesLeft > 0 && retriable) {
      input.logger.warn(
        { err: error, path: input.path, retriesLeft },
        "API request failed, retrying",
      );
      return requestJson<T>({ ...input, retriesLeft: retriesLeft - 1 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export class PoolApiClient {
  constructor(
    private readonly config: BotConfig,
    private readonly logger: Logger,
  ) {}

  private request<T>(path: string, init: RequestInit): Promise<T> {
    return requestJson<T>({
      config: this.config,
      logger: this.logger,
      path,
      init,
      authHeaders: { authorization: `Bearer ${this.config.poolBootstrapKey}` },
    });
  }

  listAssignments(): Promise<AssignmentListResponse> {
    return this.request("/internal/runtime/assignments", { method: "GET" });
  }

  claimBot(botInstanceId: string, claimRequestId: string): Promise<BotClaimResponse> {
    return this.request(`/internal/runtime/assignments/${botInstanceId}/claim`, {
      method: "POST",
      body: JSON.stringify({
        runtimeInstanceId: this.config.runtimeInstanceId,
        claimRequestId,
      }),
    });
  }
}

export class ApiClient {
  constructor(
    private readonly config: BotConfig,
    private readonly logger: Logger,
    private readonly lease: BotLeaseCredentials,
  ) {}

  get botInstanceId(): string {
    return this.lease.botInstanceId;
  }

  private request<T>(path: string, init: RequestInit): Promise<T> {
    return requestJson<T>({
      config: this.config,
      logger: this.logger,
      path,
      init,
      authHeaders: {
        authorization: `Bearer ${this.lease.leaseToken}`,
        "x-bot-instance-id": this.lease.botInstanceId,
        "x-bot-lease-generation": String(this.lease.leaseGeneration),
      },
    });
  }

  heartbeat(input: {
    runtimeState?: Exclude<BotRuntimeState, "STOPPED">;
    connectedAt?: Date;
    errorCode?: string | null;
  }): Promise<{ lease: BotRuntimeStatus }> {
    return this.request(
      `/internal/runtime/assignments/${this.lease.botInstanceId}/heartbeat`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  release(): Promise<{ lease: BotRuntimeStatus }> {
    return this.request(
      `/internal/runtime/assignments/${this.lease.botInstanceId}/release`,
      { method: "POST", body: "{}" },
    );
  }

  bootstrapGuild(
    guildId: string,
    payload: InternalBootstrapRequest,
  ): Promise<BootstrapInstallationResponse> {
    return this.request(`/internal/guilds/${guildId}/bootstrap`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async markGuildLeft(guildId: string): Promise<void> {
    await this.request(`/internal/guilds/${guildId}/left`, {
      method: "POST",
      body: "{}",
    });
  }

  reconcileGuilds(guildIds: string[]): Promise<{ leftCount: number }> {
    return this.request("/internal/installations/reconcile", {
      method: "POST",
      body: JSON.stringify({ guildIds }),
    });
  }

  async reportIdentity(payload: {
    discordApplicationId: string;
    discordBotUserId: string;
    discordUsername: string;
    discordAvatarUrl?: string | null;
  }): Promise<void> {
    await this.request("/internal/identity", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async reportCommandManifest(input: {
    guildId: string;
    hash?: string | null;
    errorCode?: string | null;
    syncedAt?: Date | null;
  }): Promise<void> {
    await this.request(`/internal/guilds/${input.guildId}/command-manifest`, {
      method: "PUT",
      body: JSON.stringify({
        hash: input.hash,
        errorCode: input.errorCode,
        syncedAt: input.syncedAt,
      }),
    });
  }

  pendingCommandManifests(): Promise<{ items: BotInstallationSummary[] }> {
    return this.request("/internal/command-manifests/pending", {
      method: "GET",
    });
  }

  acquireEvent(
    discordEventId: string,
    eventType: "MESSAGE_CREATE" | "INTERACTION_CREATE",
  ): Promise<DiscordEventReceiptResponse> {
    const acquisitionRequestId = randomUUID();
    return this.request("/internal/events/receipts", {
      method: "POST",
      body: JSON.stringify({ discordEventId, eventType, acquisitionRequestId }),
    });
  }

  async completeEvent(
    receiptId: string,
    acquisitionRequestId: string,
  ): Promise<void> {
    await this.request(`/internal/events/receipts/${receiptId}/complete`, {
      method: "POST",
      body: JSON.stringify({ acquisitionRequestId }),
    });
  }

  async failEvent(
    receiptId: string,
    acquisitionRequestId: string,
    errorCode: string,
  ): Promise<void> {
    await this.request(`/internal/events/receipts/${receiptId}/fail`, {
      method: "POST",
      body: JSON.stringify({ acquisitionRequestId, errorCode }),
    });
  }

  async touchUser(payload: InternalUserTouchRequest): Promise<void> {
    await this.request("/internal/interactions/user-touch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  checkCommandAccess(input: {
    guildId: string;
    commandKey: string;
    actorDiscordUserId: string;
    channelId?: string;
    defaultMinRole?: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
  }): Promise<CommandCheckResponse> {
    return this.request(
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

  readGuildSettings(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId?: string;
    commandKey?: string;
  }): Promise<InternalGuildSettingsResponse> {
    return this.request(`/internal/guilds/${input.guildId}/settings/read`, {
      method: "POST",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
        commandKey: input.commandKey ?? "settings.view",
      }),
    });
  }

  listGuildAdmins(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId?: string;
  }): Promise<InternalAdminListResponse> {
    return this.request(`/internal/guilds/${input.guildId}/admins/list`, {
      method: "POST",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
      }),
    });
  }

  addGuildAdmin(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId?: string;
    target: InternalUserTouchRequest;
  }): Promise<InternalAdminMutationResponse> {
    return this.request(`/internal/guilds/${input.guildId}/admins/add`, {
      method: "POST",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
        target: input.target,
      }),
    });
  }

  removeGuildAdmin(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId?: string;
    target: InternalUserTouchRequest;
  }): Promise<InternalAdminMutationResponse> {
    return this.request(`/internal/guilds/${input.guildId}/admins/remove`, {
      method: "POST",
      body: JSON.stringify({
        actorDiscordUserId: input.actorDiscordUserId,
        channelId: input.channelId,
        target: input.target,
      }),
    });
  }

  respondWithLlm(payload: InternalLlmRespondRequest): Promise<InternalLlmRespondResponse> {
    return this.request("/internal/llm/respond", {
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
    const response = await this.request<EffectiveSettingsWireResponse>(
      `/internal/guilds/${input.guildId}/llm/settings/read`,
      {
        method: "POST",
        body: JSON.stringify({
          actorDiscordUserId: input.actorDiscordUserId,
          channelId: input.channelId,
          commandKey: input.commandKey ?? "ai.status",
        }),
      },
    );
    return normalizeLlmSettings(response);
  }

  async patchLlmGuildSettings(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId?: string;
    commandKey?: string;
    patch: {
      enabled?: boolean;
      assistantPrompt?: string | null;
      gatekeeperPrompt?: string | null;
      retentionDays?: number;
      maxInputChars?: number;
      maxOutputTokens?: number;
    };
  }): Promise<InternalLlmSettingsResponse> {
    const response = await this.request<EffectiveSettingsWireResponse>(
      `/internal/guilds/${input.guildId}/llm/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({
          actorDiscordUserId: input.actorDiscordUserId,
          channelId: input.channelId,
          commandKey: input.commandKey ?? "ai.prompt.set",
          llmEnabledByGuild: input.patch.enabled,
          assistantPromptOverride: input.patch.assistantPrompt,
          gatekeeperPromptOverride: input.patch.gatekeeperPrompt,
          retentionDaysOverride: input.patch.retentionDays,
          maxInputCharsOverride: input.patch.maxInputChars,
          maxOutputTokensOverride: input.patch.maxOutputTokens,
        }),
      },
    );
    return normalizeLlmSettings(response);
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

  clearLlmChannelMemory(input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId: string;
    commandKey?: string;
  }): Promise<{ deletedMessages: number; deletedConversations: number }> {
    return this.request(
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

function normalizeLlmSettings(
  response: EffectiveSettingsWireResponse,
): InternalLlmSettingsResponse {
  const {
    settings,
    effective,
    installation,
    effectiveAiEnabled,
    effectivePrompts,
  } = response;
  return {
    guild: {
      id: installation.guildId,
      name: installation.guildName,
    },
    settings: {
      enabled: settings.llmEnabledByGuild,
      platformEnabled: settings.llmEnabledByPlatform,
      defaultModel: effective.model,
      reasoningEffort: effective.reasoningEffort,
      assistantPrompt: effective.assistantPrompt,
      gatekeeperPrompt: effective.gatekeeperPrompt,
      retentionDays: effective.retentionDays,
      dmEnabled: effective.dmEnabled,
      maxInputChars: effective.maxInputChars,
      maxOutputTokens: effective.maxOutputTokens,
    },
    effectiveAiEnabled,
    effectivePrompts,
  };
}
