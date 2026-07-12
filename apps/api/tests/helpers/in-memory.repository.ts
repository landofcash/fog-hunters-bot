import type {
  AppRepository,
  AuditLogRecord,
  BootstrapGuildInput,
  BootstrapGuildResult,
  CommandAccessResult,
  CommandPermissionRecord,
  CursorPage,
  DiscordProfile,
  FeatureFlagRecord,
  GuildMemberListItem,
  GuildMembershipSummary,
  GuildRecord,
  GuildSettingsRecord,
  JobRunRecord,
  LlmChannelSettingsRecord,
  LlmConversationRecord,
  LlmGenerationRecord,
  LlmGuildSettingsRecord,
  LlmMessageRecord,
  LlmModerationEventRecord,
  MembershipRecord,
  SessionRecord,
  UserRecord,
} from "../../src/repositories/types";
import type {
  AuditActorType,
  JobStatus,
  LlmConversationType,
  LlmGenerationStatus,
  LlmMessageRole,
  MemberStatus,
  TenantRole,
} from "../../src/lib/domain";
import { generateId } from "../../src/lib/ids";
import { ApiError } from "../../src/lib/errors";
import { DEFAULT_COMMAND_POLICIES, DEFAULT_FEATURE_FLAGS } from "../../src/lib/defaults";

function paginate<T>(items: T[], limit: number, cursor?: string): CursorPage<T> {
  const offset = cursor ? Number(Buffer.from(cursor, "base64url").toString("utf8")) : 0;
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
  const slice = items.slice(safeOffset, safeOffset + limit + 1);
  const hasMore = slice.length > limit;
  return {
    items: hasMore ? slice.slice(0, limit) : slice,
    nextCursor: hasMore ? Buffer.from(String(safeOffset + limit), "utf8").toString("base64url") : undefined,
  };
}

export class InMemoryRepository implements AppRepository {
  users = new Map<string, UserRecord>();
  usersByDiscordId = new Map<string, string>();
  guilds = new Map<string, GuildRecord>();
  guildsByDiscordId = new Map<string, string>();
  memberships = new Map<string, MembershipRecord>();
  features = new Map<string, FeatureFlagRecord>();
  commandPermissions = new Map<string, CommandPermissionRecord>();
  auditLogs: AuditLogRecord[] = [];
  jobRuns: JobRunRecord[] = [];
  sessions = new Map<string, SessionRecord>();
  llmGuildSettings = new Map<string, LlmGuildSettingsRecord>();
  llmChannelSettings = new Map<string, LlmChannelSettingsRecord>();
  llmConversations = new Map<string, LlmConversationRecord>();
  llmMessages: LlmMessageRecord[] = [];
  llmGenerations: LlmGenerationRecord[] = [];
  llmModerationEvents: LlmModerationEventRecord[] = [];

  membershipKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  featureKey(guildId: string, featureKey: string): string {
    return `${guildId}:${featureKey}`;
  }

  commandKey(guildId: string, commandKey: string): string {
    return `${guildId}:${commandKey}`;
  }

  llmChannelKey(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }

  async upsertUserFromDiscord(profile: DiscordProfile, isPlatformAdmin: boolean): Promise<UserRecord> {
    const existingId = this.usersByDiscordId.get(profile.discordUserId);
    if (existingId) {
      const current = this.users.get(existingId);
      if (!current) throw new ApiError(500, "DATA_CORRUPTION", "Missing user.");
      const updated: UserRecord = {
        ...current,
        username: profile.username,
        globalName: profile.globalName,
        avatarUrl: profile.avatarUrl,
        platformRole: isPlatformAdmin ? "PLATFORM_ADMIN" : "NONE",
      };
      this.users.set(existingId, updated);
      return updated;
    }

    const created: UserRecord = {
      id: generateId(),
      discordUserId: profile.discordUserId,
      username: profile.username,
      globalName: profile.globalName,
      avatarUrl: profile.avatarUrl,
      platformRole: isPlatformAdmin ? "PLATFORM_ADMIN" : "NONE",
    };
    this.users.set(created.id, created);
    this.usersByDiscordId.set(created.discordUserId, created.id);
    return created;
  }

