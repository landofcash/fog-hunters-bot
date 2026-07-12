import type {
  AuditActorType,
  JobStatus,
  LlmConversationType,
  LlmGenerationStatus,
  LlmMessageRole,
  MemberStatus,
  PlatformRole,
  TenantRole,
} from "../lib/domain";

export interface DiscordProfile {
  discordUserId: string;
  username: string;
  globalName?: string | null;
  avatarUrl?: string | null;
}

export interface UserRecord {
  id: string;
  discordUserId: string;
  username?: string | null;
  globalName?: string | null;
  avatarUrl?: string | null;
  platformRole: PlatformRole;
}

export interface GuildRecord {
  id: string;
  discordGuildId: string;
  name: string;
}

export interface BootstrapGuildInput {
  guildDiscordId: string;
  guildName: string;
  ownerProfile?: DiscordProfile;
}

export interface BootstrapGuildResult {
  guild: GuildRecord;
  guildCreated: boolean;
  ownerMembershipCreated: boolean;
}

export interface MembershipRecord {
  guildId: string;
  userId: string;
  tenantRole: TenantRole;
  status: MemberStatus;
}

export interface FeatureFlagRecord {
  id: string;
  guildId: string;
  featureKey: string;
  enabled: boolean;
  configJson: Record<string, unknown>;
  version: number;
  updatedAt: Date;
}

export interface CommandPermissionRecord {
  id: string;
  guildId: string;
  commandKey: string;
  minRole: TenantRole;
  allowChannels: string[];
  denyChannels: string[];
  updatedAt: Date;
}

export interface GuildSettingsRecord {
  guild: GuildRecord;
  features: FeatureFlagRecord[];
  commands: CommandPermissionRecord[];
}

export interface GuildMembershipSummary {
  guildId: string;
  guildName: string;
  tenantRole: TenantRole;
}

export interface GuildMemberListItem {
  userId: string;
  discordUserId: string;
  username?: string | null;
  tenantRole: TenantRole;
  status: MemberStatus;
}

