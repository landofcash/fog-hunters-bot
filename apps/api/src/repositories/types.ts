import type {
  AuditActorType,
  BotDesiredStatus,
  BotInstallationOperationalStatus,
  BotInstallationPresenceStatus,
  BotRuntimeState,
  DiscordEventProcessingStatus,
  DiscordEventType,
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
  status: "ACTIVE" | "DISABLED";
  ownerDiscordUserId?: string | null;
}
export interface MembershipRecord {
  guildId: string;
  userId: string;
  tenantRole: TenantRole;
  status: MemberStatus;
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
export interface BotInstanceRecord {
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
  createdAt: Date;
  updatedAt: Date;
}
export interface BotProfileRecord {
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
  createdAt: Date;
  updatedAt: Date;
}
export interface BotTokenSecretRecord {
  botInstanceId: string;
  ciphertext: Buffer;
  nonce: Buffer;
  authenticationTag: Buffer;
  encryptionKeyVersion: number;
  rotatedAt: Date;
}
export interface BotInstallationRecord {
  id: string;
  botInstanceId: string;
  guildId: string;
  guildDiscordId: string;
  guildName: string;
  guildStatus: "ACTIVE" | "DISABLED";
  presenceStatus: BotInstallationPresenceStatus;
  operationalStatus: BotInstallationOperationalStatus;
  installedAt: Date;
  leftAt?: Date | null;
  lastSeenAt: Date;
  lastCommandManifestHash?: string | null;
  lastCommandSyncAt?: Date | null;
  lastCommandSyncErrorCode?: string | null;
}
export interface BotRuntimeLeaseRecord {
  botInstanceId: string;
  runtimeInstanceId?: string | null;
  claimRequestId?: string | null;
  leaseGeneration: number;
  runtimeState: BotRuntimeState;
  expiresAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  lastConnectedAt?: Date | null;
  lastErrorCode?: string | null;
  lastErrorAt?: Date | null;
  claimedTokenVersion?: number | null;
  revokedAt?: Date | null;
}
export interface RuntimeAssignmentRecord {
  bot: BotInstanceRecord;
  lease: BotRuntimeLeaseRecord;
}
export interface RuntimeClaimRecord {
  bot: BotInstanceRecord;
  profile: BotProfileRecord;
  secret: BotTokenSecretRecord;
  lease: BotRuntimeLeaseRecord;
  leaseToken: string;
}
export interface BootstrapInstallationInput {
  botInstanceId: string;
  guildDiscordId: string;
  guildName: string;
  ownerProfile?: DiscordProfile;
}
export interface BootstrapInstallationResult {
  guild: GuildRecord;
  installation: BotInstallationRecord;
  guildCreated: boolean;
  installationCreated: boolean;
  ownerMembershipCreated: boolean;
  ownerChanged: boolean;
  previousOwnerDiscordUserId: string | null;
  ownerDiscordUserId: string | null;
}
export interface FeatureFlagRecord {
  id: string;
  botInstallationId: string;
  featureKey: string;
  enabled: boolean;
  configJson: Record<string, unknown>;
  version: number;
  updatedAt: Date;
}
export interface CommandPermissionRecord {
  id: string;
  botInstallationId: string;
  commandKey: string;
  minRole: TenantRole;
  allowChannels: string[];
  denyChannels: string[];
  updatedAt: Date;
}
export interface LlmInstallationSettingsRecord {
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
  createdAt: Date;
  updatedAt: Date;
}
export interface EffectiveBotSettings {
  bot: BotInstanceRecord;
  profile: BotProfileRecord;
  installation?: BotInstallationRecord;
  installationSettings?: LlmInstallationSettingsRecord;
  model: string;
  assistantPrompt?: string | null;
  gatekeeperPrompt?: string | null;
  retentionDays: number;
  maxInputChars: number;
  maxOutputTokens: number;
  dmEnabled: boolean;
}
export interface LlmChannelSettingsRecord {
  id: string;
  botInstallationId: string;
  discordChannelId: string;
  enabled: boolean;
  respondOnMentionOnly: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface LlmConversationRecord {
  id: string;
  botInstanceId: string;
  botInstallationId?: string | null;
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
  botInstanceId: string;
  botInstallationId?: string | null;
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
  botInstanceId: string;
  botInstallationId?: string | null;
  guildId?: string | null;
  conversationId?: string | null;
  category: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: Date;
}
export interface CommandAccessResult {
  guild: GuildRecord;
  installation: BotInstallationRecord;
  policy: { commandKey: string; minRole: TenantRole; allowChannels: string[]; denyChannels: string[] };
  actor?: { userId: string; tenantRole: TenantRole; platformRole?: PlatformRole };
  allowed: boolean;
  reason?: "NO_USER" | "NO_MEMBERSHIP" | "ROLE_TOO_LOW" | "CHANNEL_DENIED" | "CHANNEL_NOT_ALLOWED";
}
export interface AuditLogRecord {
  id: string;
  guildId?: string | null;
  botInstanceId?: string | null;
  botInstallationId?: string | null;
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
  guildId?: string | null;
  botInstanceId?: string | null;
  botInstallationId?: string | null;
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
export interface DiscordEventReceiptRecord {
  id: string;
  botInstanceId: string;
  discordEventId: string;
  eventType: DiscordEventType;
  leaseGeneration: number;
  acquisitionRequestId: string;
  processingStatus: DiscordEventProcessingStatus;
  attemptCount: number;
  lastErrorCode?: string | null;
  expiresAt: Date;
  updatedAt: Date;
}
export interface SessionRecord {
  id: string;
  userId: string;
  sessionTokenHash: string;
  expiresAt: Date;
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
  getGuildByDiscordId(guildDiscordId: string): Promise<GuildRecord | null>;
  ensureGuildMembership(guildDiscordId: string, userId: string): Promise<{ guild: GuildRecord; membership: MembershipRecord } | null>;
  upsertGuildMembership(guildDiscordId: string, userId: string): Promise<{ guild: GuildRecord; membership: MembershipRecord; created: boolean } | null>;
  getMembershipByDiscordUser(guildDiscordId: string, discordUserId: string): Promise<MembershipRecord | null>;
  listGuildMembers(guildDiscordId: string, limit: number, cursor?: string): Promise<CursorPage<GuildMemberListItem>>;
  listGuildAdministrators(guildDiscordId: string): Promise<GuildMemberListItem[]>;
  updateGuildMemberRole(input: { guildDiscordId: string; targetUserId: string; role: TenantRole }): Promise<{ guild: GuildRecord; before: MembershipRecord; after: MembershipRecord } | null>;

