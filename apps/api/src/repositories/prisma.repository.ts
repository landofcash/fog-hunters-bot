import { Prisma, type PrismaClient } from "@prisma/client";
import { ApiError } from "../lib/errors";
import { DEFAULT_COMMAND_POLICIES, DEFAULT_FEATURE_FLAGS } from "../lib/defaults";
import { generateId } from "../lib/ids";
import type {
  AppRepository,
  AuditLogRecord,
  BotInstanceRecord,
  BotInstallationRecord,
  BotProfileRecord,
  BotRuntimeLeaseRecord,
  BotTokenSecretRecord,
  BootstrapInstallationInput,
  BootstrapInstallationResult,
  CommandAccessResult,
  CommandPermissionRecord,
  CursorPage,
  DiscordEventReceiptRecord,
  EffectiveBotSettings,
  FeatureFlagRecord,
  GuildMemberListItem,
  GuildRecord,
  JobRunRecord,
  LlmChannelSettingsRecord,
  LlmConversationRecord,
  LlmGenerationRecord,
  LlmInstallationSettingsRecord,
  LlmMessageRecord,
  LlmModerationEventRecord,
  MembershipRecord,
  RuntimeAssignmentRecord,
  RuntimeClaimRecord,
  SessionRecord,
  UserRecord,
} from "./types";
import type {
  BotRuntimeState,
  JobStatus,
  LlmConversationType,
  LlmGenerationStatus,
  LlmMessageRole,
  TenantRole,
} from "../lib/domain";
import type { ReasoningEffort } from "../contracts/llm";

const ROLE_WEIGHT: Record<TenantRole, number> = {
  USER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["P2002", "P2028", "P2034"].includes(String(error.code));
}

