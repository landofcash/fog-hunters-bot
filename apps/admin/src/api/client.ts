import type {
  AuditLog,
  CommandPermission,
  CursorPage,
  GuildMember,
  GuildSettingsResponse,
  JobRun,
  LlmSettingsResponse,
  MeResponse,
  PlatformGuild,
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

export const api = {
  me: () => request<MeResponse>("/api/v1/me"),
  loginUrl: () => request<{ url: string }>("/api/v1/auth/discord/login?state=dashboard"),
  logout: () => request<{ loggedOut: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  health: () => request<{ status: "ok"; timestamp: string }>("/api/v1/health"),
  guildSettings: (guildId: string) =>
    request<GuildSettingsResponse>(`/api/v1/guilds/${guildId}/settings`),
  llmSettings: (guildId: string) =>
    request<LlmSettingsResponse>(`/api/v1/guilds/${guildId}/llm/settings`),
  updateLlmSettings: (
    guildId: string,
    body: Partial<LlmSettingsResponse["settings"]>,
  ) =>
    request<LlmSettingsResponse>(`/api/v1/guilds/${guildId}/llm/settings`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  configureChannel: (
    guildId: string,
    channelId: string,
    respondOnMentionOnly: boolean,
  ) =>
    request(`/api/v1/guilds/${guildId}/llm/channels/${channelId}`, {
      method: "POST",
      body: JSON.stringify({ respondOnMentionOnly }),
    }),
  disableChannel: (guildId: string, channelId: string) =>
    request(`/api/v1/guilds/${guildId}/llm/channels/${channelId}`, {
      method: "DELETE",
    }),
  clearChannelMemory: (guildId: string, channelId: string) =>
    request(`/api/v1/guilds/${guildId}/llm/memory/channels/${channelId}/clear`, {
      method: "POST",
    }),
  members: (guildId: string) =>
    request<CursorPage<GuildMember>>(`/api/v1/guilds/${guildId}/members?limit=100`),
  updateMemberRole: (guildId: string, userId: string, tenantRole: TenantRole) =>
    request(`/api/v1/guilds/${guildId}/roles/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ tenantRole }),
    }),
  updateCommand: (
    guildId: string,
    commandKey: string,
    body: Pick<CommandPermission, "minRole" | "allowChannels" | "denyChannels">,
  ) =>
    request(`/api/v1/guilds/${guildId}/commands/${commandKey}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  audit: (guildId: string) =>
    request<CursorPage<AuditLog>>(`/api/v1/guilds/${guildId}/audit-logs?limit=100`),
  jobs: (guildId: string) =>
    request<CursorPage<JobRun>>(`/api/v1/guilds/${guildId}/jobs?limit=100`),
  platformGuilds: (search = "") =>
    request<CursorPage<PlatformGuild>>(
      `/api/v1/platform/guilds?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  supportedModels: () =>
    request<{ items: SupportedModel[] }>("/api/v1/platform/llm/models"),
  updatePlatformPolicy: (
    guildId: string,
    body: { platformEnabled?: boolean; defaultModel?: string },
  ) =>
    request<LlmSettingsResponse>(`/api/v1/platform/guilds/${guildId}/llm-policy`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