  createBot(input: { slug: string; displayName: string; discordApplicationId: string; defaultModel: string }): Promise<{ bot: BotInstanceRecord; profile: BotProfileRecord }>;
  getBot(botInstanceId: string): Promise<BotInstanceRecord | null>;
  listBots(input: { limit: number; cursor?: string; search?: string }): Promise<CursorPage<BotInstanceRecord>>;
  updateBot(input: { botInstanceId: string; displayName?: string; desiredStatus?: BotDesiredStatus }): Promise<BotInstanceRecord>;
  updateObservedBotIdentity(input: { botInstanceId: string; discordApplicationId: string; discordBotUserId: string; discordUsername: string; discordAvatarUrl?: string | null }): Promise<BotInstanceRecord>;
  getBotProfile(botInstanceId: string): Promise<BotProfileRecord | null>;
  updateBotProfile(input: { botInstanceId: string; defaultModel?: string; assistantPrompt?: string | null; gatekeeperPrompt?: string | null; dmEnabled?: boolean; retentionDays?: number; maxInputChars?: number; maxOutputTokens?: number }): Promise<BotProfileRecord>;
  getBotTokenSecret(botInstanceId: string): Promise<BotTokenSecretRecord | null>;
  configureBotToken(input: BotTokenSecretRecord & { rotatedByUserId?: string }): Promise<BotInstanceRecord>;
  deleteBotToken(botInstanceId: string): Promise<BotInstanceRecord>;