function offsetFromCursor(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function cursorFromOffset(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function mapUser(row: any): UserRecord {
  return {
    id: row.id,
    discordUserId: row.discordUserId,
    username: row.username,
    globalName: row.globalName,
    avatarUrl: row.avatarUrl,
    platformRole: row.platformRole,
  };
}

function mapGuild(row: any): GuildRecord {
  return {
    id: row.id,
    discordGuildId: row.discordGuildId,
    name: row.name,
    status: row.status,
    ownerDiscordUserId: row.ownerDiscordUserId,
  };
}

function mapMembership(row: any): MembershipRecord {
  return {
    guildId: row.guildId,
    userId: row.userId,
    tenantRole: row.tenantRole,
    status: row.status,
  };
}

function mapBot(row: any): BotInstanceRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    discordApplicationId: row.discordApplicationId,
    discordBotUserId: row.discordBotUserId,
    discordUsername: row.discordUsername,
    discordAvatarUrl: row.discordAvatarUrl,
    desiredStatus: row.desiredStatus,
    tokenVersion: row.tokenVersion,
    tokenConfigured: Boolean(row.tokenSecret ?? row._count?.tokenSecret),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProfile(row: any): BotProfileRecord {
  return {
    id: row.id,
    botInstanceId: row.botInstanceId,
    defaultModel: row.defaultModel,
    reasoningEffort: row.reasoningEffort,
    assistantPrompt: row.assistantPrompt,
    gatekeeperPrompt: row.gatekeeperPrompt,
    dmEnabled: row.dmEnabled,
    retentionDays: row.retentionDays,
    maxInputChars: row.maxInputChars,
    maxOutputTokens: row.maxOutputTokens,
    settingsVersion: row.settingsVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSecret(row: any): BotTokenSecretRecord {
  return {
    botInstanceId: row.botInstanceId,
    ciphertext: Buffer.from(row.ciphertext),
    nonce: Buffer.from(row.nonce),
    authenticationTag: Buffer.from(row.authenticationTag),
    encryptionKeyVersion: row.encryptionKeyVersion,
    rotatedAt: row.rotatedAt,
  };
}

function mapInstallation(row: any): BotInstallationRecord {
  return {
    id: row.id,
    botInstanceId: row.botInstanceId,
    guildId: row.guildId,
    guildDiscordId: row.guild.discordGuildId,
    guildName: row.guild.name,
    guildStatus: row.guild.status,
    presenceStatus: row.presenceStatus,
    operationalStatus: row.operationalStatus,
    installedAt: row.installedAt,
    leftAt: row.leftAt,
    lastSeenAt: row.lastSeenAt,
    lastCommandManifestHash: row.lastCommandManifestHash,
    lastCommandSyncAt: row.lastCommandSyncAt,
    lastCommandSyncErrorCode: row.lastCommandSyncErrorCode,
  };
}

function mapLease(row: any): BotRuntimeLeaseRecord {
  return {
    botInstanceId: row.botInstanceId,
    runtimeInstanceId: row.runtimeInstanceId,
    claimRequestId: row.claimRequestId,
    leaseGeneration: row.leaseGeneration,
    runtimeState: row.runtimeState,
    expiresAt: row.expiresAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    lastConnectedAt: row.lastConnectedAt,
    lastErrorCode: row.lastErrorCode,
    lastErrorAt: row.lastErrorAt,
    claimedTokenVersion: row.claimedTokenVersion,
    revokedAt: row.revokedAt,
  };
}

function mapInstallationSettings(row: any): LlmInstallationSettingsRecord {
  return {
    id: row.id,
    botInstallationId: row.botInstallationId,
    llmEnabledByGuild: row.llmEnabledByGuild,
    llmEnabledByPlatform: row.llmEnabledByPlatform,
    modelOverride: row.modelOverride,
    reasoningEffortOverride: row.reasoningEffortOverride,
    assistantPromptOverride: row.assistantPromptOverride,
    gatekeeperPromptOverride: row.gatekeeperPromptOverride,
    retentionDaysOverride: row.retentionDaysOverride,
    maxInputCharsOverride: row.maxInputCharsOverride,
    maxOutputTokensOverride: row.maxOutputTokensOverride,
    settingsVersion: row.settingsVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapFeature(row: any): FeatureFlagRecord {
  return {
    id: row.id,
    botInstallationId: row.botInstallationId,
    featureKey: row.featureKey,
    enabled: row.enabled,
    configJson: asObject(row.configJson),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function mapCommand(row: any): CommandPermissionRecord {
  return {
    id: row.id,
    botInstallationId: row.botInstallationId,
    commandKey: row.commandKey,
    minRole: row.minRole,
    allowChannels: asStrings(row.allowChannelsJson),
    denyChannels: asStrings(row.denyChannelsJson),
    updatedAt: row.updatedAt,
  };
}

function mapChannel(row: any): LlmChannelSettingsRecord {
  return {
    id: row.id,
    botInstallationId: row.botInstallationId,
    discordChannelId: row.discordChannelId,
    enabled: row.enabled,
    respondOnMentionOnly: row.respondOnMentionOnly,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapConversation(row: any): LlmConversationRecord {
  return {
    id: row.id,
    botInstanceId: row.botInstanceId,
    botInstallationId: row.botInstallationId,
    discordChannelId: row.discordChannelId,
    discordUserId: row.discordUserId,
    type: row.type,
    summaryText: row.summaryText,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMessage(row: any): LlmMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    tokenCount: row.tokenCount,
    createdAt: row.createdAt,
  };
}

function mapReceipt(row: any): DiscordEventReceiptRecord {
  return {
    id: row.id,
    botInstanceId: row.botInstanceId,
    discordEventId: row.discordEventId,
    eventType: row.eventType,
    leaseGeneration: row.leaseGeneration,
    acquisitionRequestId: row.acquisitionRequestId,
    processingStatus: row.processingStatus,
    attemptCount: row.attemptCount,
    lastErrorCode: row.lastErrorCode,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
  };
}

function mapAudit(row: any): AuditLogRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    botInstanceId: row.botInstanceId,
    botInstallationId: row.botInstallationId,
    actorUserId: row.actorUserId,
    actorType: row.actorType,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.beforeJson as Record<string, unknown> | null,
    after: row.afterJson as Record<string, unknown> | null,
    metadata: asObject(row.metadataJson),
    createdAt: row.createdAt,
  };
}

function mapJob(row: any): JobRunRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    botInstanceId: row.botInstanceId,
    botInstallationId: row.botInstallationId,
    jobType: row.jobType,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    payload: asObject(row.payloadJson),
    result: row.resultJson ? asObject(row.resultJson) : null,
    errorText: row.errorText,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaAppRepository implements AppRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async lockBotInstance(
    tx: Prisma.TransactionClient,
    botInstanceId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM bot_instances WHERE id = ${botInstanceId}::uuid FOR UPDATE`;
  }

  private async resolveInstallation(botInstanceId: string, guildDiscordId: string, client: any = this.prisma): Promise<any> {
    const installation = await client.botInstallation.findFirst({
      where: { botInstanceId, guild: { discordGuildId: guildDiscordId } },
      include: { guild: true },
    });
    if (!installation) {
      throw new ApiError(404, "BOT_NOT_INSTALLED", "The bot is not installed in this guild.");
    }
    return installation;
  }

  async upsertUserFromDiscord(profile: {
    discordUserId: string;
    username: string;
    globalName?: string | null;
    avatarUrl?: string | null;
  }, isPlatformAdmin: boolean): Promise<UserRecord> {
    const row = await this.prisma.user.upsert({
      where: { discordUserId: profile.discordUserId },
      create: {
        id: generateId(),
        discordUserId: profile.discordUserId,
        username: profile.username,
        globalName: profile.globalName,
        avatarUrl: profile.avatarUrl,
        platformRole: isPlatformAdmin ? "PLATFORM_ADMIN" : "NONE",
      },
      update: {
        username: profile.username,
        globalName: profile.globalName,
        avatarUrl: profile.avatarUrl,
        platformRole: isPlatformAdmin ? "PLATFORM_ADMIN" : "NONE",
      },
    });
    return mapUser(row);
  }

  async getUserByDiscordId(discordUserId: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { discordUserId } });
    return row ? mapUser(row) : null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { id: userId } });
    return row ? mapUser(row) : null;
  }

  async getUserMemberships(userId: string): Promise<Array<{ guildId: string; guildName: string; tenantRole: TenantRole }>> {
    const rows = await this.prisma.guildMember.findMany({
      where: { userId, status: "ACTIVE" },
      include: { guild: true },
      orderBy: { guild: { name: "asc" } },
    });
    return rows.map((row) => ({
      guildId: row.guild.discordGuildId,
      guildName: row.guild.name,
      tenantRole: row.tenantRole as TenantRole,
    }));
  }

  async getGuildByDiscordId(guildDiscordId: string): Promise<GuildRecord | null> {
    const row = await this.prisma.guild.findUnique({ where: { discordGuildId: guildDiscordId } });
    return row ? mapGuild(row) : null;
  }

  async ensureGuildMembership(guildDiscordId: string, userId: string): Promise<{ guild: GuildRecord; membership: MembershipRecord } | null> {
    const row = await this.prisma.guildMember.findFirst({
      where: { userId, guild: { discordGuildId: guildDiscordId }, status: "ACTIVE" },
      include: { guild: true },
    });
    return row ? { guild: mapGuild(row.guild), membership: mapMembership(row) } : null;
  }

  async upsertGuildMembership(guildDiscordId: string, userId: string): Promise<{ guild: GuildRecord; membership: MembershipRecord; created: boolean } | null> {
    const guild = await this.prisma.guild.findUnique({ where: { discordGuildId: guildDiscordId } });
    if (!guild) return null;
    const existing = await this.prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId: guild.id, userId } },
    });
    const membership = await this.prisma.guildMember.upsert({
      where: { guildId_userId: { guildId: guild.id, userId } },
      create: { guildId: guild.id, userId, tenantRole: "USER", status: "ACTIVE", joinedAt: new Date() },
      update: { status: "ACTIVE", lastSeenAt: new Date() },
    });
    return { guild: mapGuild(guild), membership: mapMembership(membership), created: !existing };
  }

  async getMembershipByDiscordUser(guildDiscordId: string, discordUserId: string): Promise<MembershipRecord | null> {
    const row = await this.prisma.guildMember.findFirst({
      where: { guild: { discordGuildId: guildDiscordId }, user: { discordUserId } },
    });
    return row ? mapMembership(row) : null;
  }

  async listGuildMembers(guildDiscordId: string, limit: number, cursor?: string): Promise<CursorPage<GuildMemberListItem>> {
    const offset = offsetFromCursor(cursor);
    const rows = await this.prisma.guildMember.findMany({
      where: { guild: { discordGuildId: guildDiscordId } },
      include: { user: true },
      orderBy: [{ tenantRole: "asc" }, { createdAt: "asc" }],
      skip: offset,
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    return {
      items: rows.slice(0, limit).map((row) => ({
        userId: row.userId,
        discordUserId: row.user.discordUserId,
        username: row.user.username,
        tenantRole: row.tenantRole as TenantRole,
        status: row.status,
      })),
      nextCursor: hasMore ? cursorFromOffset(offset + limit) : undefined,
    };
  }

  async listGuildAdministrators(guildDiscordId: string): Promise<GuildMemberListItem[]> {
    const rows = await this.prisma.guildMember.findMany({
      where: {
        guild: { discordGuildId: guildDiscordId },
        status: "ACTIVE",
        tenantRole: { in: ["OWNER", "ADMIN"] },
      },
      include: { user: true },
      orderBy: [{ tenantRole: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((row) => ({
      userId: row.userId,
      discordUserId: row.user.discordUserId,
      username: row.user.username,
      tenantRole: row.tenantRole as TenantRole,
      status: row.status,
    }));
  }

  async updateGuildMemberRole(input: { guildDiscordId: string; targetUserId: string; role: TenantRole }): Promise<{ guild: GuildRecord; before: MembershipRecord; after: MembershipRecord } | null> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const row = await tx.guildMember.findFirst({
            where: { userId: input.targetUserId, guild: { discordGuildId: input.guildDiscordId } },
            include: { guild: true },
          });
          if (!row) return null;
          if (row.tenantRole === "OWNER" && input.role !== "OWNER") {
            const owners = await tx.guildMember.count({
              where: { guildId: row.guildId, tenantRole: "OWNER", status: "ACTIVE" },
            });
            if (owners <= 1) {
              throw new ApiError(409, "LAST_OWNER_PROTECTED", "The last guild owner cannot be demoted.");
            }
          }
          const updated = await tx.guildMember.update({
            where: { guildId_userId: { guildId: row.guildId, userId: row.userId } },
            data: { tenantRole: input.role, status: "ACTIVE" },
          });
          return { guild: mapGuild(row.guild), before: mapMembership(row), after: mapMembership(updated) };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt >= 2 || !isRetryableTransactionError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }

  async createBot(input: { slug: string; displayName: string; discordApplicationId: string; defaultModel: string }): Promise<{ bot: BotInstanceRecord; profile: BotProfileRecord }> {
    return this.prisma.$transaction(async (tx) => {
      const bot = await tx.botInstance.create({
        data: {
          id: generateId(),
          slug: input.slug,
          displayName: input.displayName,
          discordApplicationId: input.discordApplicationId,
        },
      });
      const profile = await tx.botProfile.create({
        data: {
          id: generateId(),
          botInstanceId: bot.id,
          defaultModel: input.defaultModel,
        },
      });
      await tx.botRuntimeLease.create({
        data: { id: generateId(), botInstanceId: bot.id },
      });
      return { bot: mapBot({ ...bot, tokenSecret: null }), profile: mapProfile(profile) };
    });
  }

  async getBot(botInstanceId: string): Promise<BotInstanceRecord | null> {
    const row = await this.prisma.botInstance.findUnique({
      where: { id: botInstanceId },
      include: { tokenSecret: { select: { id: true } } },
    });
    return row ? mapBot(row) : null;
  }

  async listBots(input: { limit: number; cursor?: string; search?: string }): Promise<CursorPage<BotInstanceRecord>> {
    const offset = offsetFromCursor(input.cursor);
    const search = input.search?.trim();
    const rows = await this.prisma.botInstance.findMany({
      where: search ? {
        OR: [
          { slug: { contains: search, mode: "insensitive" } },
          { displayName: { contains: search, mode: "insensitive" } },
          { discordApplicationId: { contains: search } },
        ],
      } : undefined,
      include: { tokenSecret: { select: { id: true } } },
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    return {
      items: rows.slice(0, input.limit).map(mapBot),
      nextCursor: hasMore ? cursorFromOffset(offset + input.limit) : undefined,
    };
  }

  async updateBot(input: { botInstanceId: string; displayName?: string; desiredStatus?: "DRAFT" | "ACTIVE" | "DISABLED" }): Promise<BotInstanceRecord> {
    if (input.desiredStatus === "ACTIVE") {
      return this.prisma.$transaction(async (tx) => {
        await this.lockBotInstance(tx, input.botInstanceId);
        const current = await tx.botInstance.findUnique({
          where: { id: input.botInstanceId },
          include: { tokenSecret: { select: { id: true } } },
        });
        if (!current) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
        if (!current.tokenSecret) {
          throw new ApiError(409, "BOT_TOKEN_NOT_CONFIGURED", "Configure a token before activating the bot.");
        }
        const updated = await tx.botInstance.update({
          where: { id: input.botInstanceId },
          data: { displayName: input.displayName, desiredStatus: "ACTIVE" },
          include: { tokenSecret: { select: { id: true } } },
        });
        return mapBot(updated);
      });
    }

    const current = await this.prisma.botInstance.findUnique({
      where: { id: input.botInstanceId },
    });
    if (!current) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
    const row = await this.prisma.botInstance.update({
      where: { id: input.botInstanceId },
      data: { displayName: input.displayName, desiredStatus: input.desiredStatus },
      include: { tokenSecret: { select: { id: true } } },
    });
    if (input.desiredStatus) {
      await this.revokeRuntimeLease(input.botInstanceId, new Date());
    }
    return mapBot(row);
  }

  async updateObservedBotIdentity(input: { botInstanceId: string; discordApplicationId: string; discordBotUserId: string; discordUsername: string; discordAvatarUrl?: string | null }): Promise<BotInstanceRecord> {
    const current = await this.getBot(input.botInstanceId);
    if (!current) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
    if (current.discordApplicationId !== input.discordApplicationId) {
      throw new ApiError(409, "BOT_SCOPE_MISMATCH", "Discord application identity does not match the configured bot.");
    }
    const row = await this.prisma.botInstance.update({
      where: { id: input.botInstanceId },
      data: {
        discordBotUserId: input.discordBotUserId,
        discordUsername: input.discordUsername,
        discordAvatarUrl: input.discordAvatarUrl,
      },
      include: { tokenSecret: { select: { id: true } } },
    });
    return mapBot(row);
  }

  async getBotProfile(botInstanceId: string): Promise<BotProfileRecord | null> {
    const row = await this.prisma.botProfile.findUnique({ where: { botInstanceId } });
    return row ? mapProfile(row) : null;
  }

  async updateBotProfile(input: { botInstanceId: string; defaultModel?: string; reasoningEffort?: ReasoningEffort; assistantPrompt?: string | null; gatekeeperPrompt?: string | null; dmEnabled?: boolean; retentionDays?: number; maxInputChars?: number; maxOutputTokens?: number }): Promise<BotProfileRecord> {
    const row = await this.prisma.botProfile.update({
      where: { botInstanceId: input.botInstanceId },
      data: {
        defaultModel: input.defaultModel,
        reasoningEffort: input.reasoningEffort,
        assistantPrompt: input.assistantPrompt,
        gatekeeperPrompt: input.gatekeeperPrompt,
        dmEnabled: input.dmEnabled,
        retentionDays: input.retentionDays,
        maxInputChars: input.maxInputChars,
        maxOutputTokens: input.maxOutputTokens,
        settingsVersion: { increment: 1 },
      },
    });
    return mapProfile(row);
  }

  async getBotTokenSecret(botInstanceId: string): Promise<BotTokenSecretRecord | null> {
    const row = await this.prisma.botTokenSecret.findUnique({ where: { botInstanceId } });
    return row ? mapSecret(row) : null;
  }

  async configureBotToken(input: BotTokenSecretRecord & { rotatedByUserId?: string }): Promise<BotInstanceRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBotInstance(tx, input.botInstanceId);
      const bot = await tx.botInstance.findUnique({ where: { id: input.botInstanceId } });
      if (!bot) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      await tx.botTokenSecret.upsert({
        where: { botInstanceId: input.botInstanceId },
        create: {
          id: generateId(),
          botInstanceId: input.botInstanceId,
          ciphertext: toBytes(input.ciphertext),
          nonce: toBytes(input.nonce),
          authenticationTag: toBytes(input.authenticationTag),
          encryptionKeyVersion: input.encryptionKeyVersion,
          rotatedAt: input.rotatedAt,
          rotatedByUserId: input.rotatedByUserId,
        },
        update: {
          ciphertext: toBytes(input.ciphertext),
          nonce: toBytes(input.nonce),
          authenticationTag: toBytes(input.authenticationTag),
          encryptionKeyVersion: input.encryptionKeyVersion,
          rotatedAt: input.rotatedAt,
          rotatedByUserId: input.rotatedByUserId,
        },
      });
      await tx.botRuntimeLease.update({
        where: { botInstanceId: input.botInstanceId },
        data: {
          revokedAt: new Date(),
          runtimeState: "STOPPED",
        },
      });
      const updated = await tx.botInstance.update({
        where: { id: input.botInstanceId },
        data: { tokenVersion: { increment: 1 } },
        include: { tokenSecret: { select: { id: true } } },
      });
      return mapBot(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async deleteBotToken(botInstanceId: string): Promise<BotInstanceRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBotInstance(tx, botInstanceId);
      await tx.botTokenSecret.deleteMany({ where: { botInstanceId } });
      await tx.botRuntimeLease.update({
        where: { botInstanceId },
        data: {
          revokedAt: new Date(),
          runtimeState: "STOPPED",
          runtimeInstanceId: null,
          claimRequestId: null,
          leaseTokenHash: null,
          claimedTokenVersion: null,
        },
      });
      const updated = await tx.botInstance.update({
        where: { id: botInstanceId },
        data: { tokenVersion: { increment: 1 }, desiredStatus: "DRAFT" },
        include: { tokenSecret: { select: { id: true } } },
      });
      return mapBot(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async bootstrapInstallation(
    input: BootstrapInstallationInput,
  ): Promise<BootstrapInstallationResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
      const existingGuild = await tx.guild.findUnique({ where: { discordGuildId: input.guildDiscordId } });
      const guild = await tx.guild.upsert({
        where: { discordGuildId: input.guildDiscordId },
        create: {
          id: generateId(),
          discordGuildId: input.guildDiscordId,
          name: input.guildName,
          ownerDiscordUserId: input.ownerProfile?.discordUserId,
        },
        update: {
          name: input.guildName,
          ownerDiscordUserId: input.ownerProfile?.discordUserId,
        },
      });
      const existingInstallation = await tx.botInstallation.findUnique({
        where: { botInstanceId_guildId: { botInstanceId: input.botInstanceId, guildId: guild.id } },
      });
      const installation = await tx.botInstallation.upsert({
        where: { botInstanceId_guildId: { botInstanceId: input.botInstanceId, guildId: guild.id } },
        create: { id: generateId(), botInstanceId: input.botInstanceId, guildId: guild.id },
        update: { presenceStatus: "PRESENT", leftAt: null, lastSeenAt: new Date() },
        include: { guild: true },
      });
      await tx.llmInstallationSetting.upsert({
        where: { botInstallationId: installation.id },
        create: { id: generateId(), botInstallationId: installation.id },
        update: {},
      });
      for (const feature of DEFAULT_FEATURE_FLAGS) {
        await tx.featureFlag.upsert({
          where: { botInstallationId_featureKey: { botInstallationId: installation.id, featureKey: feature.featureKey } },
          create: {
            id: generateId(),
            botInstallationId: installation.id,
            featureKey: feature.featureKey,
            enabled: feature.enabled,
            configJson: feature.configJson as Prisma.InputJsonValue,
          },
          update: {},
        });
      }
      for (const command of DEFAULT_COMMAND_POLICIES) {
        await tx.commandPermission.upsert({
          where: { botInstallationId_commandKey: { botInstallationId: installation.id, commandKey: command.commandKey } },
          create: {
            id: generateId(),
            botInstallationId: installation.id,
            commandKey: command.commandKey,
            minRole: command.minRole,
            allowChannelsJson: command.allowChannels,
            denyChannelsJson: command.denyChannels,
          },
          update: {},
        });
      }

      let ownerMembershipCreated = false;
      if (input.ownerProfile) {
        const owner = await tx.user.upsert({
          where: { discordUserId: input.ownerProfile.discordUserId },
          create: { id: generateId(), ...input.ownerProfile },
          update: {
            username: input.ownerProfile.username,
            globalName: input.ownerProfile.globalName,
            avatarUrl: input.ownerProfile.avatarUrl,
          },
        });
        const previousMembership = await tx.guildMember.findUnique({
          where: { guildId_userId: { guildId: guild.id, userId: owner.id } },
        });
        await tx.guildMember.upsert({
          where: { guildId_userId: { guildId: guild.id, userId: owner.id } },
          create: {
            guildId: guild.id,
            userId: owner.id,
            tenantRole: "OWNER",
            status: "ACTIVE",
            joinedAt: new Date(),
          },
          update: { tenantRole: "OWNER", status: "ACTIVE", lastSeenAt: new Date() },
        });
        ownerMembershipCreated = !previousMembership;
        if (
          existingGuild?.ownerDiscordUserId
          && existingGuild.ownerDiscordUserId !== input.ownerProfile.discordUserId
        ) {
          await tx.guildMember.updateMany({
            where: {
              guildId: guild.id,
              tenantRole: "OWNER",
              user: { discordUserId: existingGuild.ownerDiscordUserId },
            },
            data: { tenantRole: "USER" },
          });
          await tx.auditLog.create({
            data: {
              id: generateId(),
              guildId: guild.id,
              botInstanceId: input.botInstanceId,
              botInstallationId: installation.id,
              actorType: "SYSTEM",
              action: "guild.owner.transferred",
              entityType: "guild",
              entityId: guild.id,
              beforeJson: {
                ownerDiscordUserId: existingGuild.ownerDiscordUserId,
              },
              afterJson: {
                ownerDiscordUserId: input.ownerProfile.discordUserId,
              },
              metadataJson: {},
            },
          });
        }
      }

      let installerMembershipCreated = false;
      let installerAdminGranted = false;
      if (input.installerProfile && input.installerAuditLogEntryId) {
        const installer = await tx.user.upsert({
          where: { discordUserId: input.installerProfile.discordUserId },
          create: { id: generateId(), ...input.installerProfile },
          update: {
            username: input.installerProfile.username,
            globalName: input.installerProfile.globalName,
            avatarUrl: input.installerProfile.avatarUrl,
          },
        });
        const existingGrant = await tx.auditLog.findFirst({
          where: {
            botInstanceId: input.botInstanceId,
            botInstallationId: installation.id,
            action: "guild.installer.access_granted",
            entityId: input.installerAuditLogEntryId,
          },
          select: { id: true },
        });

        if (!existingGrant) {
          const previousMembership = await tx.guildMember.findUnique({
            where: { guildId_userId: { guildId: guild.id, userId: installer.id } },
          });
          const installerRole = previousMembership?.tenantRole === "OWNER"
            ? "OWNER"
            : "ADMIN";
          await tx.guildMember.upsert({
            where: { guildId_userId: { guildId: guild.id, userId: installer.id } },
            create: {
              guildId: guild.id,
              userId: installer.id,
              tenantRole: installerRole,
              status: "ACTIVE",
              joinedAt: new Date(),
            },
            update: {
              tenantRole: installerRole,
              status: "ACTIVE",
              lastSeenAt: new Date(),
            },
          });
          installerMembershipCreated = !previousMembership;
          installerAdminGranted = installerRole === "ADMIN";
          await tx.auditLog.create({
            data: {
              id: generateId(),
              guildId: guild.id,
              botInstanceId: input.botInstanceId,
              botInstallationId: installation.id,
              actorUserId: installer.id,
              actorType: "USER",
              action: "guild.installer.access_granted",
              entityType: "discord_audit_log_entry",
              entityId: input.installerAuditLogEntryId,
              beforeJson: previousMembership
                ? {
                    tenantRole: previousMembership.tenantRole,
                    status: previousMembership.status,
                  }
                : Prisma.JsonNull,
              afterJson: {
                discordUserId: input.installerProfile.discordUserId,
                tenantRole: installerRole,
                status: "ACTIVE",
              },
              metadataJson: {
                source: "DISCORD_BOT_ADD",
              },
            },
          });
        }
      }

      return {
        guild: mapGuild(guild),
        installation: mapInstallation(installation),
        guildCreated: !existingGuild,
        installationCreated: !existingInstallation,
        ownerMembershipCreated,
        ownerChanged: Boolean(
          input.ownerProfile
          && existingGuild?.ownerDiscordUserId
          && existingGuild.ownerDiscordUserId !== input.ownerProfile.discordUserId,
        ),
        previousOwnerDiscordUserId: existingGuild?.ownerDiscordUserId ?? null,
        ownerDiscordUserId: input.ownerProfile?.discordUserId ?? existingGuild?.ownerDiscordUserId ?? null,
        installerMembershipCreated,
        installerAdminGranted,
        installerDiscordUserId: input.installerProfile?.discordUserId ?? null,
      };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt >= 2 || !isRetryableTransactionError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }

  async markInstallationLeft(input: { botInstanceId: string; guildDiscordId: string }): Promise<BotInstallationRecord | null> {
    const installation = await this.prisma.botInstallation.findFirst({
      where: { botInstanceId: input.botInstanceId, guild: { discordGuildId: input.guildDiscordId } },
    });
    if (!installation) return null;
    const row = await this.prisma.botInstallation.update({
      where: { id: installation.id },
      data: { presenceStatus: "LEFT", leftAt: new Date() },
      include: { guild: true },
    });
    return mapInstallation(row);
  }

  async reconcileInstallationPresence(input: {
    botInstanceId: string;
    observedGuildDiscordIds: string[];
    now: Date;
  }): Promise<number> {
    const result = await this.prisma.botInstallation.updateMany({
      where: {
        botInstanceId: input.botInstanceId,
        presenceStatus: "PRESENT",
        guild: {
          discordGuildId: { notIn: input.observedGuildDiscordIds },
        },
      },
      data: {
        presenceStatus: "LEFT",
        leftAt: input.now,
      },
    });
    return result.count;
  }

  async getInstallation(botInstanceId: string, guildDiscordId: string): Promise<BotInstallationRecord | null> {
    const row = await this.prisma.botInstallation.findFirst({
      where: { botInstanceId, guild: { discordGuildId: guildDiscordId } },
      include: { guild: true },
    });
    return row ? mapInstallation(row) : null;
  }

  async getInstallationById(botInstanceId: string, installationId: string): Promise<BotInstallationRecord | null> {
    const row = await this.prisma.botInstallation.findFirst({
      where: { id: installationId, botInstanceId },
      include: { guild: true },
    });
    return row ? mapInstallation(row) : null;
  }

  async listBotInstallations(botInstanceId: string): Promise<BotInstallationRecord[]> {
    const rows = await this.prisma.botInstallation.findMany({
      where: { botInstanceId },
      include: { guild: true },
      orderBy: { installedAt: "asc" },
    });
    return rows.map(mapInstallation);
  }

  async listPendingCommandSyncs(botInstanceId: string): Promise<BotInstallationRecord[]> {
    const rows = await this.prisma.botInstallation.findMany({
      where: {
        botInstanceId,
        presenceStatus: "PRESENT",
        OR: [
          { lastCommandManifestHash: null },
          { lastCommandSyncErrorCode: { not: null } },
        ],
      },
      include: { guild: true },
      orderBy: [
        { updatedAt: "asc" },
        { installedAt: "asc" },
      ],
      take: 25,
    });
    return rows.map(mapInstallation);
  }

  async listGuildBots(guildDiscordId: string): Promise<Array<{ bot: BotInstanceRecord; installation: BotInstallationRecord }>> {
    const rows = await this.prisma.botInstallation.findMany({
      where: { guild: { discordGuildId: guildDiscordId } },
      include: { guild: true, botInstance: { include: { tokenSecret: { select: { id: true } } } } },
      orderBy: { botInstance: { displayName: "asc" } },
    });
    return rows.map((row) => ({ bot: mapBot(row.botInstance), installation: mapInstallation(row) }));
  }

  async updateInstallationOperationalStatus(input: { botInstanceId: string; guildDiscordId: string; operationalStatus: "ENABLED" | "DISABLED" }): Promise<BotInstallationRecord> {
    const installation = await this.resolveInstallation(input.botInstanceId, input.guildDiscordId);
    const row = await this.prisma.botInstallation.update({
      where: { id: installation.id },
      data: { operationalStatus: input.operationalStatus },
      include: { guild: true },
    });
    return mapInstallation(row);
  }

  async updateCommandManifest(input: { botInstanceId: string; guildDiscordId: string; hash?: string | null; errorCode?: string | null; syncedAt?: Date | null }): Promise<BotInstallationRecord> {
    const installation = await this.resolveInstallation(input.botInstanceId, input.guildDiscordId);
    const row = await this.prisma.botInstallation.update({
      where: { id: installation.id },
      data: {
        lastCommandManifestHash: input.hash,
        lastCommandSyncErrorCode: input.errorCode,
        lastCommandSyncAt: input.syncedAt,
      },
      include: { guild: true },
    });
    return mapInstallation(row);
  }

  async requestCommandResync(
    botInstanceId: string,
    installationId: string,
  ): Promise<BotInstallationRecord> {
    const row = await this.prisma.botInstallation.update({
      where: {
        id_botInstanceId: {
          id: installationId,
          botInstanceId,
        },
      },
      data: {
        lastCommandManifestHash: null,
        lastCommandSyncErrorCode: null,
      },
      include: { guild: true },
    });
    return mapInstallation(row);
  }

  async getInstallationSettings(botInstanceId: string, guildDiscordId: string): Promise<{ installation: BotInstallationRecord; settings: LlmInstallationSettingsRecord; profile: BotProfileRecord }> {
    const installation = await this.resolveInstallation(botInstanceId, guildDiscordId);
    const [settings, profile] = await Promise.all([
      this.prisma.llmInstallationSetting.findUnique({ where: { botInstallationId: installation.id } }),
      this.prisma.botProfile.findUnique({ where: { botInstanceId } }),
    ]);
    if (!settings || !profile) throw new ApiError(404, "BOT_NOT_FOUND", "Bot settings were not found.");
    return {
      installation: mapInstallation(installation),
      settings: mapInstallationSettings(settings),
      profile: mapProfile(profile),
    };
  }

  async updateInstallationSettings(input: {
    botInstanceId: string;
    guildDiscordId: string;
    llmEnabledByGuild?: boolean;
    llmEnabledByPlatform?: boolean;
    modelOverride?: string | null;
    reasoningEffortOverride?: ReasoningEffort | null;
    assistantPromptOverride?: string | null;
    gatekeeperPromptOverride?: string | null;
    retentionDaysOverride?: number | null;
    maxInputCharsOverride?: number | null;
    maxOutputTokensOverride?: number | null;
  }): Promise<LlmInstallationSettingsRecord> {
    const installation = await this.resolveInstallation(input.botInstanceId, input.guildDiscordId);
    const row = await this.prisma.llmInstallationSetting.update({
      where: { botInstallationId: installation.id },
      data: {
        llmEnabledByGuild: input.llmEnabledByGuild,
        llmEnabledByPlatform: input.llmEnabledByPlatform,
        modelOverride: input.modelOverride,
        reasoningEffortOverride: input.reasoningEffortOverride,
        assistantPromptOverride: input.assistantPromptOverride,
        gatekeeperPromptOverride: input.gatekeeperPromptOverride,
        retentionDaysOverride: input.retentionDaysOverride,
        maxInputCharsOverride: input.maxInputCharsOverride,
        maxOutputTokensOverride: input.maxOutputTokensOverride,
        settingsVersion: { increment: 1 },
      },
    });
    return mapInstallationSettings(row);
  }

  async getEffectiveBotSettings(input: { botInstanceId: string; guildDiscordId?: string }): Promise<EffectiveBotSettings> {
    const [bot, profile] = await Promise.all([
      this.getBot(input.botInstanceId),
      this.getBotProfile(input.botInstanceId),
    ]);
    if (!bot || !profile) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
    if (!input.guildDiscordId) {
      return {
        bot,
        profile,
        model: profile.defaultModel,
        reasoningEffort: profile.reasoningEffort,
        assistantPrompt: profile.assistantPrompt,
        gatekeeperPrompt: profile.gatekeeperPrompt,
        retentionDays: profile.retentionDays,
        maxInputChars: profile.maxInputChars,
        maxOutputTokens: profile.maxOutputTokens,
        dmEnabled: profile.dmEnabled,
      };
    }
    const scoped = await this.getInstallationSettings(input.botInstanceId, input.guildDiscordId);
    const settings = scoped.settings;
    return {
      bot,
      profile,
      installation: scoped.installation,
      installationSettings: settings,
      model: settings.modelOverride ?? profile.defaultModel,
      reasoningEffort: settings.reasoningEffortOverride ?? profile.reasoningEffort,
      assistantPrompt: settings.assistantPromptOverride ?? profile.assistantPrompt,
      gatekeeperPrompt: settings.gatekeeperPromptOverride ?? profile.gatekeeperPrompt,
      retentionDays: settings.retentionDaysOverride ?? profile.retentionDays,
      maxInputChars: settings.maxInputCharsOverride ?? profile.maxInputChars,
      maxOutputTokens: settings.maxOutputTokensOverride ?? profile.maxOutputTokens,
      dmEnabled: profile.dmEnabled,
    };
  }

  async getFeatureFlag(botInstanceId: string, guildDiscordId: string, featureKey: string): Promise<FeatureFlagRecord | null> {
    const installation = await this.getInstallation(botInstanceId, guildDiscordId);
    if (!installation) return null;
    const row = await this.prisma.featureFlag.findUnique({
      where: { botInstallationId_featureKey: { botInstallationId: installation.id, featureKey } },
    });
    return row ? mapFeature(row) : null;
  }

  async listFeatureFlags(botInstanceId: string, guildDiscordId: string): Promise<FeatureFlagRecord[]> {
    const installation = await this.resolveInstallation(botInstanceId, guildDiscordId);
    const rows = await this.prisma.featureFlag.findMany({
      where: { botInstallationId: installation.id },
      orderBy: { featureKey: "asc" },
    });
    return rows.map(mapFeature);
  }

  async upsertFeatureFlag(input: { botInstanceId: string; guildDiscordId: string; featureKey: string; enabled: boolean; configJson: Record<string, unknown>; expectedVersion?: number }): Promise<{ previous?: FeatureFlagRecord; current: FeatureFlagRecord }> {
    const installation = await this.resolveInstallation(input.botInstanceId, input.guildDiscordId);
    const existing = await this.prisma.featureFlag.findUnique({
      where: { botInstallationId_featureKey: { botInstallationId: installation.id, featureKey: input.featureKey } },
    });
    if (existing && input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw new ApiError(409, "VERSION_CONFLICT", "Feature flag version does not match.");
    }
    const row = await this.prisma.featureFlag.upsert({
      where: { botInstallationId_featureKey: { botInstallationId: installation.id, featureKey: input.featureKey } },
      create: {
        id: generateId(),
        botInstallationId: installation.id,
        featureKey: input.featureKey,
        enabled: input.enabled,
        configJson: input.configJson as Prisma.InputJsonValue,
      },
      update: {
        enabled: input.enabled,
        configJson: input.configJson as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    return { previous: existing ? mapFeature(existing) : undefined, current: mapFeature(row) };
  }

  async getCommandPermission(botInstanceId: string, guildDiscordId: string, commandKey: string): Promise<CommandPermissionRecord | null> {
    const installation = await this.getInstallation(botInstanceId, guildDiscordId);
    if (!installation) return null;
    const row = await this.prisma.commandPermission.findUnique({
      where: { botInstallationId_commandKey: { botInstallationId: installation.id, commandKey } },
    });
    return row ? mapCommand(row) : null;
  }

  async listCommandPermissions(botInstanceId: string, guildDiscordId: string): Promise<CommandPermissionRecord[]> {
    const installation = await this.resolveInstallation(botInstanceId, guildDiscordId);
    const rows = await this.prisma.commandPermission.findMany({
      where: { botInstallationId: installation.id },
      orderBy: { commandKey: "asc" },
    });
    return rows.map(mapCommand);
  }

  async upsertCommandPermission(input: { botInstanceId: string; guildDiscordId: string; commandKey: string; minRole: TenantRole; allowChannels: string[]; denyChannels: string[] }): Promise<{ previous?: CommandPermissionRecord; current: CommandPermissionRecord }> {
    const installation = await this.resolveInstallation(input.botInstanceId, input.guildDiscordId);
    const existing = await this.prisma.commandPermission.findUnique({
      where: { botInstallationId_commandKey: { botInstallationId: installation.id, commandKey: input.commandKey } },
    });
    const row = await this.prisma.commandPermission.upsert({
      where: { botInstallationId_commandKey: { botInstallationId: installation.id, commandKey: input.commandKey } },
      create: {
        id: generateId(),
        botInstallationId: installation.id,
        commandKey: input.commandKey,
        minRole: input.minRole,
        allowChannelsJson: input.allowChannels,
        denyChannelsJson: input.denyChannels,
      },
      update: {
        minRole: input.minRole,
        allowChannelsJson: input.allowChannels,
        denyChannelsJson: input.denyChannels,
      },
    });
    return { previous: existing ? mapCommand(existing) : undefined, current: mapCommand(row) };
  }

  async checkCommandAccess(input: { botInstanceId: string; guildDiscordId: string; commandKey: string; actorDiscordUserId: string; channelId?: string; defaultMinRole: TenantRole }): Promise<CommandAccessResult> {
    const installation = await this.resolveInstallation(input.botInstanceId, input.guildDiscordId);
    const [policyRow, user] = await Promise.all([
      this.prisma.commandPermission.findUnique({
        where: { botInstallationId_commandKey: { botInstallationId: installation.id, commandKey: input.commandKey } },
      }),
      this.prisma.user.findUnique({ where: { discordUserId: input.actorDiscordUserId } }),
    ]);
    const policy: CommandPermissionRecord = policyRow ? mapCommand(policyRow) : {
      id: "",
      botInstallationId: installation.id,
      commandKey: input.commandKey,
      minRole: input.defaultMinRole,
      allowChannels: [],
      denyChannels: [],
      updatedAt: new Date(0),
    };
    const base = { guild: mapGuild(installation.guild), installation: mapInstallation(installation), policy };
    if (!user) return { ...base, allowed: false, reason: "NO_USER" };
    const membership = await this.prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId: installation.guildId, userId: user.id } },
    });
    if (!membership || membership.status !== "ACTIVE") {
      return { ...base, allowed: false, reason: "NO_MEMBERSHIP" };
    }
    const actor = { userId: user.id, tenantRole: membership.tenantRole as TenantRole, platformRole: user.platformRole };
    if (ROLE_WEIGHT[membership.tenantRole as TenantRole] < ROLE_WEIGHT[policy.minRole]) {
      return { ...base, actor, allowed: false, reason: "ROLE_TOO_LOW" };
    }
    if (input.channelId && policy.denyChannels.includes(input.channelId)) {
      return { ...base, actor, allowed: false, reason: "CHANNEL_DENIED" };
    }
    if (input.channelId && policy.allowChannels.length > 0 && !policy.allowChannels.includes(input.channelId)) {
      return { ...base, actor, allowed: false, reason: "CHANNEL_NOT_ALLOWED" };
    }
    return { ...base, actor, allowed: true };
  }

  async getLlmChannelSettings(botInstanceId: string, guildDiscordId: string, channelId: string): Promise<LlmChannelSettingsRecord | null> {
    const installation = await this.getInstallation(botInstanceId, guildDiscordId);
    if (!installation) return null;
    const row = await this.prisma.llmChannelSetting.findUnique({
      where: { botInstallationId_discordChannelId: { botInstallationId: installation.id, discordChannelId: channelId } },
    });
    return row ? mapChannel(row) : null;
  }

  async listLlmChannelSettings(botInstanceId: string, guildDiscordId: string): Promise<LlmChannelSettingsRecord[]> {
    const installation = await this.resolveInstallation(botInstanceId, guildDiscordId);
    const rows = await this.prisma.llmChannelSetting.findMany({
      where: { botInstallationId: installation.id },
      orderBy: [{ enabled: "desc" }, { discordChannelId: "asc" }],
    });
    return rows.map(mapChannel);
  }

  async upsertLlmChannelSettings(input: { botInstanceId: string; guildDiscordId: string; channelId: string; enabled: boolean; respondOnMentionOnly?: boolean }): Promise<LlmChannelSettingsRecord> {
    const installation = await this.resolveInstallation(input.botInstanceId, input.guildDiscordId);
    const row = await this.prisma.llmChannelSetting.upsert({
      where: { botInstallationId_discordChannelId: { botInstallationId: installation.id, discordChannelId: input.channelId } },
      create: {
        id: generateId(),
        botInstallationId: installation.id,
        discordChannelId: input.channelId,
        enabled: input.enabled,
        respondOnMentionOnly: input.respondOnMentionOnly ?? false,
      },
      update: { enabled: input.enabled, respondOnMentionOnly: input.respondOnMentionOnly },
    });
    return mapChannel(row);
  }

  async clearLlmChannelMemory(botInstanceId: string, guildDiscordId: string, channelId: string): Promise<{ deletedMessages: number; deletedConversations: number }> {
    const installation = await this.resolveInstallation(botInstanceId, guildDiscordId);
    const conversations = await this.prisma.llmConversation.findMany({
      where: { botInstallationId: installation.id, discordChannelId: channelId, type: "GUILD_CHANNEL" },
      select: { id: true },
    });
    const ids = conversations.map((row) => row.id);
    if (ids.length === 0) return { deletedMessages: 0, deletedConversations: 0 };
    const deletedMessages = await this.prisma.llmMessage.count({ where: { conversationId: { in: ids } } });
    const deletedConversations = await this.prisma.llmConversation.deleteMany({ where: { id: { in: ids } } });
    return { deletedMessages, deletedConversations: deletedConversations.count };
  }

  async listRuntimeAssignments(_now: Date): Promise<RuntimeAssignmentRecord[]> {
    const rows = await this.prisma.botInstance.findMany({
      where: { desiredStatus: "ACTIVE", tokenSecret: { isNot: null } },
      include: { tokenSecret: { select: { id: true } }, runtimeLease: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ bot: mapBot(row), lease: mapLease(row.runtimeLease) }));
  }

  async getRuntimeLease(botInstanceId: string): Promise<BotRuntimeLeaseRecord | null> {
    const row = await this.prisma.botRuntimeLease.findUnique({ where: { botInstanceId } });
    return row ? mapLease(row) : null;
  }

  async claimRuntime(input: { botInstanceId: string; runtimeInstanceId: string; claimRequestId: string; leaseToken: string; leaseTokenHash: string; now: Date; expiresAt: Date }): Promise<RuntimeClaimRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBotInstance(tx, input.botInstanceId);
      const bot = await tx.botInstance.findUnique({
        where: { id: input.botInstanceId },
        include: { tokenSecret: true, profile: true, runtimeLease: true },
      });
      if (!bot) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      if (bot.desiredStatus !== "ACTIVE") throw new ApiError(409, "BOT_DISABLED", "Bot is not active.");
      if (!bot.tokenSecret) throw new ApiError(409, "BOT_TOKEN_NOT_CONFIGURED", "Bot token is not configured.");
      if (!bot.profile || !bot.runtimeLease) throw new ApiError(409, "BOT_NOT_READY", "Bot records are incomplete.");

      const lease = bot.runtimeLease;
      const withinLeaseWindow = Boolean(
        lease.expiresAt
        && lease.expiresAt > input.now,
      );
      if (lease.revokedAt && withinLeaseWindow) {
        throw new ApiError(
          409,
          "BOT_LEASE_CONFLICT",
          "The revoked runtime is still within its fencing window.",
        );
      }
      const active = Boolean(
        lease.runtimeInstanceId
        && !lease.revokedAt
        && withinLeaseWindow,
      );
      let generation = lease.leaseGeneration;
      if (active) {
        if (lease.runtimeInstanceId !== input.runtimeInstanceId) {
          throw new ApiError(409, "BOT_LEASE_CONFLICT", "Bot is already owned by another runtime.");
        }
        if (lease.claimRequestId !== input.claimRequestId) {
          throw new ApiError(409, "BOT_LEASE_ALREADY_OWNED", "Runtime already owns this bot under another claim request.");
        }
      } else {
        if (lease.claimRequestId === input.claimRequestId) {
          throw new ApiError(
            409,
            "BOT_LEASE_CONFLICT",
            "A new claim request is required for a new lease generation.",
          );
        }
        generation += 1;
      }

      const updatedLease = await tx.botRuntimeLease.update({
        where: { botInstanceId: input.botInstanceId },
        data: {
          runtimeInstanceId: input.runtimeInstanceId,
          claimRequestId: input.claimRequestId,
          leaseGeneration: generation,
          leaseTokenHash: input.leaseTokenHash,
          runtimeState: "CLAIMED",
          expiresAt: input.expiresAt,
          lastHeartbeatAt: input.now,
          claimedTokenVersion: bot.tokenVersion,
          revokedAt: null,
          lastErrorCode: null,
          lastErrorAt: null,
        },
      });
      return {
        bot: mapBot(bot),
        profile: mapProfile(bot.profile),
        secret: mapSecret(bot.tokenSecret),
        lease: mapLease(updatedLease),
        leaseToken: input.leaseToken,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private assertLease(row: any, input: { leaseGeneration: number; leaseTokenHash: string; now: Date }, botTokenVersion?: number): void {
    if (row.revokedAt) throw new ApiError(401, "BOT_LEASE_REVOKED", "Bot lease has been revoked.");
    if (!row.expiresAt || row.expiresAt <= input.now) throw new ApiError(401, "BOT_LEASE_EXPIRED", "Bot lease has expired.");
    if (row.leaseGeneration !== input.leaseGeneration) throw new ApiError(401, "BOT_LEASE_GENERATION_MISMATCH", "Bot lease generation does not match.");
    if (!row.leaseTokenHash || row.leaseTokenHash !== input.leaseTokenHash) throw new ApiError(401, "BOT_LEASE_REVOKED", "Bot lease token is invalid.");
    if (botTokenVersion !== undefined && row.claimedTokenVersion !== botTokenVersion) {
      throw new ApiError(401, "BOT_LEASE_REVOKED", "Bot token version changed.");
    }
  }

  async heartbeatRuntime(input: { botInstanceId: string; leaseGeneration: number; leaseTokenHash: string; now: Date; expiresAt: Date; runtimeState?: BotRuntimeState; connectedAt?: Date; errorCode?: string | null }): Promise<BotRuntimeLeaseRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBotInstance(tx, input.botInstanceId);
      const bot = await tx.botInstance.findUnique({ where: { id: input.botInstanceId }, include: { runtimeLease: true } });
      if (!bot?.runtimeLease) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      if (bot.desiredStatus !== "ACTIVE") throw new ApiError(401, "BOT_DISABLED", "Bot is not active.");
      this.assertLease(bot.runtimeLease, input, bot.tokenVersion);
      const row = await tx.botRuntimeLease.update({
        where: { botInstanceId: input.botInstanceId },
        data: {
          expiresAt: input.expiresAt,
          lastHeartbeatAt: input.now,
          runtimeState: input.runtimeState,
          lastConnectedAt: input.connectedAt,
          lastErrorCode: input.errorCode,
          lastErrorAt: input.errorCode ? input.now : undefined,
        },
      });
      return mapLease(row);
    });
  }

  async releaseRuntime(input: { botInstanceId: string; leaseGeneration: number; leaseTokenHash: string; now: Date }): Promise<BotRuntimeLeaseRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBotInstance(tx, input.botInstanceId);
      const bot = await tx.botInstance.findUnique({ where: { id: input.botInstanceId }, include: { runtimeLease: true } });
      if (!bot?.runtimeLease) throw new ApiError(404, "BOT_NOT_FOUND", "Bot not found.");
      if (bot.desiredStatus !== "ACTIVE") throw new ApiError(401, "BOT_DISABLED", "Bot is not active.");
      this.assertLease(bot.runtimeLease, input, bot.tokenVersion);
      const released = await tx.botRuntimeLease.update({
        where: { botInstanceId: input.botInstanceId },
        data: {
          runtimeInstanceId: null,
          claimRequestId: null,
          leaseTokenHash: null,
          runtimeState: "STOPPED",
          expiresAt: null,
          claimedTokenVersion: null,
          revokedAt: null,
          lastHeartbeatAt: input.now,
        },
      });
      return mapLease(released);
    });
  }

  async validateRuntimeLease(input: { botInstanceId: string; leaseGeneration: number; leaseTokenHash: string; now: Date }): Promise<{ bot: BotInstanceRecord; lease: BotRuntimeLeaseRecord }> {
    const bot = await this.prisma.botInstance.findUnique({
      where: { id: input.botInstanceId },
      include: { tokenSecret: { select: { id: true } }, runtimeLease: true },
    });
    if (!bot?.runtimeLease) throw new ApiError(401, "BOT_LEASE_EXPIRED", "Bot lease was not found.");
    if (bot.desiredStatus !== "ACTIVE") {
      throw new ApiError(401, "BOT_DISABLED", "Bot is not active.");
    }
    this.assertLease(bot.runtimeLease, input, bot.tokenVersion);
    return { bot: mapBot(bot), lease: mapLease(bot.runtimeLease) };
  }

  async revokeRuntimeLease(
    botInstanceId: string,
    now: Date,
    options: { preserveExpiry?: boolean } = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockBotInstance(tx, botInstanceId);
      await tx.botRuntimeLease.updateMany({
        where: { botInstanceId },
        data: {
          runtimeInstanceId: null,
          claimRequestId: null,
          leaseTokenHash: null,
          runtimeState: "STOPPED",
          ...(options.preserveExpiry === false ? { expiresAt: null } : {}),
          claimedTokenVersion: null,
          revokedAt: now,
        },
      });
    });
  }

  async acquireDiscordEvent(input: { botInstanceId: string; discordEventId: string; eventType: "MESSAGE_CREATE" | "INTERACTION_CREATE"; leaseGeneration: number; acquisitionRequestId: string; now: Date; expiresAt: Date; staleBefore: Date; maxAttempts: number }): Promise<{ receipt: DiscordEventReceiptRecord; acquired: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.discordEventReceipt.findUnique({
        where: { botInstanceId_discordEventId_eventType: {
          botInstanceId: input.botInstanceId,
          discordEventId: input.discordEventId,
          eventType: input.eventType,
        } },
      });
      if (!existing) {
        const created = await tx.discordEventReceipt.create({
          data: {
            id: generateId(),
            botInstanceId: input.botInstanceId,
            discordEventId: input.discordEventId,
            eventType: input.eventType,
            leaseGeneration: input.leaseGeneration,
            acquisitionRequestId: input.acquisitionRequestId,
            processingStatus: "PROCESSING",
            expiresAt: input.expiresAt,
          },
        });
        return { receipt: mapReceipt(created), acquired: true };
      }
      if (existing.processingStatus === "COMPLETED") return { receipt: mapReceipt(existing), acquired: false };
      if (
        existing.processingStatus === "PROCESSING"
        && existing.leaseGeneration === input.leaseGeneration
        && existing.acquisitionRequestId === input.acquisitionRequestId
      ) {
        return { receipt: mapReceipt(existing), acquired: true };
      }
      if (existing.processingStatus === "PROCESSING" && existing.updatedAt > input.staleBefore) {
        return { receipt: mapReceipt(existing), acquired: false };
      }
      if (existing.attemptCount >= input.maxAttempts) return { receipt: mapReceipt(existing), acquired: false };
      const updated = await tx.discordEventReceipt.update({
        where: { id: existing.id },
        data: {
          processingStatus: "PROCESSING",
          attemptCount: { increment: 1 },
          leaseGeneration: input.leaseGeneration,
          acquisitionRequestId: input.acquisitionRequestId,
          expiresAt: input.expiresAt,
          lastErrorCode: null,
        },
      });
      return { receipt: mapReceipt(updated), acquired: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async completeDiscordEvent(input: { receiptId: string; botInstanceId: string; leaseGeneration: number; acquisitionRequestId: string }): Promise<void> {
    const result = await this.prisma.discordEventReceipt.updateMany({
      where: {
        id: input.receiptId,
        botInstanceId: input.botInstanceId,
        leaseGeneration: input.leaseGeneration,
        acquisitionRequestId: input.acquisitionRequestId,
        processingStatus: "PROCESSING",
      },
      data: { processingStatus: "COMPLETED" },
    });
    if (result.count === 1) return;

    const existing = await this.prisma.discordEventReceipt.findUnique({
      where: { id: input.receiptId },
    });
    if (
      existing?.botInstanceId === input.botInstanceId
      && existing.leaseGeneration === input.leaseGeneration
      && existing.acquisitionRequestId === input.acquisitionRequestId
      && existing.processingStatus === "COMPLETED"
    ) {
      return;
    }
    throw new ApiError(409, "EVENT_RECEIPT_OWNERSHIP_MISMATCH", "Event receipt is not owned by this processing attempt.");
  }

  async failDiscordEvent(input: { receiptId: string; botInstanceId: string; leaseGeneration: number; acquisitionRequestId: string; errorCode: string }): Promise<void> {
    const result = await this.prisma.discordEventReceipt.updateMany({
      where: {
        id: input.receiptId,
        botInstanceId: input.botInstanceId,
        leaseGeneration: input.leaseGeneration,
        acquisitionRequestId: input.acquisitionRequestId,
        processingStatus: "PROCESSING",
      },
      data: { processingStatus: "FAILED", lastErrorCode: input.errorCode },
    });
    if (result.count === 1) return;

    const existing = await this.prisma.discordEventReceipt.findUnique({
      where: { id: input.receiptId },
    });
    if (
      existing?.botInstanceId === input.botInstanceId
      && existing.leaseGeneration === input.leaseGeneration
      && existing.acquisitionRequestId === input.acquisitionRequestId
    ) {
      if (existing.processingStatus === "FAILED") return;
      if (existing.processingStatus === "COMPLETED") {
        throw new ApiError(409, "EVENT_RECEIPT_ALREADY_COMPLETED", "A completed event receipt cannot be marked as failed.");
      }
    }
    throw new ApiError(409, "EVENT_RECEIPT_OWNERSHIP_MISMATCH", "Event receipt is not owned by this processing attempt.");
  }

  async purgeExpiredDiscordEventReceipts(now: Date, limit: number): Promise<number> {
    if (!Number.isFinite(limit) || limit <= 0) return 0;
    const batchSize = Math.min(Math.trunc(limit), 10_000);
    const expired = await this.prisma.discordEventReceipt.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: { id: true },
    });
    if (expired.length === 0) return 0;

    const deleted = await this.prisma.discordEventReceipt.deleteMany({
      where: {
        id: { in: expired.map(({ id }) => id) },
        // A retry may extend a receipt between selection and deletion.
        expiresAt: { lte: now },
      },
    });
    return deleted.count;
  }

  async createAuditLog(input: {
    guildId?: string;
    botInstanceId?: string;
    botInstallationId?: string;
    actorUserId?: string;
    actorType: "USER" | "SYSTEM" | "PLATFORM_ADMIN";
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogRecord> {
    const row = await this.prisma.auditLog.create({
      data: {
        id: generateId(),
        guildId: input.guildId,
        botInstanceId: input.botInstanceId,
        botInstallationId: input.botInstallationId,
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeJson: input.before === undefined || input.before === null ? undefined : input.before as Prisma.InputJsonValue,
        afterJson: input.after === undefined || input.after === null ? undefined : input.after as Prisma.InputJsonValue,
        metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    return mapAudit(row);
  }

  async listAuditLogs(input: { guildDiscordId: string; botInstanceId?: string; cursor?: string; limit: number; actorUserId?: string; action?: string; from?: Date; to?: Date }): Promise<CursorPage<AuditLogRecord>> {
    const guild = await this.prisma.guild.findUnique({ where: { discordGuildId: input.guildDiscordId } });
    if (!guild) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    const offset = offsetFromCursor(input.cursor);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        guildId: guild.id,
        OR: input.botInstanceId
          ? [
              { botInstanceId: input.botInstanceId },
              { botInstanceId: null },
            ]
          : undefined,
        actorUserId: input.actorUserId,
        action: input.action,
        createdAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined,
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    return {
      items: rows.slice(0, input.limit).map(mapAudit),
      nextCursor: hasMore ? cursorFromOffset(offset + input.limit) : undefined,
    };
  }

  async listJobRuns(input: { guildDiscordId: string; botInstanceId?: string; cursor?: string; limit: number; status?: JobStatus }): Promise<CursorPage<JobRunRecord>> {
    const guild = await this.prisma.guild.findUnique({ where: { discordGuildId: input.guildDiscordId } });
    if (!guild) throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    const offset = offsetFromCursor(input.cursor);
    const rows = await this.prisma.jobRun.findMany({
      where: { guildId: guild.id, botInstanceId: input.botInstanceId, status: input.status },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    return {
      items: rows.slice(0, input.limit).map(mapJob),
      nextCursor: hasMore ? cursorFromOffset(offset + input.limit) : undefined,
    };
  }

  async createJobRun(input: { guildDiscordId?: string; botInstanceId?: string; botInstallationId?: string; jobType: string; payload: Record<string, unknown> }): Promise<JobRunRecord> {
    const guild = input.guildDiscordId
      ? await this.prisma.guild.findUnique({ where: { discordGuildId: input.guildDiscordId } })
      : null;
    const row = await this.prisma.jobRun.create({
      data: {
        id: generateId(),
        guildId: guild?.id,
        botInstanceId: input.botInstanceId,
        botInstallationId: input.botInstallationId,
        jobType: input.jobType,
        payloadJson: input.payload as Prisma.InputJsonValue,
      },
    });
    return mapJob(row);
  }

  async updateJobRun(input: { jobRunId: string; status: JobStatus; attempts?: number; result?: Record<string, unknown>; errorText?: string; startedAt?: Date; finishedAt?: Date }): Promise<JobRunRecord> {
    const row = await this.prisma.jobRun.update({
      where: { id: input.jobRunId },
      data: {
        status: input.status,
        attempts: input.attempts,
        resultJson: input.result as Prisma.InputJsonValue | undefined,
        errorText: input.errorText,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
      },
    });
    return mapJob(row);
  }

  async createSession(input: { userId: string; sessionTokenHash: string; ipAddress?: string; userAgent?: string; expiresAt: Date }): Promise<SessionRecord> {
    const row = await this.prisma.oauthSession.create({ data: { id: generateId(), ...input } });
    return { id: row.id, userId: row.userId, sessionTokenHash: row.sessionTokenHash, expiresAt: row.expiresAt };
  }

  async getSessionByTokenHash(sessionTokenHash: string): Promise<(SessionRecord & { user: UserRecord }) | null> {
    const row = await this.prisma.oauthSession.findUnique({ where: { sessionTokenHash }, include: { user: true } });
    if (!row || row.expiresAt <= new Date()) return null;
    return {
      id: row.id,
      userId: row.userId,
      sessionTokenHash: row.sessionTokenHash,
      expiresAt: row.expiresAt,
      user: mapUser(row.user),
    };
  }

  async deleteSessionByTokenHash(sessionTokenHash: string): Promise<void> {
    await this.prisma.oauthSession.deleteMany({ where: { sessionTokenHash } });
  }

  async getOrCreateConversation(input: { botInstanceId: string; type: LlmConversationType; guildDiscordId?: string; channelId?: string; discordUserId?: string }): Promise<LlmConversationRecord> {
    if (input.type === "GUILD_CHANNEL") {
      if (!input.guildDiscordId || !input.channelId) {
        throw new ApiError(400, "INVALID_CONVERSATION_SCOPE", "Guild conversation requires guild and channel IDs.");
      }
      const installation = await this.resolveInstallation(input.botInstanceId, input.guildDiscordId);
      const row = await this.prisma.llmConversation.upsert({
        where: { botInstallationId_discordChannelId_type: {
          botInstallationId: installation.id,
          discordChannelId: input.channelId,
          type: "GUILD_CHANNEL",
        } },
        create: {
          id: generateId(),
          botInstanceId: input.botInstanceId,
          botInstallationId: installation.id,
          discordChannelId: input.channelId,
          type: "GUILD_CHANNEL",
        },
        update: {},
      });
      return mapConversation(row);
    }
    if (!input.discordUserId) throw new ApiError(400, "INVALID_CONVERSATION_SCOPE", "DM conversation requires a user ID.");
    const row = await this.prisma.llmConversation.upsert({
      where: { botInstanceId_discordUserId_type: {
        botInstanceId: input.botInstanceId,
        discordUserId: input.discordUserId,
        type: "DM",
      } },
      create: {
        id: generateId(),
        botInstanceId: input.botInstanceId,
        discordUserId: input.discordUserId,
        type: "DM",
      },
      update: {},
    });
    return mapConversation(row);
  }

  async listRecentConversationMessages(conversationId: string, limit: number): Promise<LlmMessageRecord[]> {
    const rows = await this.prisma.llmMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.reverse().map(mapMessage);
  }

  async appendConversationMessage(input: { conversationId: string; role: LlmMessageRole; content: string; tokenCount?: number }): Promise<LlmMessageRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.llmMessage.create({
        data: { id: generateId(), ...input },
      });
      await tx.llmConversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: created.createdAt },
      });
      return created;
    });
    return mapMessage(row);
  }

  async updateConversationSummary(conversationId: string, summaryText: string): Promise<LlmConversationRecord> {
    return mapConversation(await this.prisma.llmConversation.update({
      where: { id: conversationId },
      data: { summaryText },
    }));
  }

  async recordLlmGeneration(input: { conversationId: string; botInstanceId: string; botInstallationId?: string; guildId?: string; provider: string; model: string; status: LlmGenerationStatus; inputTokens: number; outputTokens: number; latencyMs: number; errorCode?: string; errorText?: string }): Promise<LlmGenerationRecord> {
    const row = await this.prisma.llmGeneration.create({ data: { id: generateId(), ...input } });
    return {
      id: row.id,
      conversationId: row.conversationId,
      botInstanceId: row.botInstanceId,
      botInstallationId: row.botInstallationId,
      guildId: row.guildId,
      provider: row.provider,
      model: row.model,
      status: row.status as LlmGenerationStatus,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      latencyMs: row.latencyMs,
      errorCode: row.errorCode,
      errorText: row.errorText,
      createdAt: row.createdAt,
    };
  }

  async recordLlmModerationEvent(input: { botInstanceId: string; botInstallationId?: string; guildId?: string; conversationId?: string; category: string; action: string; details?: Record<string, unknown> }): Promise<LlmModerationEventRecord> {
    const row = await this.prisma.llmModerationEvent.create({
      data: {
        id: generateId(),
        botInstanceId: input.botInstanceId,
        botInstallationId: input.botInstallationId,
        guildId: input.guildId,
        conversationId: input.conversationId,
        category: input.category,
        action: input.action,
        detailsJson: (input.details ?? {}) as Prisma.InputJsonValue,
      },
    });
    return {
      id: row.id,
      botInstanceId: row.botInstanceId,
      botInstallationId: row.botInstallationId,
      guildId: row.guildId,
      conversationId: row.conversationId,
      category: row.category,
      action: row.action,
      details: asObject(row.detailsJson),
      createdAt: row.createdAt,
    };
  }

  async purgeExpiredLlmData(now: Date): Promise<{ deletedMessages: number; deletedGenerations: number; deletedModerationEvents: number; deletedConversations: number }> {
    const conversations = await this.prisma.llmConversation.findMany({
      include: {
        botInstance: { include: { profile: true } },
        botInstallation: { include: { llmSetting: true } },
      },
    });
    const expiredIds = conversations.filter((conversation) => {
      const retention = conversation.botInstallation?.llmSetting?.retentionDaysOverride
        ?? conversation.botInstance.profile?.retentionDays
        ?? 90;
      return conversation.lastMessageAt < new Date(now.getTime() - retention * 86_400_000);
    }).map((conversation) => conversation.id);
    const moderationCutoff = new Date(now.getTime() - 90 * 86_400_000);
    const [deletedMessages, deletedGenerations, deletedModerationEvents, deletedConversations] = await this.prisma.$transaction([
      this.prisma.llmMessage.count({ where: { conversationId: { in: expiredIds } } }),
      this.prisma.llmGeneration.count({ where: { conversationId: { in: expiredIds } } }),
      this.prisma.llmModerationEvent.deleteMany({
        where: {
          OR: [
            { conversationId: { in: expiredIds } },
            { createdAt: { lt: moderationCutoff } },
          ],
        },
      }),
      this.prisma.llmConversation.deleteMany({ where: { id: { in: expiredIds } } }),
    ]);
    return {
      deletedMessages,
      deletedGenerations,
      deletedModerationEvents: deletedModerationEvents.count,
      deletedConversations: deletedConversations.count,
    };
  }
}
