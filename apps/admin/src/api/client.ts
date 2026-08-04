import type {
  AuditLog,
  BotInstallation,
  BotInstallationSettingsResponse,
  BotProfile,
  BotRuntimeStatus,
  BotSummary,
  CommandPermission,
  CursorPage,
  GuildBotListItem,
  GuildMember,
  GuildSettingsResponse,
  InstallationLlmSettings,
  JobRun,
  LlmSettingsResponse,
  MeResponse,
  PlatformBotDetail,
  SupportedModel,
  TenantRole,
} from "./types";

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function getCookie(name: string): string | undefined {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const csrfToken = getCookie("fhaibot_csrf");
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" && method !== "HEAD" && csrfToken
        ? { "x-csrf-token": decodeURIComponent(csrfToken) }
        : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiClientError(
      payload.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      payload.error?.code,
      payload.error?.requestId,
    );
  }

  return response.json() as Promise<T>;
}

function asGuildSettings(
  guildId: string,
  response: BotInstallationSettingsResponse,
): GuildSettingsResponse {
  return {
    guild: {
      id: response.installation.guildId,
      discordGuildId: guildId,
      name: response.installation.guildName,
    },
    installation: response.installation,
    features: response.features,
    commands: response.commands,
  };
}

export function asLlmSettings(
  guildId: string,
  response: BotInstallationSettingsResponse,
): LlmSettingsResponse {
  const {
    installation,
    settings,
    profile,
    effective,
    effectiveAiEnabled,
    effectivePrompts,
  } = response;
  return {
    guild: {
      id: installation.guildId,
      discordGuildId: guildId,
      name: installation.guildName,
    },
    installation,
    settings: {
      id: settings.id,
      guildId: installation.guildId,
      enabled: settings.llmEnabledByGuild,
      platformEnabled: settings.llmEnabledByPlatform,
      defaultModel: effective.model,
      assistantPrompt: settings.assistantPromptOverride,
      gatekeeperPrompt: settings.gatekeeperPromptOverride,
      retentionDays: settings.retentionDaysOverride ?? null,
      dmEnabled: profile.dmEnabled,
      maxInputChars: settings.maxInputCharsOverride ?? null,
      maxOutputTokens: settings.maxOutputTokensOverride ?? null,
      createdAt: "",
      updatedAt: "",
    },
    effective,
    effectiveAiEnabled,
    channels: response.channels,
    effectivePrompts,
  };
}

export function asLlmSettingsUpdatePayload(
  body: Partial<LlmSettingsResponse["settings"]>,
) {
  return {
    llmEnabledByGuild: body.enabled,
    assistantPromptOverride: body.assistantPrompt,
    gatekeeperPromptOverride: body.gatekeeperPrompt,
    retentionDaysOverride: body.retentionDays,
    maxInputCharsOverride: body.maxInputChars,
    maxOutputTokensOverride: body.maxOutputTokens,
  };
}

const botSettings = (guildId: string, botId: string) =>
  request<BotInstallationSettingsResponse>(
    `/api/v1/guilds/${guildId}/bots/${botId}/settings`,
  );