  bootstrapInstallation(input: BootstrapInstallationInput): Promise<BootstrapInstallationResult>;
  markInstallationLeft(input: { botInstanceId: string; guildDiscordId: string }): Promise<BotInstallationRecord | null>;
  getInstallation(botInstanceId: string, guildDiscordId: string): Promise<BotInstallationRecord | null>;
  getInstallationById(botInstanceId: string, installationId: string): Promise<BotInstallationRecord | null>;
  listBotInstallations(botInstanceId: string): Promise<BotInstallationRecord[]>;
  listPendingCommandSyncs(botInstanceId: string): Promise<BotInstallationRecord[]>;
  listGuildBots(guildDiscordId: string): Promise<Array<{ bot: BotInstanceRecord; installation: BotInstallationRecord }>>;
  updateInstallationOperationalStatus(input: { botInstanceId: string; guildDiscordId: string; operationalStatus: BotInstallationOperationalStatus }): Promise<BotInstallationRecord>;
  updateCommandManifest(input: { botInstanceId: string; guildDiscordId: string; hash?: string | null; errorCode?: string | null; syncedAt?: Date | null }): Promise<BotInstallationRecord>;
  requestCommandResync(botInstanceId: string, installationId: string): Promise<BotInstallationRecord>;

  getInstallationSettings(botInstanceId: string, guildDiscordId: string): Promise<{ installation: BotInstallationRecord; settings: LlmInstallationSettingsRecord; profile: BotProfileRecord }>;
  updateInstallationSettings(input: { botInstanceId: string; guildDiscordId: string; llmEnabledByGuild?: boolean; llmEnabledByPlatform?: boolean; modelOverride?: string | null; assistantPromptOverride?: string | null; gatekeeperPromptOverride?: string | null; retentionDaysOverride?: number | null; maxInputCharsOverride?: number | null; maxOutputTokensOverride?: number | null }): Promise<LlmInstallationSettingsRecord>;
  getEffectiveBotSettings(input: { botInstanceId: string; guildDiscordId?: string }): Promise<EffectiveBotSettings>;
  getFeatureFlag(botInstanceId: string, guildDiscordId: string, featureKey: string): Promise<FeatureFlagRecord | null>;
  listFeatureFlags(botInstanceId: string, guildDiscordId: string): Promise<FeatureFlagRecord[]>;
  upsertFeatureFlag(input: { botInstanceId: string; guildDiscordId: string; featureKey: string; enabled: boolean; configJson: Record<string, unknown>; expectedVersion?: number }): Promise<{ previous?: FeatureFlagRecord; current: FeatureFlagRecord }>;
  getCommandPermission(botInstanceId: string, guildDiscordId: string, commandKey: string): Promise<CommandPermissionRecord | null>;
  listCommandPermissions(botInstanceId: string, guildDiscordId: string): Promise<CommandPermissionRecord[]>;
  upsertCommandPermission(input: { botInstanceId: string; guildDiscordId: string; commandKey: string; minRole: TenantRole; allowChannels: string[]; denyChannels: string[] }): Promise<{ previous?: CommandPermissionRecord; current: CommandPermissionRecord }>;
  checkCommandAccess(input: { botInstanceId: string; guildDiscordId: string; commandKey: string; actorDiscordUserId: string; channelId?: string; defaultMinRole: TenantRole }): Promise<CommandAccessResult>;
  getLlmChannelSettings(botInstanceId: string, guildDiscordId: string, channelId: string): Promise<LlmChannelSettingsRecord | null>;
  listLlmChannelSettings(botInstanceId: string, guildDiscordId: string): Promise<LlmChannelSettingsRecord[]>;
  upsertLlmChannelSettings(input: { botInstanceId: string; guildDiscordId: string; channelId: string; enabled: boolean; respondOnMentionOnly?: boolean }): Promise<LlmChannelSettingsRecord>;
  clearLlmChannelMemory(botInstanceId: string, guildDiscordId: string, channelId: string): Promise<{ deletedMessages: number; deletedConversations: number }>;