export interface AuditLogRecord {
  id: string;
  guildId: string;
  actorUserId?: string | null;
  actorType: AuditActorType;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface JobRunRecord {
  id: string;
  guildId: string;
  jobType: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  errorText?: string | null;
  scheduledAt: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  sessionTokenHash: string;
  expiresAt: Date;
}

export interface LlmGuildSettingsRecord {
  id: string;
  guildId: string;
  enabled: boolean;
  defaultModel: string;
  stylePrompt?: string | null;
  retentionDays: number;
  dmEnabled: boolean;
  maxInputChars: number;
  maxOutputTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LlmChannelSettingsRecord {
  id: string;
  guildId: string;
  discordChannelId: string;
  enabled: boolean;
  respondOnMentionOnly: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LlmConversationRecord {
  id: string;
  guildId?: string | null;
  discordChannelId?: string | null;
  discordUserId?: string | null;
  type: LlmConversationType;
  summaryText?: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LlmMessageRecord {
  id: string;
  conversationId: string;
  role: LlmMessageRole;
  content: string;
  tokenCount?: number | null;
  createdAt: Date;
}

export interface LlmGenerationRecord {
  id: string;
  conversationId: string;
  guildId?: string | null;
  provider: string;
  model: string;
  status: LlmGenerationStatus;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  errorCode?: string | null;
  errorText?: string | null;
  createdAt: Date;
}

export interface LlmModerationEventRecord {
  id: string;
  guildId?: string | null;
  conversationId?: string | null;
  category: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface CommandAccessResult {
  guild: GuildRecord;
  policy: {
    commandKey: string;
    minRole: TenantRole;
    allowChannels: string[];
    denyChannels: string[];
  };
  actor?: {
    userId: string;
    tenantRole: TenantRole;
  };
  allowed: boolean;
  reason?: "NO_USER" | "NO_MEMBERSHIP" | "ROLE_TOO_LOW" | "CHANNEL_DENIED" | "CHANNEL_NOT_ALLOWED";
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface AppRepository {
  upsertUserFromDiscord(profile: DiscordProfile, isPlatformAdmin: boolean): Promise<UserRecord>;
  getUserByDiscordId(discordUserId: string): Promise<UserRecord | null>;
  getUserById(userId: string): Promise<UserRecord | null>;
  getUserMemberships(userId: string): Promise<GuildMembershipSummary[]>;
  bootstrapGuild(input: BootstrapGuildInput): Promise<BootstrapGuildResult>;
  getGuildByDiscordId(guildDiscordId: string): Promise<GuildRecord | null>;
  ensureGuildMembership(
    guildDiscordId: string,
    userId: string,
  ): Promise<{ guild: GuildRecord; membership: MembershipRecord } | null>;
  getMembershipByDiscordUser(guildDiscordId: string, discordUserId: string): Promise<MembershipRecord | null>;
  getCommandPermission(guildDiscordId: string, commandKey: string): Promise<CommandPermissionRecord | null>;
  checkCommandAccess(input: {
    guildDiscordId: string;
    commandKey: string;
    actorDiscordUserId: string;
    channelId?: string;
    defaultMinRole: TenantRole;
  }): Promise<CommandAccessResult>;
  getGuildSettings(guildDiscordId: string): Promise<GuildSettingsRecord | null>;
  upsertFeatureFlag(input: {
    guildDiscordId: string;
    featureKey: string;
    enabled: boolean;
    configJson: Record<string, unknown>;
    expectedVersion?: number;
  }): Promise<{ previous?: FeatureFlagRecord; current: FeatureFlagRecord }>;
  upsertCommandPermission(input: {
    guildDiscordId: string;
    commandKey: string;
    minRole: TenantRole;
    allowChannels: string[];
    denyChannels: string[];
  }): Promise<{ previous?: CommandPermissionRecord; current: CommandPermissionRecord }>;
  listGuildMembers(guildDiscordId: string, limit: number, cursor?: string): Promise<CursorPage<GuildMemberListItem>>;
  updateGuildMemberRole(input: {
    guildDiscordId: string;
    targetUserId: string;
    role: TenantRole;
  }): Promise<{ guild: GuildRecord; before: MembershipRecord; after: MembershipRecord } | null>;
  createAuditLog(input: {
    guildId: string;
    actorUserId?: string;
    actorType: AuditActorType;
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogRecord>;
  listAuditLogs(input: {
    guildDiscordId: string;
    cursor?: string;
    limit: number;
    actorUserId?: string;
    action?: string;
    from?: Date;
    to?: Date;
  }): Promise<CursorPage<AuditLogRecord>>;
  listJobRuns(input: {
    guildDiscordId: string;
    cursor?: string;
    limit: number;
    status?: JobStatus;
  }): Promise<CursorPage<JobRunRecord>>;
  createSession(input: {
    userId: string;
    sessionTokenHash: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  getSessionByTokenHash(sessionTokenHash: string): Promise<(SessionRecord & { user: UserRecord }) | null>;
  deleteSessionByTokenHash(sessionTokenHash: string): Promise<void>;
  createJobRun(input: {
    guildDiscordId: string;
    jobType: string;
    payload: Record<string, unknown>;
  }): Promise<JobRunRecord>;
  updateJobRun(input: {
    jobRunId: string;
    status: JobStatus;
    attempts?: number;
    result?: Record<string, unknown>;
    errorText?: string;
    startedAt?: Date;
    finishedAt?: Date;
  }): Promise<JobRunRecord>;
  getOrCreateLlmGuildSettings(guildDiscordId: string): Promise<{ guild: GuildRecord; settings: LlmGuildSettingsRecord }>;
  updateLlmGuildSettings(input: {
    guildDiscordId: string;
    enabled?: boolean;
    defaultModel?: string;
    stylePrompt?: string | null;
    retentionDays?: number;
    dmEnabled?: boolean;
    maxInputChars?: number;
    maxOutputTokens?: number;
  }): Promise<{ guild: GuildRecord; settings: LlmGuildSettingsRecord }>;
  getLlmChannelSettings(guildDiscordId: string, channelId: string): Promise<LlmChannelSettingsRecord | null>;
  upsertLlmChannelSettings(input: {
    guildDiscordId: string;
    channelId: string;
    enabled: boolean;
    respondOnMentionOnly?: boolean;
  }): Promise<LlmChannelSettingsRecord>;
  clearLlmChannelMemory(guildDiscordId: string, channelId: string): Promise<{ deletedMessages: number; deletedConversations: number }>;
  getOrCreateConversation(input: {
    type: LlmConversationType;
    guildDiscordId?: string;
    channelId?: string;
    discordUserId?: string;
  }): Promise<LlmConversationRecord>;
  listRecentConversationMessages(conversationId: string, limit: number): Promise<LlmMessageRecord[]>;
  appendConversationMessage(input: {
    conversationId: string;
    role: LlmMessageRole;
    content: string;
    tokenCount?: number;
  }): Promise<LlmMessageRecord>;
  updateConversationSummary(conversationId: string, summaryText: string): Promise<LlmConversationRecord>;
  recordLlmGeneration(input: {
    conversationId: string;
    guildId?: string;
    provider: string;
    model: string;
    status: LlmGenerationStatus;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    errorCode?: string;
    errorText?: string;
  }): Promise<LlmGenerationRecord>;
  recordLlmModerationEvent(input: {
    guildId?: string;
    conversationId?: string;
    category: string;
    action: string;
    details?: Record<string, unknown>;
  }): Promise<LlmModerationEventRecord>;
  purgeExpiredLlmData(now: Date): Promise<{ deletedMessages: number; deletedGenerations: number; deletedModerationEvents: number; deletedConversations: number }>;
}
