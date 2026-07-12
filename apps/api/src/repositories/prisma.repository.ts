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
import { ApiError } from "../lib/errors";
import { generateId } from "../lib/ids";
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
} from "./types";
import { TenantRepositoryBase } from "./tenant-repository";
import { Prisma, type PrismaClient } from "@prisma/client";
import { DEFAULT_COMMAND_POLICIES, DEFAULT_FEATURE_FLAGS } from "../lib/defaults";

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeOffsetCursor(cursor?: string): number {
  if (!cursor) return 0;
  const parsed = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function mapUser(record: {
  id: string;
  discordUserId: string;
  username?: string | null;
  globalName?: string | null;
  avatarUrl?: string | null;
  platformRole: PlatformRole | string;
}): UserRecord {
  return {
    id: record.id,
    discordUserId: record.discordUserId,
    username: record.username ?? null,
    globalName: record.globalName ?? null,
    avatarUrl: record.avatarUrl ?? null,
    platformRole: record.platformRole as PlatformRole,
  };
}

function mapLlmGuildSettings(record: {
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
}): LlmGuildSettingsRecord {
  return {
    id: record.id,
    guildId: record.guildId,
    enabled: record.enabled,
    defaultModel: record.defaultModel,
    stylePrompt: record.stylePrompt ?? null,
    retentionDays: record.retentionDays,
    dmEnabled: record.dmEnabled,
    maxInputChars: record.maxInputChars,
    maxOutputTokens: record.maxOutputTokens,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapLlmChannelSettings(record: {
  id: string;
  guildId: string;
  discordChannelId: string;
  enabled: boolean;
  respondOnMentionOnly: boolean;
  createdAt: Date;
  updatedAt: Date;
}): LlmChannelSettingsRecord {
  return {
    id: record.id,
    guildId: record.guildId,
    discordChannelId: record.discordChannelId,
    enabled: record.enabled,
    respondOnMentionOnly: record.respondOnMentionOnly,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapLlmConversation(record: {
  id: string;
  guildId?: string | null;
  discordChannelId?: string | null;
  discordUserId?: string | null;
  type: string;
  summaryText?: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): LlmConversationRecord {
  return {
    id: record.id,
    guildId: record.guildId ?? null,
    discordChannelId: record.discordChannelId ?? null,
    discordUserId: record.discordUserId ?? null,
    type: record.type as LlmConversationType,
    summaryText: record.summaryText ?? null,
    lastMessageAt: record.lastMessageAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapLlmMessage(record: {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  tokenCount?: number | null;
  createdAt: Date;
}): LlmMessageRecord {
  return {
    id: record.id,
    conversationId: record.conversationId,
    role: record.role as LlmMessageRole,
    content: record.content,
    tokenCount: record.tokenCount ?? null,
    createdAt: record.createdAt,
  };
}

const roleRank: Record<TenantRole, number> = {
  USER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export class PrismaAppRepository extends TenantRepositoryBase implements AppRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  async upsertUserFromDiscord(profile: DiscordProfile, isPlatformAdmin: boolean): Promise<UserRecord> {
    const user = await this.prisma.user.upsert({
      where: { discordUserId: profile.discordUserId },
      create: {
        id: generateId(),
        discordUserId: profile.discordUserId,
        username: profile.username,
        globalName: profile.globalName ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        platformRole: isPlatformAdmin ? "PLATFORM_ADMIN" : "NONE",
      },
      update: {
        username: profile.username,
        globalName: profile.globalName ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        platformRole: isPlatformAdmin ? "PLATFORM_ADMIN" : "NONE",
      },
    });

    return mapUser(user);
  }

  async getUserByDiscordId(discordUserId: string): Promise<UserRecord | null> {
    const user = await this.prisma.user.findUnique({ where: { discordUserId } });
    return user ? mapUser(user) : null;
  }

  async getGuildByDiscordId(guildDiscordId: string): Promise<GuildRecord | null> {
    const guild = await this.prisma.guild.findUnique({ where: { discordGuildId: guildDiscordId } });
    if (!guild) return null;
    return {
      id: guild.id,
      discordGuildId: guild.discordGuildId,
      name: guild.name,
    };
  }

  async bootstrapGuild(input: BootstrapGuildInput): Promise<BootstrapGuildResult> {
    return this.prisma.$transaction(async (tx: any) => {
      const existingGuild = await tx.guild.findUnique({
        where: { discordGuildId: input.guildDiscordId },
      });

      const guild = existingGuild
        ? await tx.guild.update({
            where: { id: existingGuild.id },
            data: { name: input.guildName },
          })
        : await tx.guild.create({
            data: {
              id: generateId(),
              discordGuildId: input.guildDiscordId,
              name: input.guildName,
              status: "ACTIVE",
            },
          });

      for (const feature of DEFAULT_FEATURE_FLAGS) {
        await tx.featureFlag.upsert({
          where: {
            guildId_featureKey: {
              guildId: guild.id,
              featureKey: feature.featureKey,
            },
          },
          create: {
            id: generateId(),
            guildId: guild.id,
            featureKey: feature.featureKey,
            enabled: feature.enabled,
            configJson: feature.configJson as Prisma.InputJsonValue,
            version: 1,
          },
          update: {},
        });
      }

      for (const command of DEFAULT_COMMAND_POLICIES) {
        await tx.commandPermission.upsert({
          where: {
            guildId_commandKey: {
              guildId: guild.id,
              commandKey: command.commandKey,
            },
          },
          create: {
            id: generateId(),
            guildId: guild.id,
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
        const ownerUser = await tx.user.upsert({
          where: { discordUserId: input.ownerProfile.discordUserId },
          create: {
            id: generateId(),
            discordUserId: input.ownerProfile.discordUserId,
            username: input.ownerProfile.username,
            globalName: input.ownerProfile.globalName ?? null,
            avatarUrl: input.ownerProfile.avatarUrl ?? null,
            platformRole: "NONE",
          },
          update: {
            username: input.ownerProfile.username,
            globalName: input.ownerProfile.globalName ?? null,
            avatarUrl: input.ownerProfile.avatarUrl ?? null,
          },
        });

        const ownerCount = await tx.guildMember.count({
          where: {
            guildId: guild.id,
            tenantRole: "OWNER",
            status: "ACTIVE",
          },
        });

        const existingMembership = await tx.guildMember.findUnique({
          where: {
            guildId_userId: {
              guildId: guild.id,
              userId: ownerUser.id,
            },
          },
        });

        if (ownerCount === 0) {
          ownerMembershipCreated = true;
          await tx.guildMember.upsert({
            where: {
              guildId_userId: {
                guildId: guild.id,
                userId: ownerUser.id,
              },
            },
            create: {
              guildId: guild.id,
              userId: ownerUser.id,
              tenantRole: "OWNER",
              status: "ACTIVE",
              joinedAt: new Date(),
            },
            update: {
              tenantRole: "OWNER",
              status: "ACTIVE",
            },
          });
        } else if (!existingMembership) {
          ownerMembershipCreated = true;
          await tx.guildMember.create({
            data: {
              guildId: guild.id,
              userId: ownerUser.id,
              tenantRole: "USER",
              status: "ACTIVE",
              joinedAt: new Date(),
            },
          });
        }
      }

      return {
        guild: {
          id: guild.id,
          discordGuildId: guild.discordGuildId,
          name: guild.name,
        },
        guildCreated: !existingGuild,
        ownerMembershipCreated,
      };
    });
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user ? mapUser(user) : null;
  }

  async getUserMemberships(userId: string): Promise<GuildMembershipSummary[]> {
    const memberships = await this.prisma.guildMember.findMany({
      where: { userId, status: "ACTIVE" },
      include: { guild: true },
      orderBy: { guild: { name: "asc" } },
    });

    return memberships.map((membership: any) => ({
      guildId: membership.guild.discordGuildId,
      guildName: membership.guild.name,
      tenantRole: membership.tenantRole as TenantRole,
    }));
  }

  async ensureGuildMembership(
    guildDiscordId: string,
    userId: string,
  ): Promise<{ guild: GuildRecord; membership: MembershipRecord } | null> {
    const guild = await this.prisma.guild.findUnique({
      where: { discordGuildId: guildDiscordId },
    });
    if (!guild) return null;

    const membership = await this.prisma.guildMember.findUnique({
      where: {
        guildId_userId: {
          guildId: guild.id,
          userId,
        },
      },
    });

    if (!membership || membership.status !== "ACTIVE") {
      return null;
    }

    return {
      guild: {
        id: guild.id,
        discordGuildId: guild.discordGuildId,
        name: guild.name,
      },
      membership: {
        guildId: membership.guildId,
        userId: membership.userId,
        tenantRole: membership.tenantRole as TenantRole,
        status: membership.status as MemberStatus,
      },
    };
  }

  async getMembershipByDiscordUser(guildDiscordId: string, discordUserId: string): Promise<MembershipRecord | null> {
    const guild = await this.prisma.guild.findUnique({
      where: { discordGuildId: guildDiscordId },
      select: { id: true },
    });
    if (!guild) return null;

    const user = await this.prisma.user.findUnique({
      where: { discordUserId },
      select: { id: true },
    });
    if (!user) return null;

    const membership = await this.prisma.guildMember.findUnique({
      where: {
        guildId_userId: {
          guildId: guild.id,
          userId: user.id,
        },
      },
    });
    if (!membership) return null;
    return {
      guildId: membership.guildId,
      userId: membership.userId,
      tenantRole: membership.tenantRole as TenantRole,
      status: membership.status as MemberStatus,
    };
  }

  async getCommandPermission(guildDiscordId: string, commandKey: string): Promise<CommandPermissionRecord | null> {
    const guildId = await this.resolveGuildId(guildDiscordId);
    const row = await this.prisma.commandPermission.findUnique({
      where: {
        guildId_commandKey: {
          guildId,
          commandKey,
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      guildId: row.guildId,
      commandKey: row.commandKey,
      minRole: row.minRole as TenantRole,
      allowChannels: (row.allowChannelsJson as string[]) ?? [],
      denyChannels: (row.denyChannelsJson as string[]) ?? [],
      updatedAt: row.updatedAt,
    };
  }

  async checkCommandAccess(input: {
    guildDiscordId: string;
    commandKey: string;
    actorDiscordUserId: string;
    channelId?: string;
    defaultMinRole: TenantRole;
  }): Promise<CommandAccessResult> {
    const guild = await this.getGuildByDiscordId(input.guildDiscordId);
    if (!guild) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }

    const policy =
      (await this.getCommandPermission(input.guildDiscordId, input.commandKey)) ?? {
        id: "",
        guildId: guild.id,
        commandKey: input.commandKey,
        minRole: input.defaultMinRole,
        allowChannels: [],
        denyChannels: [],
        updatedAt: new Date(0),
      };

    const actorUser = await this.getUserByDiscordId(input.actorDiscordUserId);
    if (!actorUser) {
      return {
        guild,
        policy,
        allowed: false,
        reason: "NO_USER",
      };
    }

    const membership = await this.ensureGuildMembership(input.guildDiscordId, actorUser.id);
    if (!membership) {
      return {
        guild,
        policy,
        allowed: false,
        reason: "NO_MEMBERSHIP",
      };
    }

    const actorRole = membership.membership.tenantRole;
    if (roleRank[actorRole] < roleRank[policy.minRole]) {
      return {
        guild,
        policy,
        actor: {
          userId: actorUser.id,
          tenantRole: actorRole,
        },
        allowed: false,
        reason: "ROLE_TOO_LOW",
      };
    }

    if (input.channelId && policy.denyChannels.includes(input.channelId)) {
      return {
        guild,
        policy,
        actor: {
          userId: actorUser.id,
          tenantRole: actorRole,
        },
        allowed: false,
        reason: "CHANNEL_DENIED",
      };
    }

    if (input.channelId && policy.allowChannels.length > 0 && !policy.allowChannels.includes(input.channelId)) {
      return {
        guild,
        policy,
        actor: {
          userId: actorUser.id,
          tenantRole: actorRole,
        },
        allowed: false,
        reason: "CHANNEL_NOT_ALLOWED",
      };
    }

    return {
      guild,
      policy,
      actor: {
        userId: actorUser.id,
        tenantRole: actorRole,
      },
      allowed: true,
    };
  }

  async getGuildSettings(guildDiscordId: string): Promise<GuildSettingsRecord | null> {
    const guild = await this.prisma.guild.findUnique({
      where: { discordGuildId: guildDiscordId },
    });
    if (!guild) return null;

    const [features, commands] = await this.prisma.$transaction([
      this.prisma.featureFlag.findMany({
        where: { guildId: guild.id },
        orderBy: { featureKey: "asc" },
      }),
      this.prisma.commandPermission.findMany({
        where: { guildId: guild.id },
        orderBy: { commandKey: "asc" },
      }),
    ]);

    return {
      guild: {
        id: guild.id,
        discordGuildId: guild.discordGuildId,
        name: guild.name,
      },
      features: features.map((record: any) => ({
        id: record.id,
        guildId: record.guildId,
        featureKey: record.featureKey,
        enabled: record.enabled,
        configJson: record.configJson as Record<string, unknown>,
        version: record.version,
        updatedAt: record.updatedAt,
      })),
      commands: commands.map((record: any) => ({
        id: record.id,
        guildId: record.guildId,
        commandKey: record.commandKey,
        minRole: record.minRole as TenantRole,
        allowChannels: (record.allowChannelsJson as string[]) ?? [],
        denyChannels: (record.denyChannelsJson as string[]) ?? [],
        updatedAt: record.updatedAt,
      })),
    };
  }

  async upsertFeatureFlag(input: {
    guildDiscordId: string;
    featureKey: string;
    enabled: boolean;
    configJson: Record<string, unknown>;
    expectedVersion?: number;
  }): Promise<{ previous?: FeatureFlagRecord; current: FeatureFlagRecord }> {
    const guildId = await this.resolveGuildId(input.guildDiscordId);

    return this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.featureFlag.findUnique({
        where: { guildId_featureKey: { guildId, featureKey: input.featureKey } },
      });

      if (existing && input.expectedVersion && existing.version !== input.expectedVersion) {
        throw new ApiError(409, "FEATURE_VERSION_CONFLICT", "Feature configuration version conflict.");
      }

      const updated = await tx.featureFlag.upsert({
        where: { guildId_featureKey: { guildId, featureKey: input.featureKey } },
        create: {
          id: generateId(),
          guildId,
          featureKey: input.featureKey,
          enabled: input.enabled,
          configJson: input.configJson,
          version: 1,
        },
        update: {
          enabled: input.enabled,
          configJson: input.configJson,
          version: existing ? existing.version + 1 : 1,
        },
      });

      return {
        previous: existing
          ? {
              id: existing.id,
              guildId: existing.guildId,
              featureKey: existing.featureKey,
              enabled: existing.enabled,
              configJson: existing.configJson as Record<string, unknown>,
              version: existing.version,
              updatedAt: existing.updatedAt,
            }
          : undefined,
        current: {
          id: updated.id,
          guildId: updated.guildId,
          featureKey: updated.featureKey,
          enabled: updated.enabled,
          configJson: updated.configJson as Record<string, unknown>,
          version: updated.version,
          updatedAt: updated.updatedAt,
        },
      };
    });
  }

  async upsertCommandPermission(input: {
    guildDiscordId: string;
    commandKey: string;
    minRole: TenantRole;
    allowChannels: string[];
    denyChannels: string[];
  }): Promise<{ previous?: CommandPermissionRecord; current: CommandPermissionRecord }> {
    const guildId = await this.resolveGuildId(input.guildDiscordId);

    const previous = await this.prisma.commandPermission.findUnique({
      where: {
        guildId_commandKey: {
          guildId,
          commandKey: input.commandKey,
        },
      },
    });

    const updated = await this.prisma.commandPermission.upsert({
      where: {
        guildId_commandKey: {
          guildId,
          commandKey: input.commandKey,
        },
      },
      create: {
        id: generateId(),
        guildId,
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

    return {
      previous: previous
        ? {
            id: previous.id,
            guildId: previous.guildId,
            commandKey: previous.commandKey,
            minRole: previous.minRole as TenantRole,
            allowChannels: (previous.allowChannelsJson as string[]) ?? [],
            denyChannels: (previous.denyChannelsJson as string[]) ?? [],
            updatedAt: previous.updatedAt,
          }
        : undefined,
      current: {
        id: updated.id,
        guildId: updated.guildId,
        commandKey: updated.commandKey,
        minRole: updated.minRole as TenantRole,
        allowChannels: (updated.allowChannelsJson as string[]) ?? [],
        denyChannels: (updated.denyChannelsJson as string[]) ?? [],
        updatedAt: updated.updatedAt,
      },
    };
  }

  async listGuildMembers(guildDiscordId: string, limit: number, cursor?: string): Promise<CursorPage<GuildMemberListItem>> {
    const guildId = await this.resolveGuildId(guildDiscordId);
    const offset = decodeOffsetCursor(cursor);
    const rows = await this.prisma.guildMember.findMany({
      where: { guildId },
      include: { user: true },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
      skip: offset,
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row: any) => ({
      userId: row.userId,
      discordUserId: row.user.discordUserId,
      username: row.user.username,
      tenantRole: row.tenantRole as TenantRole,
      status: row.status as MemberStatus,
    }));

    return {
      items,
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : undefined,
    };
  }

  async updateGuildMemberRole(input: {
    guildDiscordId: string;
    targetUserId: string;
    role: TenantRole;
  }): Promise<{ guild: GuildRecord; before: MembershipRecord; after: MembershipRecord } | null> {
    const guild = await this.prisma.guild.findUnique({
      where: { discordGuildId: input.guildDiscordId },
    });
    if (!guild) return null;

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM guilds WHERE id = ${guild.id}::uuid FOR UPDATE`;

        const membership = await tx.guildMember.findUnique({
          where: { guildId_userId: { guildId: guild.id, userId: input.targetUserId } },
        });
        if (!membership) return null;

        if (membership.tenantRole === "OWNER" && input.role !== "OWNER") {
          const ownerCount = await tx.guildMember.count({
            where: { guildId: guild.id, tenantRole: "OWNER", status: "ACTIVE" },
          });
          if (ownerCount <= 1) {
            throw new ApiError(409, "LAST_OWNER_PROTECTED", "Cannot demote the last OWNER.");
          }
        }

        const updated = await tx.guildMember.update({
          where: { guildId_userId: { guildId: guild.id, userId: input.targetUserId } },
          data: { tenantRole: input.role },
        });
        return { membership, updated };
      },
      {
        maxWait: 10_000,
        timeout: 10_000,
      },
    );
    if (!result) return null;
    const { membership, updated } = result;

    return {
      guild: {
        id: guild.id,
        discordGuildId: guild.discordGuildId,
        name: guild.name,
      },
      before: {
        guildId: membership.guildId,
        userId: membership.userId,
        tenantRole: membership.tenantRole as TenantRole,
        status: membership.status as MemberStatus,
      },
      after: {
        guildId: updated.guildId,
        userId: updated.userId,
        tenantRole: updated.tenantRole as TenantRole,
        status: updated.status as MemberStatus,
      },
    };
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
    const record = await this.prisma.auditLog.create({
      data: {
        id: generateId(),
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeJson: input.before ? (input.before as Prisma.InputJsonValue) : Prisma.JsonNull,
        afterJson: input.after ? (input.after as Prisma.InputJsonValue) : Prisma.JsonNull,
        metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    return {
      id: record.id,
      guildId: record.guildId,
      actorUserId: record.actorUserId,
      actorType: record.actorType as AuditActorType,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      before: (record.beforeJson as Record<string, unknown> | null) ?? null,
      after: (record.afterJson as Record<string, unknown> | null) ?? null,
      metadata: record.metadataJson as Record<string, unknown>,
      createdAt: record.createdAt,
    };
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
    const guildId = await this.resolveGuildId(input.guildDiscordId);
    const offset = decodeOffsetCursor(input.cursor);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        guildId,
        actorUserId: input.actorUserId,
        action: input.action,
        createdAt: {
          gte: input.from,
          lte: input.to,
        },
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: input.limit + 1,
    });

    const hasMore = rows.length > input.limit;
    const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items: trimmed.map((row: any) => ({
        id: row.id,
        guildId: row.guildId,
        actorUserId: row.actorUserId,
        actorType: row.actorType as AuditActorType,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: (row.beforeJson as Record<string, unknown> | null) ?? null,
        after: (row.afterJson as Record<string, unknown> | null) ?? null,
        metadata: row.metadataJson as Record<string, unknown>,
        createdAt: row.createdAt,
      })),
      nextCursor: hasMore ? encodeOffsetCursor(offset + input.limit) : undefined,
    };
  }

  async listJobRuns(input: {
    guildDiscordId: string;
    cursor?: string;
    limit: number;
    status?: JobStatus;
  }): Promise<CursorPage<JobRunRecord>> {
    const guildId = await this.resolveGuildId(input.guildDiscordId);
    const offset = decodeOffsetCursor(input.cursor);
    const rows = await this.prisma.jobRun.findMany({
      where: { guildId, status: input.status },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: input.limit + 1,
    });

    const hasMore = rows.length > input.limit;
    const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items: trimmed.map((row: any) => ({
        id: row.id,
        guildId: row.guildId,
        jobType: row.jobType,
        status: row.status as JobStatus,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        payload: row.payloadJson as Record<string, unknown>,
        result: (row.resultJson as Record<string, unknown> | null) ?? null,
        errorText: row.errorText,
        scheduledAt: row.scheduledAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        createdAt: row.createdAt,
      })),
      nextCursor: hasMore ? encodeOffsetCursor(offset + input.limit) : undefined,
    };
  }

  async createSession(input: {
    userId: string;
    sessionTokenHash: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    const session = await this.prisma.oauthSession.create({
      data: {
        id: generateId(),
        userId: input.userId,
        sessionTokenHash: input.sessionTokenHash,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        expiresAt: input.expiresAt,
      },
    });

    return {
      id: session.id,
      userId: session.userId,
      sessionTokenHash: session.sessionTokenHash,
      expiresAt: session.expiresAt,
    };
  }

  async getSessionByTokenHash(sessionTokenHash: string): Promise<(SessionRecord & { user: UserRecord }) | null> {
    const session = await this.prisma.oauthSession.findUnique({
      where: { sessionTokenHash },
      include: { user: true },
    });

    if (!session) return null;
    if (session.expiresAt <= new Date()) return null;

    return {
      id: session.id,
      userId: session.userId,
      sessionTokenHash: session.sessionTokenHash,
      expiresAt: session.expiresAt,
      user: mapUser(session.user),
    };
  }

  async deleteSessionByTokenHash(sessionTokenHash: string): Promise<void> {
    await this.prisma.oauthSession.deleteMany({ where: { sessionTokenHash } });
  }

  async createJobRun(input: {
    guildDiscordId: string;
    jobType: string;
    payload: Record<string, unknown>;
  }): Promise<JobRunRecord> {
    const guildId = await this.resolveGuildId(input.guildDiscordId);
    const row = await this.prisma.jobRun.create({
      data: {
        id: generateId(),
        guildId,
        jobType: input.jobType,
        payloadJson: input.payload as Prisma.InputJsonValue,
        status: "QUEUED",
      },
    });

    return {
      id: row.id,
      guildId: row.guildId,
      jobType: row.jobType,
      status: row.status as JobStatus,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      payload: row.payloadJson as Record<string, unknown>,
      result: (row.resultJson as Record<string, unknown> | null) ?? null,
      errorText: row.errorText,
      scheduledAt: row.scheduledAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      createdAt: row.createdAt,
    };
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
    const row = await this.prisma.jobRun.update({
      where: { id: input.jobRunId },
      data: {
        status: input.status,
        attempts: input.attempts,
        resultJson:
          input.result === undefined
            ? undefined
            : input.result
              ? (input.result as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        errorText: input.errorText,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
      },
    });

    return {
      id: row.id,
      guildId: row.guildId,
      jobType: row.jobType,
      status: row.status as JobStatus,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      payload: row.payloadJson as Record<string, unknown>,
      result: (row.resultJson as Record<string, unknown> | null) ?? null,
      errorText: row.errorText,
      scheduledAt: row.scheduledAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      createdAt: row.createdAt,
    };
  }

  async getOrCreateLlmGuildSettings(guildDiscordId: string): Promise<{ guild: GuildRecord; settings: LlmGuildSettingsRecord }> {
    const guild = await this.getGuildByDiscordId(guildDiscordId);
    if (!guild) {
      throw new ApiError(404, "GUILD_NOT_FOUND", "Guild not found.");
    }

    const settings = await this.prisma.llmGuildSetting.upsert({
      where: { guildId: guild.id },
      create: {
        id: generateId(),
        guildId: guild.id,
      },
      update: {},
    });

    return {
      guild,
      settings: mapLlmGuildSettings(settings),
    };
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
    const { guild } = await this.getOrCreateLlmGuildSettings(input.guildDiscordId);
    const updated = await this.prisma.llmGuildSetting.update({
      where: { guildId: guild.id },
      data: {
        enabled: input.enabled,
        defaultModel: input.defaultModel,
        stylePrompt: input.stylePrompt === undefined ? undefined : input.stylePrompt,
        retentionDays: input.retentionDays,
        dmEnabled: input.dmEnabled,
        maxInputChars: input.maxInputChars,
        maxOutputTokens: input.maxOutputTokens,
      },
    });

    return {
      guild,
      settings: mapLlmGuildSettings(updated),
    };
  }

  async getLlmChannelSettings(guildDiscordId: string, channelId: string): Promise<LlmChannelSettingsRecord | null> {
    const guild = await this.getGuildByDiscordId(guildDiscordId);
    if (!guild) {
      return null;
    }
    const row = await this.prisma.llmChannelSetting.findUnique({
      where: {
        guildId_discordChannelId: {
          guildId: guild.id,
          discordChannelId: channelId,
        },
      },
    });
    return row ? mapLlmChannelSettings(row) : null;
  }

  async upsertLlmChannelSettings(input: {
    guildDiscordId: string;
    channelId: string;
    enabled: boolean;
    respondOnMentionOnly?: boolean;
  }): Promise<LlmChannelSettingsRecord> {
    const guildId = await this.resolveGuildId(input.guildDiscordId);
    const row = await this.prisma.llmChannelSetting.upsert({
      where: {
        guildId_discordChannelId: {
          guildId,
          discordChannelId: input.channelId,
        },
      },
      create: {
        id: generateId(),
        guildId,
        discordChannelId: input.channelId,
        enabled: input.enabled,
        respondOnMentionOnly: input.respondOnMentionOnly ?? false,
      },
      update: {
        enabled: input.enabled,
        respondOnMentionOnly: input.respondOnMentionOnly,
      },
    });
    return mapLlmChannelSettings(row);
  }

  async clearLlmChannelMemory(
    guildDiscordId: string,
    channelId: string,
  ): Promise<{ deletedMessages: number; deletedConversations: number }> {
    const guildId = await this.resolveGuildId(guildDiscordId);
    const conversations = await this.prisma.llmConversation.findMany({
      where: {
        guildId,
        discordChannelId: channelId,
        type: "GUILD_CHANNEL",
      },
      select: { id: true },
    });
    const conversationIds = conversations.map((item) => item.id);
    if (conversationIds.length === 0) {
      return { deletedMessages: 0, deletedConversations: 0 };
    }

    const deletedMessages = await this.prisma.llmMessage.count({
      where: { conversationId: { in: conversationIds } },
    });

    const deletedConversations = await this.prisma.llmConversation.deleteMany({
      where: { id: { in: conversationIds } },
    });

    return {
      deletedMessages,
      deletedConversations: deletedConversations.count,
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
      const guildId = await this.resolveGuildId(input.guildDiscordId);
      const existing = await this.prisma.llmConversation.findFirst({
        where: {
          guildId,
          discordChannelId: input.channelId,
          type: "GUILD_CHANNEL",
        },
      });
      if (existing) {
        return mapLlmConversation(existing);
      }
      const created = await this.prisma.llmConversation.create({
        data: {
          id: generateId(),
          guildId,
          discordChannelId: input.channelId,
          type: "GUILD_CHANNEL",
        },
      });
      return mapLlmConversation(created);
    }

    if (!input.discordUserId) {
      throw new ApiError(400, "INVALID_CONVERSATION_SCOPE", "DM conversation requires discordUserId.");
    }

    const existing = await this.prisma.llmConversation.findFirst({
      where: {
        type: "DM",
        discordUserId: input.discordUserId,
      },
    });
    if (existing) {
      return mapLlmConversation(existing);
    }

    const created = await this.prisma.llmConversation.create({
      data: {
        id: generateId(),
        type: "DM",
        discordUserId: input.discordUserId,
      },
    });
    return mapLlmConversation(created);
  }

  async listRecentConversationMessages(conversationId: string, limit: number): Promise<LlmMessageRecord[]> {
    const rows = await this.prisma.llmMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.reverse().map(mapLlmMessage);
  }

  async appendConversationMessage(input: {
    conversationId: string;
    role: LlmMessageRole;
    content: string;
    tokenCount?: number;
  }): Promise<LlmMessageRecord> {
    const row = await this.prisma.$transaction(async (tx: any) => {
      const conversation = await tx.llmConversation.findUnique({
        where: { id: input.conversationId },
      });
      if (!conversation) {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
      }
      const created = await tx.llmMessage.create({
        data: {
          id: generateId(),
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          tokenCount: input.tokenCount,
        },
      });
      await tx.llmConversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: created.createdAt },
      });
      return created;
    });
    return mapLlmMessage(row);
  }

  async updateConversationSummary(conversationId: string, summaryText: string): Promise<LlmConversationRecord> {
    const row = await this.prisma.llmConversation.update({
      where: { id: conversationId },
      data: {
        summaryText,
      },
    });
    return mapLlmConversation(row);
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
    const row = await this.prisma.llmGeneration.create({
      data: {
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
      },
    });
    return {
      id: row.id,
      conversationId: row.conversationId,
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

  async recordLlmModerationEvent(input: {
    guildId?: string;
    conversationId?: string;
    category: string;
    action: string;
    details?: Record<string, unknown>;
  }): Promise<LlmModerationEventRecord> {
    const row = await this.prisma.llmModerationEvent.create({
      data: {
        id: generateId(),
        guildId: input.guildId,
        conversationId: input.conversationId,
        category: input.category,
        action: input.action,
        detailsJson: (input.details ?? {}) as Prisma.InputJsonValue,
      },
    });
    return {
      id: row.id,
      guildId: row.guildId,
      conversationId: row.conversationId,
      category: row.category,
      action: row.action,
      details: row.detailsJson as Record<string, unknown>,
      createdAt: row.createdAt,
    };
  }

  async purgeExpiredLlmData(now: Date): Promise<{
    deletedMessages: number;
    deletedGenerations: number;
    deletedModerationEvents: number;
    deletedConversations: number;
  }> {
    const settings = await this.prisma.llmGuildSetting.findMany({
      select: { guildId: true, retentionDays: true },
    });
    const retentionByGuild = new Map(settings.map((item) => [item.guildId, item.retentionDays]));
    const conversations = await this.prisma.llmConversation.findMany({
      select: { id: true, guildId: true, lastMessageAt: true },
    });

    const expiredConversationIds: string[] = [];
    for (const conversation of conversations) {
      const retentionDays = conversation.guildId ? (retentionByGuild.get(conversation.guildId) ?? 90) : 90;
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      if (conversation.lastMessageAt < cutoff) {
        expiredConversationIds.push(conversation.id);
      }
    }

    if (expiredConversationIds.length === 0) {
      return {
        deletedMessages: 0,
        deletedGenerations: 0,
        deletedModerationEvents: 0,
        deletedConversations: 0,
      };
    }

    const deletedMessages = await this.prisma.llmMessage.count({
      where: { conversationId: { in: expiredConversationIds } },
    });
    const deletedGenerations = await this.prisma.llmGeneration.count({
      where: { conversationId: { in: expiredConversationIds } },
    });
    const deletedModerationEvents = await this.prisma.llmModerationEvent.deleteMany({
      where: {
        OR: [
          { conversationId: { in: expiredConversationIds } },
          { createdAt: { lt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
        ],
      },
    });
    const deletedConversations = await this.prisma.llmConversation.deleteMany({
      where: {
        id: { in: expiredConversationIds },
      },
    });

    return {
      deletedMessages,
      deletedGenerations,
      deletedModerationEvents: deletedModerationEvents.count,
      deletedConversations: deletedConversations.count,
    };
  }
}
