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
  retentionDays: number;
  dmEnabled: boolean;
  maxInputChars: number;
  maxOutputTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface LlmChannelSettings {
  id: string;
  guildId: string;
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
  settings: LlmGuildSettings;
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