  listRuntimeAssignments(now: Date): Promise<RuntimeAssignmentRecord[]>;
  getRuntimeLease(botInstanceId: string): Promise<BotRuntimeLeaseRecord | null>;
  claimRuntime(input: { botInstanceId: string; runtimeInstanceId: string; claimRequestId: string; leaseToken: string; leaseTokenHash: string; now: Date; expiresAt: Date }): Promise<RuntimeClaimRecord>;
  heartbeatRuntime(input: { botInstanceId: string; leaseGeneration: number; leaseTokenHash: string; now: Date; expiresAt: Date; runtimeState?: BotRuntimeState; connectedAt?: Date; errorCode?: string | null }): Promise<BotRuntimeLeaseRecord>;
  releaseRuntime(input: { botInstanceId: string; leaseGeneration: number; leaseTokenHash: string; now: Date }): Promise<BotRuntimeLeaseRecord>;
  validateRuntimeLease(input: { botInstanceId: string; leaseGeneration: number; leaseTokenHash: string; now: Date }): Promise<{ bot: BotInstanceRecord; lease: BotRuntimeLeaseRecord }>;
  revokeRuntimeLease(botInstanceId: string, now: Date): Promise<void>;

  acquireDiscordEvent(input: { botInstanceId: string; discordEventId: string; eventType: DiscordEventType; leaseGeneration: number; acquisitionRequestId: string; now: Date; expiresAt: Date; staleBefore: Date; maxAttempts: number }): Promise<{ receipt: DiscordEventReceiptRecord; acquired: boolean }>;
  completeDiscordEvent(input: { receiptId: string; botInstanceId: string; leaseGeneration: number; acquisitionRequestId: string }): Promise<void>;
  failDiscordEvent(input: { receiptId: string; botInstanceId: string; leaseGeneration: number; acquisitionRequestId: string; errorCode: string }): Promise<void>;
  purgeExpiredDiscordEventReceipts(now: Date, limit: number): Promise<number>;

  createAuditLog(input: { guildId?: string; botInstanceId?: string; botInstallationId?: string; actorUserId?: string; actorType: AuditActorType; action: string; entityType: string; entityId: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; metadata?: Record<string, unknown> }): Promise<AuditLogRecord>;
  listAuditLogs(input: { guildDiscordId: string; botInstanceId?: string; cursor?: string; limit: number; actorUserId?: string; action?: string; from?: Date; to?: Date }): Promise<CursorPage<AuditLogRecord>>;
  listJobRuns(input: { guildDiscordId: string; botInstanceId?: string; cursor?: string; limit: number; status?: JobStatus }): Promise<CursorPage<JobRunRecord>>;
  createJobRun(input: { guildDiscordId?: string; botInstanceId?: string; botInstallationId?: string; jobType: string; payload: Record<string, unknown> }): Promise<JobRunRecord>;
  updateJobRun(input: { jobRunId: string; status: JobStatus; attempts?: number; result?: Record<string, unknown>; errorText?: string; startedAt?: Date; finishedAt?: Date }): Promise<JobRunRecord>;

  createSession(input: { userId: string; sessionTokenHash: string; ipAddress?: string; userAgent?: string; expiresAt: Date }): Promise<SessionRecord>;
  getSessionByTokenHash(sessionTokenHash: string): Promise<(SessionRecord & { user: UserRecord }) | null>;
  deleteSessionByTokenHash(sessionTokenHash: string): Promise<void>;

  getOrCreateConversation(input: { botInstanceId: string; type: LlmConversationType; guildDiscordId?: string; channelId?: string; discordUserId?: string }): Promise<LlmConversationRecord>;
  listRecentConversationMessages(conversationId: string, limit: number): Promise<LlmMessageRecord[]>;
  appendConversationMessage(input: { conversationId: string; role: LlmMessageRole; content: string; tokenCount?: number }): Promise<LlmMessageRecord>;
  updateConversationSummary(conversationId: string, summaryText: string): Promise<LlmConversationRecord>;
  recordLlmGeneration(input: { conversationId: string; botInstanceId: string; botInstallationId?: string; guildId?: string; provider: string; model: string; status: LlmGenerationStatus; inputTokens: number; outputTokens: number; latencyMs: number; errorCode?: string; errorText?: string }): Promise<LlmGenerationRecord>;
  recordLlmModerationEvent(input: { botInstanceId: string; botInstallationId?: string; guildId?: string; conversationId?: string; category: string; action: string; details?: Record<string, unknown> }): Promise<LlmModerationEventRecord>;
  purgeExpiredLlmData(now: Date): Promise<{ deletedMessages: number; deletedGenerations: number; deletedModerationEvents: number; deletedConversations: number }>;
}