  async getUserByDiscordId(discordUserId: string): Promise<UserRecord | null> {
    const userId = this.usersByDiscordId.get(discordUserId);
    if (!userId) return null;
    return this.users.get(userId) ?? null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async getUserMemberships(userId: string): Promise<GuildMembershipSummary[]> {
    const memberships: GuildMembershipSummary[] = [];
    for (const membership of this.memberships.values()) {
      if (membership.userId !== userId || membership.status !== "ACTIVE") continue;
      const guild = this.guilds.get(membership.guildId);
      if (!guild) continue;
      memberships.push({
        guildId: guild.discordGuildId,
        guildName: guild.name,
        tenantRole: membership.tenantRole,
      });
    }
    memberships.sort((a, b) => a.guildName.localeCompare(b.guildName));
    return memberships;
  }

  async getGuildByDiscordId(guildDiscordId: string): Promise<GuildRecord | null> {
    const guildId = this.guildsByDiscordId.get(guildDiscordId);
    if (!guildId) return null;
    return this.guilds.get(guildId) ?? null;
  }

  async bootstrapGuild(input: BootstrapGuildInput): Promise<BootstrapGuildResult> {
    const existingGuildId = this.guildsByDiscordId.get(input.guildDiscordId);
    const guild =
      existingGuildId && this.guilds.has(existingGuildId)
        ? { ...(this.guilds.get(existingGuildId) as GuildRecord), name: input.guildName }
        : {
            id: generateId(),
            discordGuildId: input.guildDiscordId,
            name: input.guildName,
          };
    this.guilds.set(guild.id, guild);
    this.guildsByDiscordId.set(guild.discordGuildId, guild.id);

    for (const feature of DEFAULT_FEATURE_FLAGS) {
      const key = this.featureKey(guild.id, feature.featureKey);
      if (!this.features.has(key)) {
        this.features.set(key, {
          id: generateId(),
          guildId: guild.id,
          featureKey: feature.featureKey,
          enabled: feature.enabled,
          configJson: feature.configJson,
          version: 1,
          updatedAt: new Date(),
        });
      }
    }

    for (const command of DEFAULT_COMMAND_POLICIES) {
      const key = this.commandKey(guild.id, command.commandKey);
      if (!this.commandPermissions.has(key)) {
        this.commandPermissions.set(key, {
          id: generateId(),
          guildId: guild.id,
          commandKey: command.commandKey,
          minRole: command.minRole,
          allowChannels: command.allowChannels,
          denyChannels: command.denyChannels,
          updatedAt: new Date(),
        });
      }
    }

    let ownerMembershipCreated = false;
    if (input.ownerProfile) {
      const ownerUser = await this.upsertUserFromDiscord(input.ownerProfile, false);
      const ownerCount = this.countGuildOwners(guild.id);
      const memberKey = this.membershipKey(guild.id, ownerUser.id);
      const existingMembership = this.memberships.get(memberKey);
      if (ownerCount === 0) {
        this.memberships.set(memberKey, {
          guildId: guild.id,
          userId: ownerUser.id,
          tenantRole: "OWNER",
          status: "ACTIVE",
        });
        ownerMembershipCreated = true;
      } else if (!existingMembership) {
        this.memberships.set(memberKey, {
          guildId: guild.id,
          userId: ownerUser.id,
          tenantRole: "USER",
          status: "ACTIVE",
        });
        ownerMembershipCreated = true;
      }
    }

    return {
      guild,
      guildCreated: !existingGuildId,
      ownerMembershipCreated,
    };
  }

  async ensureGuildMembership(
    guildDiscordId: string,
    userId: string,
  ): Promise<{ guild: GuildRecord; membership: MembershipRecord } | null> {
    const guildId = this.guildsByDiscordId.get(guildDiscordId);
    if (!guildId) return null;
    const guild = this.guilds.get(guildId);
    if (!guild) return null;
    const membership = this.memberships.get(this.membershipKey(guild.id, userId));
    if (!membership || membership.status !== "ACTIVE") return null;
    return { guild, membership };
  }

  async getMembershipByDiscordUser(guildDiscordId: string, discordUserId: string): Promise<MembershipRecord | null> {
    const userId = this.usersByDiscordId.get(discordUserId);
    const guildId = this.guildsByDiscordId.get(guildDiscordId);
    if (!userId || !guildId) return null;
    return this.memberships.get(this.membershipKey(guildId, userId)) ?? null;
  }

  async getGuildSettings(guildDiscordId: string): Promise<GuildSettingsRecord | null> {
    const guildId = this.guildsByDiscordId.get(guildDiscordId);
    if (!guildId) return null;
    const guild = this.guilds.get(guildId);
    if (!guild) return null;

    const features = Array.from(this.features.values()).filter((value) => value.guildId === guild.id);
    const commands = Array.from(this.commandPermissions.values()).filter((value) => value.guildId === guild.id);
    features.sort((a, b) => a.featureKey.localeCompare(b.featureKey));
    commands.sort((a, b) => a.commandKey.localeCompare(b.commandKey));

    return { guild, features, commands };
  }

  async getCommandPermission(guildDiscordId: string, commandKey: string): Promise<CommandPermissionRecord | null> {
    const guildId = this.guildsByDiscordId.get(guildDiscordId);
    if (!guildId) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    return this.commandPermissions.get(this.commandKey(guildId, commandKey)) ?? null;
  }

  async checkCommandAccess(input: {
    guildDiscordId: string;
    commandKey: string;
    actorDiscordUserId: string;
    channelId?: string;
    defaultMinRole: TenantRole;
  }): Promise<CommandAccessResult> {
    const guild = await this.getGuildByDiscordId(input.guildDiscordId);
    if (!guild) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    const policy = (await this.getCommandPermission(input.guildDiscordId, input.commandKey)) ?? {
      id: "",
      guildId: guild.id,
      commandKey: input.commandKey,
      minRole: input.defaultMinRole,
      allowChannels: [],
      denyChannels: [],
      updatedAt: new Date(0),
    };
    const actor = await this.getUserByDiscordId(input.actorDiscordUserId);
    if (!actor) return { guild, policy, allowed: false, reason: "NO_USER" };
    const membership = await this.ensureGuildMembership(input.guildDiscordId, actor.id);
    if (!membership) return { guild, policy, allowed: false, reason: "NO_MEMBERSHIP" };

    const roleRank: Record<TenantRole, number> = { USER: 1, MODERATOR: 2, ADMIN: 3, OWNER: 4 };
    const actorRole = membership.membership.tenantRole;
    if (roleRank[actorRole] < roleRank[policy.minRole]) {
      return {
        guild,
        policy,
        actor: { userId: actor.id, tenantRole: actorRole },
        allowed: false,
        reason: "ROLE_TOO_LOW",
      };
    }
    if (input.channelId && policy.denyChannels.includes(input.channelId)) {
      return {
        guild,
        policy,
        actor: { userId: actor.id, tenantRole: actorRole },
        allowed: false,
        reason: "CHANNEL_DENIED",
      };
    }
    if (input.channelId && policy.allowChannels.length > 0 && !policy.allowChannels.includes(input.channelId)) {
      return {
        guild,
        policy,
        actor: { userId: actor.id, tenantRole: actorRole },
        allowed: false,
        reason: "CHANNEL_NOT_ALLOWED",
      };
    }

    return {
      guild,
      policy,
      actor: { userId: actor.id, tenantRole: actorRole },
      allowed: true,
    };
  }

  async upsertFeatureFlag(input: {
    guildDiscordId: string;
    featureKey: string;
    enabled: boolean;
    configJson: Record<string, unknown>;
    expectedVersion?: number;
  }): Promise<{ previous?: FeatureFlagRecord; current: FeatureFlagRecord }> {
    const guildId = this.guildsByDiscordId.get(input.guildDiscordId);
    if (!guildId) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");

    const key = this.featureKey(guildId, input.featureKey);
    const previous = this.features.get(key);
    if (previous && input.expectedVersion && input.expectedVersion !== previous.version) {
      throw new ApiError(409, "FEATURE_VERSION_CONFLICT", "Feature configuration version conflict.");
    }
    const current: FeatureFlagRecord = {
      id: previous?.id ?? generateId(),
      guildId,
      featureKey: input.featureKey,
      enabled: input.enabled,
      configJson: input.configJson,
      version: previous ? previous.version + 1 : 1,
      updatedAt: new Date(),
    };
    this.features.set(key, current);
    return { previous, current };
  }

  async upsertCommandPermission(input: {
    guildDiscordId: string;
    commandKey: string;
    minRole: TenantRole;
    allowChannels: string[];
    denyChannels: string[];
  }): Promise<{ previous?: CommandPermissionRecord; current: CommandPermissionRecord }> {
    const guildId = this.guildsByDiscordId.get(input.guildDiscordId);
    if (!guildId) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");

    const key = this.commandKey(guildId, input.commandKey);
    const previous = this.commandPermissions.get(key);
    const current: CommandPermissionRecord = {
      id: previous?.id ?? generateId(),
      guildId,
      commandKey: input.commandKey,
      minRole: input.minRole,
      allowChannels: input.allowChannels,
      denyChannels: input.denyChannels,
      updatedAt: new Date(),
    };
    this.commandPermissions.set(key, current);
    return { previous, current };
  }

  async listGuildMembers(guildDiscordId: string, limit: number, cursor?: string): Promise<CursorPage<GuildMemberListItem>> {
    const guildId = this.guildsByDiscordId.get(guildDiscordId);
    if (!guildId) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");

    const items = Array.from(this.memberships.values())
      .filter((m) => m.guildId === guildId)
      .map((membership) => {
        const user = this.users.get(membership.userId);
        if (!user) throw new ApiError(500, "DATA_CORRUPTION", "Missing user.");
        return {
          userId: membership.userId,
          discordUserId: user.discordUserId,
          username: user.username,
          tenantRole: membership.tenantRole,
          status: membership.status,
        };
      });

    return paginate(items, limit, cursor);
  }

  async updateGuildMemberRole(input: {
    guildDiscordId: string;
    targetUserId: string;
    role: TenantRole;
  }): Promise<{ guild: GuildRecord; before: MembershipRecord; after: MembershipRecord } | null> {
    const guildId = this.guildsByDiscordId.get(input.guildDiscordId);
    if (!guildId) return null;
    const guild = this.guilds.get(guildId);
    if (!guild) return null;
    const key = this.membershipKey(guild.id, input.targetUserId);
    const before = this.memberships.get(key);
    if (!before) return null;
    if (before.tenantRole === "OWNER" && input.role !== "OWNER" && this.countGuildOwners(guild.id) <= 1) {
      throw new ApiError(409, "LAST_OWNER_PROTECTED", "Cannot demote the last OWNER.");
    }
    const after: MembershipRecord = { ...before, tenantRole: input.role };
    this.memberships.set(key, after);
    return { guild, before, after };
  }

  private countGuildOwners(guildId: string): number {
    return Array.from(this.memberships.values()).filter((m) => m.guildId === guildId && m.tenantRole === "OWNER").length;
  }

  async createAuditLog(input: {
    guildId: string;
    actorUserId?: string;
    actorType: AuditActorType;
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogRecord> {
    const record: AuditLogRecord = {
      id: generateId(),
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    this.auditLogs.push(record);
    return record;
  }

  async listAuditLogs(input: {
    guildDiscordId: string;
    cursor?: string;
    limit: number;
    actorUserId?: string;
    action?: string;
    from?: Date;
    to?: Date;
  }): Promise<CursorPage<AuditLogRecord>> {
    const guildId = this.guildsByDiscordId.get(input.guildDiscordId);
    if (!guildId) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    const filtered = this.auditLogs
      .filter((item) => item.guildId === guildId)
      .filter((item) => (input.actorUserId ? item.actorUserId === input.actorUserId : true))
      .filter((item) => (input.action ? item.action === input.action : true))
      .filter((item) => (input.from ? item.createdAt >= input.from : true))
      .filter((item) => (input.to ? item.createdAt <= input.to : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginate(filtered, input.limit, input.cursor);
  }

  async listJobRuns(input: {
    guildDiscordId: string;
    cursor?: string;
    limit: number;
    status?: JobStatus;
  }): Promise<CursorPage<JobRunRecord>> {
    const guildId = this.guildsByDiscordId.get(input.guildDiscordId);
    if (!guildId) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    const filtered = this.jobRuns
      .filter((item) => item.guildId === guildId)
      .filter((item) => (input.status ? item.status === input.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginate(filtered, input.limit, input.cursor);
  }

  async createSession(input: {
    userId: string;
    sessionTokenHash: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: generateId(),
      userId: input.userId,
      sessionTokenHash: input.sessionTokenHash,
      expiresAt: input.expiresAt,
    };
    this.sessions.set(input.sessionTokenHash, record);
    return record;
  }

  async getSessionByTokenHash(sessionTokenHash: string): Promise<(SessionRecord & { user: UserRecord }) | null> {
    const session = this.sessions.get(sessionTokenHash);
    if (!session) return null;
    if (session.expiresAt <= new Date()) return null;
    const user = this.users.get(session.userId);
    if (!user) return null;
    return { ...session, user };
  }

  async deleteSessionByTokenHash(sessionTokenHash: string): Promise<void> {
    this.sessions.delete(sessionTokenHash);
  }

  async createJobRun(input: {
    guildDiscordId: string;
    jobType: string;
    payload: Record<string, unknown>;
  }): Promise<JobRunRecord> {
    const guildId = this.guildsByDiscordId.get(input.guildDiscordId);
    if (!guildId) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    const run: JobRunRecord = {
      id: generateId(),
      guildId,
      jobType: input.jobType,
      status: "QUEUED",
      attempts: 0,
      maxAttempts: 10,
      payload: input.payload,
      scheduledAt: new Date(),
      createdAt: new Date(),
    };
    this.jobRuns.push(run);
    return run;
  }

  async updateJobRun(input: {
    jobRunId: string;
    status: JobStatus;
    attempts?: number;
    result?: Record<string, unknown>;
    errorText?: string;
    startedAt?: Date;
    finishedAt?: Date;
  }): Promise<JobRunRecord> {
    const idx = this.jobRuns.findIndex((entry) => entry.id === input.jobRunId);
    if (idx < 0) throw new ApiError(404, "JOB_RUN_NOT_FOUND", "Job run not found.");
    const current = this.jobRuns[idx]!;
    const updated: JobRunRecord = {
      ...current,
      status: input.status,
      attempts: input.attempts ?? current.attempts,
      result: input.result ?? current.result,
      errorText: input.errorText ?? current.errorText,
      startedAt: input.startedAt ?? current.startedAt,
      finishedAt: input.finishedAt ?? current.finishedAt,
    };
    this.jobRuns[idx] = updated;
    return updated;
  }

  async getOrCreateLlmGuildSettings(guildDiscordId: string): Promise<{ guild: GuildRecord; settings: LlmGuildSettingsRecord }> {
    const guild = await this.getGuildByDiscordId(guildDiscordId);
    if (!guild) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }

    const existing = this.llmGuildSettings.get(guild.id);
    if (existing) {
      return { guild, settings: existing };
    }

    const now = new Date();
    const created: LlmGuildSettingsRecord = {
      id: generateId(),
      guildId: guild.id,
      enabled: false,
      defaultModel: "gpt-4.1-mini",
      stylePrompt: null,
      retentionDays: 90,
      dmEnabled: true,
      maxInputChars: 4000,
      maxOutputTokens: 512,
      createdAt: now,
      updatedAt: now,
    };
    this.llmGuildSettings.set(guild.id, created);
    return { guild, settings: created };
  }

  async updateLlmGuildSettings(input: {
    guildDiscordId: string;
    enabled?: boolean;
    defaultModel?: string;
    stylePrompt?: string | null;
    retentionDays?: number;
    dmEnabled?: boolean;
    maxInputChars?: number;
    maxOutputTokens?: number;
  }): Promise<{ guild: GuildRecord; settings: LlmGuildSettingsRecord }> {
    const { guild, settings } = await this.getOrCreateLlmGuildSettings(input.guildDiscordId);
    const updated: LlmGuildSettingsRecord = {
      ...settings,
      enabled: input.enabled ?? settings.enabled,
      defaultModel: input.defaultModel ?? settings.defaultModel,
      stylePrompt: input.stylePrompt === undefined ? settings.stylePrompt : input.stylePrompt,
      retentionDays: input.retentionDays ?? settings.retentionDays,
      dmEnabled: input.dmEnabled ?? settings.dmEnabled,
      maxInputChars: input.maxInputChars ?? settings.maxInputChars,
      maxOutputTokens: input.maxOutputTokens ?? settings.maxOutputTokens,
      updatedAt: new Date(),
    };
    this.llmGuildSettings.set(guild.id, updated);
    return { guild, settings: updated };
  }

  async getLlmChannelSettings(guildDiscordId: string, channelId: string): Promise<LlmChannelSettingsRecord | null> {
    const guild = await this.getGuildByDiscordId(guildDiscordId);
    if (!guild) {
      return null;
    }
    return this.llmChannelSettings.get(this.llmChannelKey(guild.id, channelId)) ?? null;
  }

  async upsertLlmChannelSettings(input: {
    guildDiscordId: string;
    channelId: string;
    enabled: boolean;
    respondOnMentionOnly?: boolean;
  }): Promise<LlmChannelSettingsRecord> {
    const guild = await this.getGuildByDiscordId(input.guildDiscordId);
    if (!guild) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }
    const key = this.llmChannelKey(guild.id, input.channelId);
    const prev = this.llmChannelSettings.get(key);
    const now = new Date();
    const current: LlmChannelSettingsRecord = {
      id: prev?.id ?? generateId(),
      guildId: guild.id,
      discordChannelId: input.channelId,
      enabled: input.enabled,
      respondOnMentionOnly: input.respondOnMentionOnly ?? prev?.respondOnMentionOnly ?? false,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    this.llmChannelSettings.set(key, current);
    return current;
  }

  async clearLlmChannelMemory(
    guildDiscordId: string,
    channelId: string,
  ): Promise<{ deletedMessages: number; deletedConversations: number }> {
    const guild = await this.getGuildByDiscordId(guildDiscordId);
    if (!guild) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }

    const conversationIds = Array.from(this.llmConversations.values())
      .filter((item) => item.guildId === guild.id && item.discordChannelId === channelId && item.type === "GUILD_CHANNEL")
      .map((item) => item.id);

    const messageBefore = this.llmMessages.length;
    this.llmMessages = this.llmMessages.filter((item) => !conversationIds.includes(item.conversationId));
    this.llmGenerations = this.llmGenerations.filter((item) => !conversationIds.includes(item.conversationId));
    this.llmModerationEvents = this.llmModerationEvents.filter((item) => !conversationIds.includes(item.conversationId ?? ""));
    for (const conversationId of conversationIds) {
      this.llmConversations.delete(conversationId);
    }
    return {
      deletedMessages: messageBefore - this.llmMessages.length,
      deletedConversations: conversationIds.length,
    };
  }

  async getOrCreateConversation(input: {
    type: LlmConversationType;
    guildDiscordId?: string;
    channelId?: string;
    discordUserId?: string;
  }): Promise<LlmConversationRecord> {
    if (input.type === "GUILD_CHANNEL") {
      if (!input.guildDiscordId || !input.channelId) {
        throw new ApiError(400, "INVALID_CONVERSATION_SCOPE", "Guild conversation requires guild and channel IDs.");
      }
      const guild = await this.getGuildByDiscordId(input.guildDiscordId);
      if (!guild) {
        throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
      }
      const existing = Array.from(this.llmConversations.values()).find(
        (item) =>
          item.type === "GUILD_CHANNEL" &&
          item.guildId === guild.id &&
          item.discordChannelId === input.channelId,
      );
      if (existing) {
        return existing;
      }
      const now = new Date();
      const created: LlmConversationRecord = {
        id: generateId(),
        guildId: guild.id,
        discordChannelId: input.channelId,
        discordUserId: null,
        type: "GUILD_CHANNEL",
        summaryText: null,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      };
      this.llmConversations.set(created.id, created);
      return created;
    }

    if (!input.discordUserId) {
      throw new ApiError(400, "INVALID_CONVERSATION_SCOPE", "DM conversation requires discordUserId.");
    }

    const existing = Array.from(this.llmConversations.values()).find(
      (item) => item.type === "DM" && item.discordUserId === input.discordUserId,
    );
    if (existing) {
      return existing;
    }

    const now = new Date();
    const created: LlmConversationRecord = {
      id: generateId(),
      guildId: null,
      discordChannelId: null,
      discordUserId: input.discordUserId,
      type: "DM",
      summaryText: null,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.llmConversations.set(created.id, created);
    return created;
  }

  async listRecentConversationMessages(conversationId: string, limit: number): Promise<LlmMessageRecord[]> {
    const messages = this.llmMessages
      .filter((item) => item.conversationId === conversationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return messages.slice(Math.max(0, messages.length - limit));
  }

  async appendConversationMessage(input: {
    conversationId: string;
    role: LlmMessageRole;
    content: string;
    tokenCount?: number;
  }): Promise<LlmMessageRecord> {
    const conversation = this.llmConversations.get(input.conversationId);
    if (!conversation) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
    const record: LlmMessageRecord = {
      id: generateId(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      tokenCount: input.tokenCount,
      createdAt: new Date(),
    };
    this.llmMessages.push(record);
    this.llmConversations.set(conversation.id, {
      ...conversation,
      lastMessageAt: record.createdAt,
      updatedAt: record.createdAt,
    });
    return record;
  }

  async updateConversationSummary(conversationId: string, summaryText: string): Promise<LlmConversationRecord> {
    const conversation = this.llmConversations.get(conversationId);
    if (!conversation) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
    const updated: LlmConversationRecord = {
      ...conversation,
      summaryText,
      updatedAt: new Date(),
    };
    this.llmConversations.set(conversation.id, updated);
    return updated;
  }

  async recordLlmGeneration(input: {
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
  }): Promise<LlmGenerationRecord> {
    const record: LlmGenerationRecord = {
      id: generateId(),
      conversationId: input.conversationId,
      guildId: input.guildId,
      provider: input.provider,
      model: input.model,
      status: input.status,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode,
      errorText: input.errorText,
      createdAt: new Date(),
    };
    this.llmGenerations.push(record);
    return record;
  }

  async recordLlmModerationEvent(input: {
    guildId?: string;
    conversationId?: string;
    category: string;
    action: string;
    details?: Record<string, unknown>;
  }): Promise<LlmModerationEventRecord> {
    const record: LlmModerationEventRecord = {
      id: generateId(),
      guildId: input.guildId,
      conversationId: input.conversationId,
      category: input.category,
      action: input.action,
      details: input.details ?? {},
      createdAt: new Date(),
    };
    this.llmModerationEvents.push(record);
    return record;
  }

  async purgeExpiredLlmData(now: Date): Promise<{
    deletedMessages: number;
    deletedGenerations: number;
    deletedModerationEvents: number;
    deletedConversations: number;
  }> {
    const messageBefore = this.llmMessages.length;
    const generationBefore = this.llmGenerations.length;
    const moderationBefore = this.llmModerationEvents.length;
    const conversationBefore = this.llmConversations.size;

    const conversationCutoffs = new Map<string, Date>();
    for (const conversation of this.llmConversations.values()) {
      const retentionDays =
        conversation.guildId && this.llmGuildSettings.get(conversation.guildId)
          ? (this.llmGuildSettings.get(conversation.guildId) as LlmGuildSettingsRecord).retentionDays
          : 90;
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      conversationCutoffs.set(conversation.id, cutoff);
    }

    this.llmMessages = this.llmMessages.filter((message) => {
      const cutoff = conversationCutoffs.get(message.conversationId);
      return cutoff ? message.createdAt >= cutoff : true;
    });

    this.llmGenerations = this.llmGenerations.filter((generation) => {
      const cutoff = conversationCutoffs.get(generation.conversationId);
      return cutoff ? generation.createdAt >= cutoff : true;
    });

    this.llmModerationEvents = this.llmModerationEvents.filter((event) => {
      if (!event.conversationId) return true;
      const cutoff = conversationCutoffs.get(event.conversationId);
      return cutoff ? event.createdAt >= cutoff : true;
    });

    const conversationIdsWithMessages = new Set(this.llmMessages.map((item) => item.conversationId));
    for (const conversationId of Array.from(this.llmConversations.keys())) {
      if (!conversationIdsWithMessages.has(conversationId)) {
        this.llmConversations.delete(conversationId);
      }
    }

    return {
      deletedMessages: messageBefore - this.llmMessages.length,
      deletedGenerations: generationBefore - this.llmGenerations.length,
      deletedModerationEvents: moderationBefore - this.llmModerationEvents.length,
      deletedConversations: conversationBefore - this.llmConversations.size,
    };
  }

  seedGuild(guildDiscordId: string, name: string): GuildRecord {
    const guild: GuildRecord = { id: generateId(), discordGuildId: guildDiscordId, name };
    this.guilds.set(guild.id, guild);
    this.guildsByDiscordId.set(guild.discordGuildId, guild.id);
    return guild;
  }

  seedMembership(input: { guildId: string; userId: string; tenantRole: TenantRole; status?: MemberStatus }): void {
    this.memberships.set(this.membershipKey(input.guildId, input.userId), {
      guildId: input.guildId,
      userId: input.userId,
      tenantRole: input.tenantRole,
      status: input.status ?? "ACTIVE",
    });
  }
}
