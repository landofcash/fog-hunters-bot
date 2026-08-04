export type BotRuntimeState =
  | "STOPPED"
  | "CLAIMED"
  | "CONNECTING"
  | "READY"
  | "BACKOFF"
  | "ERROR"
  | "QUARANTINED";

export interface BotSummary {
  id: string;
  slug: string;
  displayName: string;
  discordApplicationId: string;
  discordBotUserId?: string | null;
  discordUsername?: string | null;
  discordAvatarUrl?: string | null;
  desiredStatus: "DRAFT" | "ACTIVE" | "DISABLED";
  tokenVersion: number;
  tokenConfigured: boolean;
}

export interface BotProfileResponse {
  id: string;
  botInstanceId: string;
  defaultModel: string;
  assistantPrompt?: string | null;
  gatekeeperPrompt?: string | null;
  dmEnabled: boolean;
  retentionDays: number;
  maxInputChars: number;
  maxOutputTokens: number;
}

export interface BotInstallationSummary {
  id: string;
  botInstanceId: string;
  guildId: string;
  guildDiscordId: string;
  guildName: string;
  presenceStatus: "PRESENT" | "LEFT";
  operationalStatus: "ENABLED" | "DISABLED";
  lastCommandManifestHash?: string | null;
  lastCommandSyncAt?: string | null;
  lastCommandSyncErrorCode?: string | null;
}

export interface BootstrapInstallationResponse {
  installation: BotInstallationSummary;
  installationCreated: boolean;
}

export interface BotRuntimeStatus {
  botInstanceId: string;
  runtimeInstanceId?: string | null;
  claimRequestId?: string | null;
  leaseGeneration: number;
  runtimeState: BotRuntimeState;
  expiresAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastConnectedAt?: string | null;
  lastErrorCode?: string | null;
  claimedTokenVersion?: number | null;
  revokedAt?: string | null;
}

export interface BotRuntimeAssignment {
  botInstanceId: string;
  slug: string;
  displayName: string;
  discordApplicationId: string;
  tokenVersion: number;
  runtime: BotRuntimeStatus;
}

export interface AssignmentListResponse {
  items: BotRuntimeAssignment[];
  pollAfterMs: number;
}

export interface BotClaimResponse {
  bot: BotSummary;
  profile: BotProfileResponse;
  lease: BotRuntimeStatus;
  leaseToken: string;
  discordToken: string;
  heartbeatAfterMs: number;
}

export interface BotLeaseCredentials {
  botInstanceId: string;
  leaseGeneration: number;
  leaseToken: string;
}

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

export interface InternalAdminMember {
  userId: string;
  discordUserId: string;
  username?: string | null;
  tenantRole: "OWNER" | "ADMIN";
  status: "ACTIVE" | "INVITED" | "REMOVED";
}

export interface InternalAdminListResponse {
  owners: InternalAdminMember[];
  admins: InternalAdminMember[];
}

export interface InternalAdminMutationResponse {
  changed: boolean;
  reason?: "OWNER_ALREADY_PRIVILEGED" | "ALREADY_ADMIN" | "NOT_ADMIN";
  membership: {
    guildId: string;
    userId: string;
    tenantRole: "OWNER" | "ADMIN" | "MODERATOR" | "USER";
    status: "ACTIVE" | "INVITED" | "REMOVED";
  } | null;
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
    guildId: string;
    botInstanceId: string;
    presenceStatus: "PRESENT" | "LEFT";
    operationalStatus: "ENABLED" | "DISABLED";
  };
  bot: BotSummary;
  settings: {
    llmEnabledByGuild: boolean;
    llmEnabledByPlatform: boolean;
  };
}

export interface InternalLlmRespondRequest {
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

export interface InternalLlmSettingsResponse {
  guild: {
    id: string;
    name: string;
  };
  settings: {
    enabled: boolean;
    platformEnabled: boolean;
    defaultModel: string;
    assistantPrompt?: string | null;
    gatekeeperPrompt?: string | null;
    retentionDays: number;
    dmEnabled: boolean;
    maxInputChars: number;
    maxOutputTokens: number;
  };
  effectiveAiEnabled: boolean;
  effectivePrompts: {
    assistant: string;
    gatekeeper: string;
  };
}

export interface DiscordEventReceiptResponse {
  receipt: {
    id: string;
    acquisitionRequestId: string;
    processingStatus: "RECEIVED" | "PROCESSING" | "COMPLETED" | "FAILED";
    attemptCount: number;
  };
  acquired: boolean;
}