export const api = {
  me: () => request<MeResponse>("/api/v1/me"),
  loginUrl: () => request<{ url: string }>("/api/v1/auth/discord/login?state=dashboard"),
  logout: () => request<{ loggedOut: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  health: () => request<{ status: "ok"; timestamp: string }>("/api/v1/health"),

  guildBots: (guildId: string) =>
    request<{ items: GuildBotListItem[] }>(`/api/v1/guilds/${guildId}/bots`),
  botSettings,
  guildSettings: async (guildId: string, botId: string) =>
    asGuildSettings(guildId, await botSettings(guildId, botId)),
  llmSettings: async (guildId: string, botId: string) =>
    asLlmSettings(guildId, await botSettings(guildId, botId)),
  updateInstallation: (
    guildId: string,
    botId: string,
    operationalStatus: "ENABLED" | "DISABLED",
  ) =>
    request<{ installation: BotInstallation }>(
      `/api/v1/guilds/${guildId}/bots/${botId}/installation`,
      {
        method: "PATCH",
        body: JSON.stringify({ operationalStatus }),
      },
    ),
  updateLlmSettings: async (
    guildId: string,
    botId: string,
    body: Partial<LlmSettingsResponse["settings"]>,
  ) => {
    await request(`/api/v1/guilds/${guildId}/bots/${botId}/llm/settings`, {
      method: "PATCH",
      body: JSON.stringify(asLlmSettingsUpdatePayload(body)),
    });
    return asLlmSettings(guildId, await botSettings(guildId, botId));
  },
  configureChannel: (
    guildId: string,
    botId: string,
    channelId: string,
    respondOnMentionOnly: boolean,
  ) =>
    request(`/api/v1/guilds/${guildId}/bots/${botId}/llm/channels/${channelId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: true, respondOnMentionOnly }),
    }),
  disableChannel: (guildId: string, botId: string, channelId: string) =>
    request(`/api/v1/guilds/${guildId}/bots/${botId}/llm/channels/${channelId}`, {
      method: "DELETE",
    }),
  clearChannelMemory: (guildId: string, botId: string, channelId: string) =>
    request(
      `/api/v1/guilds/${guildId}/bots/${botId}/llm/channels/${channelId}/memory/clear`,
      { method: "POST" },
    ),
  members: (guildId: string) =>
    request<CursorPage<GuildMember>>(`/api/v1/guilds/${guildId}/members?limit=100`),
  updateMemberRole: (guildId: string, userId: string, role: TenantRole) =>
    request(`/api/v1/guilds/${guildId}/roles/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    }),
  updateCommand: (
    guildId: string,
    botId: string,
    commandKey: string,
    body: Pick<CommandPermission, "minRole" | "allowChannels" | "denyChannels">,
  ) =>
    request(`/api/v1/guilds/${guildId}/bots/${botId}/commands/${commandKey}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  audit: (guildId: string, botId: string) =>
    request<CursorPage<AuditLog>>(
      `/api/v1/guilds/${guildId}/audit-logs?limit=100&botInstanceId=${encodeURIComponent(botId)}`,
    ),
  jobs: (guildId: string, botId: string) =>
    request<CursorPage<JobRun>>(
      `/api/v1/guilds/${guildId}/jobs?limit=100&botInstanceId=${encodeURIComponent(botId)}`,
    ),

  platformBots: (search = "") =>
    request<CursorPage<BotSummary>>(
      `/api/v1/platform/bots?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  createBot: (body: {
    slug: string;
    displayName: string;
    discordApplicationId: string;
  }) =>
    request<{ bot: BotSummary; profile: BotProfile }>("/api/v1/platform/bots", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  platformBot: (botId: string) =>
    request<PlatformBotDetail>(`/api/v1/platform/bots/${botId}`),
  updateBot: (
    botId: string,
    body: { displayName?: string; desiredStatus?: "DRAFT" | "ACTIVE" | "DISABLED" },
  ) =>
    request<{ bot: BotSummary }>(`/api/v1/platform/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  updateBotProfile: (botId: string, body: Omit<BotProfile, "id" | "botInstanceId" | "settingsVersion">) =>
    request<{ profile: BotProfile }>(`/api/v1/platform/bots/${botId}/profile`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  configureBotToken: (botId: string, token: string) =>
    request<{ configured: true; tokenVersion: number; rotatedAt: string }>(
      `/api/v1/platform/bots/${botId}/token`,
      { method: "PUT", body: JSON.stringify({ token }) },
    ),
  deleteBotToken: (botId: string) =>
    request<{ configured: false; tokenVersion: number }>(
      `/api/v1/platform/bots/${botId}/token`,
      { method: "DELETE" },
    ),
  botInstallations: (botId: string) =>
    request<{ items: BotInstallation[] }>(`/api/v1/platform/bots/${botId}/installations`),
  botInstallation: (botId: string, installationId: string) =>
    request<{
      installation: BotInstallation;
      settings: InstallationLlmSettings;
      profile: BotProfile;
    }>(`/api/v1/platform/bots/${botId}/installations/${installationId}`),
  botRuntime: (botId: string) =>
    request<{ runtime: BotRuntimeStatus }>(`/api/v1/platform/bots/${botId}/runtime`),
  botInstallUrl: (botId: string) =>
    request<{ url: string }>(`/api/v1/platform/bots/${botId}/install-url`),
  requestCommandResync: (botId: string, installationId: string) =>
    request<{ installation: BotInstallation }>(
      `/api/v1/platform/bots/${botId}/installations/${installationId}/commands/resync`,
      { method: "POST", body: "{}" },
    ),
  supportedModels: () =>
    request<{ items: SupportedModel[] }>("/api/v1/platform/llm/models"),
  updatePlatformPolicy: (
    botId: string,
    installationId: string,
    body: { llmEnabledByPlatform?: boolean; modelOverride?: string | null },
  ) =>
    request(`/api/v1/platform/bots/${botId}/installations/${installationId}/policy`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
