export interface InternalBootstrapRequest {
  guildName: string;
  owner?: {
    discordUserId: string;
    username: string;
    globalName?: string | null;
    avatarUrl?: string | null;
  };
}

export interface InternalUserTouchRequest {
  discordUserId: string;
  username: string;
  globalName?: string | null;
  avatarUrl?: string | null;
}

export interface CommandCheckResponse {
  allowed: boolean;
  reason?: "NO_USER" | "NO_MEMBERSHIP" | "ROLE_TOO_LOW" | "CHANNEL_DENIED" | "CHANNEL_NOT_ALLOWED";
  actor?: {
    userId: string;
    tenantRole: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
  };
  policy: {
    commandKey: string;
    minRole: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
    allowChannels: string[];
    denyChannels: string[];
  };
}

export interface InternalGuildSettingsResponse {
  guild: {
    id: string;
    discordGuildId: string;
    name: string;
  };
  features: Array<{
    id: string;
    guildId: string;
    featureKey: string;
    enabled: boolean;
    version: number;
    configJson: Record<string, unknown>;
    updatedAt: string;
  }>;
  commands: Array<{
    id: string;
    guildId: string;
    commandKey: string;
    minRole: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
    allowChannels: string[];
    denyChannels: string[];
    updatedAt: string;
  }>;
}

export interface InternalLlmRespondRequest {
  guildId?: string;
  channelId?: string;
  discordUserId: string;
  content: string;
  messageId?: string;
  isDm: boolean;
  botWasMentioned: boolean;
}

export interface InternalLlmRespondResponse {
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

export interface LlmGuildSettingsEnvelope {
  guild: {
    id: string;
    discordGuildId: string;
    name: string;
  };
  settings: {
    id: string;
    guildId: string;
    enabled: boolean;
    defaultModel: string;
    stylePrompt?: string | null;
    retentionDays: number;
    dmEnabled: boolean;
    maxInputChars: number;
    maxOutputTokens: number;
    createdAt: string;
    updatedAt: string;
  };
}

export interface InternalLlmSettingsResponse {
  guild: {
    id: string;
    discordGuildId: string;
    name: string;
  };
  settings: LlmGuildSettingsEnvelope["settings"];
}
