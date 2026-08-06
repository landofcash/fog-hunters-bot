export type TenantRole = "OWNER" | "ADMIN" | "MODERATOR" | "USER";
export type PlatformRole = "PLATFORM_ADMIN" | "NONE";
export type JobStatus = "QUEUED" | "RUNNING" | "FAILED" | "COMPLETED" | "CANCELLED";

export interface Membership {
  guildId: string;
  guildName: string;
  tenantRole: TenantRole;
}

export interface MeResponse {
  user: {
    id: string;
    discordUserId: string;
    username?: string | null;
  };
  memberships: Membership[];
  platformRole: PlatformRole;
}

export interface GuildRecord {
  id: string;
  discordGuildId: string;
  name: string;
}

export type BotDesiredStatus = "DRAFT" | "ACTIVE" | "DISABLED";
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
  desiredStatus: BotDesiredStatus;
  tokenVersion: number;
  tokenConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotProfile {
  id: string;
  botInstanceId: string;
  defaultModel: string;
  assistantPrompt?: string | null;
  gatekeeperPrompt?: string | null;
  dmEnabled: boolean;
  retentionDays: number;
  maxInputChars: number;
  maxOutputTokens: number;
  settingsVersion: number;
}

export interface BotInstallation {
  id: string;
  botInstanceId: string;
  guildId: string;
  guildDiscordId: string;
  guildName: string;
  guildStatus: "ACTIVE" | "DISABLED";
  presenceStatus: "PRESENT" | "LEFT";
  operationalStatus: "ENABLED" | "DISABLED";
  installedAt: string;
  leftAt?: string | null;
  lastSeenAt: string;
  lastCommandManifestHash?: string | null;
  lastCommandSyncAt?: string | null;
  lastCommandSyncErrorCode?: string | null;
}

export interface GuildBotListItem {
  bot: BotSummary;
  installation: BotInstallation;
}

export interface BotRuntimeStatus {
  botInstanceId: string;
  runtimeInstanceId?: string | null;
  leaseGeneration: number;
  runtimeState: BotRuntimeState;
  expiresAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastConnectedAt?: string | null;
  lastErrorCode?: string | null;
  claimedTokenVersion?: number | null;
}

export interface InstallationLlmSettings {
  id: string;
  botInstallationId: string;
  llmEnabledByGuild: boolean;
  llmEnabledByPlatform: boolean;
  modelOverride?: string | null;
  assistantPromptOverride?: string | null;
  gatekeeperPromptOverride?: string | null;
  retentionDaysOverride?: number | null;
  maxInputCharsOverride?: number | null;
  maxOutputTokensOverride?: number | null;
  settingsVersion: number;
}

export interface EffectiveBotSettings {
  model: string;
  assistantPrompt?: string | null;
  gatekeeperPrompt?: string | null;
  retentionDays: number;
  maxInputChars: number;
  maxOutputTokens: number;
  dmEnabled: boolean;
}

export interface BotInstallationSettingsResponse {
  installation: BotInstallation;
  settings: InstallationLlmSettings;
  profile: BotProfile;
  effective: EffectiveBotSettings;
  effectiveAiEnabled: boolean;
  effectivePrompts: EffectivePrompts;
  channels: LlmChannelSettings[];
  features: FeatureFlag[];
  commands: CommandPermission[];
}

export interface PlatformBotDetail {
  bot: BotSummary;
  profile: BotProfile;
  runtime: BotRuntimeStatus;
}

export interface FeatureFlag {
  id: string;
  featureKey: string;
  enabled: boolean;
  configJson: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface CommandPermission {
  id: string;
  commandKey: string;
  minRole: TenantRole;
  allowChannels: string[];
  denyChannels: string[];
  updatedAt: string;
}

export interface GuildSettingsResponse {
  guild: GuildRecord;
  installation: BotInstallation;
  features: FeatureFlag[];
  commands: CommandPermission[];
}

export interface LlmGuildSettings {
  id: string;
  guildId: string;
  enabled: boolean;
  platformEnabled: boolean;
  defaultModel: string;
  assistantPrompt?: string | null;
  gatekeeperPrompt?: string | null;
  retentionDays: number | null;
  dmEnabled: boolean;
  maxInputChars: number | null;
  maxOutputTokens: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LlmChannelSettings {
  id: string;
  botInstallationId: string;
  discordChannelId: string;
  enabled: boolean;
  respondOnMentionOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EffectivePrompts {
  assistant: string;
  gatekeeper: string;
}

export interface LlmSettingsResponse {
  guild: GuildRecord;
  installation: BotInstallation;
  settings: LlmGuildSettings;
  effective: EffectiveBotSettings;
  effectiveAiEnabled: boolean;
  channels: LlmChannelSettings[];
  effectivePrompts: EffectivePrompts;
}

export interface GuildMember {
  userId: string;
  discordUserId: string;
  username?: string | null;
  tenantRole: TenantRole;
  status: "ACTIVE" | "INVITED" | "REMOVED";
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface AuditLog {
  id: string;
  actorUserId?: string | null;
  actorType: "USER" | "SYSTEM" | "PLATFORM_ADMIN";
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface JobRun {
  id: string;
  jobType: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  errorText?: string | null;
  scheduledAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

export interface PlatformGuild {
  guildId: string;
  guildName: string;
  status: "ACTIVE" | "DISABLED" | "LEFT";
  ownerDiscordUserId?: string | null;
  memberCount: number;
  guildAiEnabled: boolean;
  platformAiEnabled: boolean;
  effectiveAiEnabled: boolean;
  defaultModel: string;
  updatedAt: string;
}

export interface SupportedModel {
  id: string;
  name: string;
  description: string;
}
