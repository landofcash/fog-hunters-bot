import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/errors";
import { PrismaAppRepository } from "../../src/repositories/prisma.repository";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Prisma integration tests.");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const repository = new PrismaAppRepository(prisma);

async function cleanDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "llm_moderation_events",
      "llm_generations",
      "llm_messages",
      "llm_conversations",
      "llm_channel_settings",
      "llm_guild_settings",
      "webhook_deliveries",
      "oauth_sessions",
      "job_runs",
      "audit_logs",
      "command_permissions",
      "feature_flags",
      "guild_members",
      "users",
      "guilds"
    RESTART IDENTITY CASCADE
  `);
}

async function bootstrapGuild(discordGuildId: string, ownerDiscordUserId: string) {
  return repository.bootstrapGuild({
    guildDiscordId: discordGuildId,
    guildName: `Guild ${discordGuildId}`,
    ownerProfile: {
      discordUserId: ownerDiscordUserId,
      username: ownerDiscordUserId,
    },
  });
}

describe("PrismaAppRepository integration", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  });

  it("keeps guild data and memberships isolated by tenant", async () => {
    const guildA = await bootstrapGuild("guild-a", "owner-a");
    const guildB = await bootstrapGuild("guild-b", "owner-b");
    const ownerA = await repository.getUserByDiscordId("owner-a");
    expect(ownerA).not.toBeNull();

    await repository.upsertFeatureFlag({
      guildDiscordId: guildA.guild.discordGuildId,
      featureKey: "custom",
      enabled: true,
      configJson: { tenant: "a" },
    });
    await repository.upsertFeatureFlag({
      guildDiscordId: guildB.guild.discordGuildId,
      featureKey: "custom",
      enabled: false,
      configJson: { tenant: "b" },
    });

    await expect(repository.ensureGuildMembership("guild-b", ownerA!.id)).resolves.toBeNull();
    const settingsA = await repository.getGuildSettings("guild-a");
    const settingsB = await repository.getGuildSettings("guild-b");
    expect(settingsA?.features.find((feature) => feature.featureKey === "custom")).toMatchObject({
      enabled: true,
      configJson: { tenant: "a" },
    });
    expect(settingsB?.features.find((feature) => feature.featureKey === "custom")).toMatchObject({
      enabled: false,
      configJson: { tenant: "b" },
    });
  });

  it("rejects stale feature versions without modifying the stored value", async () => {
    await bootstrapGuild("guild-version", "owner-version");
    const initial = await repository.upsertFeatureFlag({
      guildDiscordId: "guild-version",
      featureKey: "custom",
      enabled: true,
      configJson: { revision: 1 },
    });

    await expect(repository.upsertFeatureFlag({
      guildDiscordId: "guild-version",
      featureKey: "custom",
      enabled: false,
      configJson: { revision: 2 },
      expectedVersion: initial.current.version + 1,
    })).rejects.toMatchObject({ code: "FEATURE_VERSION_CONFLICT", statusCode: 409 });

    const settings = await repository.getGuildSettings("guild-version");
    expect(settings?.features.find((feature) => feature.featureKey === "custom")).toMatchObject({
      enabled: true,
      configJson: { revision: 1 },
      version: 1,
    });
  });

  it("serializes concurrent owner demotions and preserves exactly one owner", async () => {
    const guild = await bootstrapGuild("guild-owners", "owner-one");
    const ownerOne = await repository.getUserByDiscordId("owner-one");
    const ownerTwo = await repository.upsertUserFromDiscord({ discordUserId: "owner-two", username: "owner-two" }, false);
    expect(ownerOne).not.toBeNull();
    await prisma.guildMember.create({
      data: {
        guildId: guild.guild.id,
        userId: ownerTwo.id,
        tenantRole: "OWNER",
        status: "ACTIVE",
      },
    });

    const results = await Promise.allSettled([
      repository.updateGuildMemberRole({ guildDiscordId: "guild-owners", targetUserId: ownerOne!.id, role: "ADMIN" }),
      repository.updateGuildMemberRole({ guildDiscordId: "guild-owners", targetUserId: ownerTwo.id, role: "ADMIN" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(ApiError);
      expect(rejected.reason).toMatchObject({ code: "LAST_OWNER_PROTECTED" });
    }
    expect(await prisma.guildMember.count({
      where: { guildId: guild.guild.id, tenantRole: "OWNER", status: "ACTIVE" },
    })).toBe(1);
  });

  it("paginates members without crossing guild boundaries", async () => {
    const guild = await bootstrapGuild("guild-page", "owner-page");
    await bootstrapGuild("guild-other", "owner-other");
    for (const index of [1, 2, 3]) {
      const user = await repository.upsertUserFromDiscord({
        discordUserId: `member-${index}`,
        username: `member-${index}`,
      }, false);
      await prisma.guildMember.create({
        data: { guildId: guild.guild.id, userId: user.id, tenantRole: "USER", status: "ACTIVE" },
      });
    }

    const first = await repository.listGuildMembers("guild-page", 2);
    const second = await repository.listGuildMembers("guild-page", 2, first.nextCursor);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeUndefined();
    expect([...first.items, ...second.items].map((member) => member.discordUserId)).not.toContain("owner-other");
  });

  it("persists platform AI policy and exposes it in the platform guild directory", async () => {
    await bootstrapGuild("guild-platform-policy", "owner-platform-policy");

    const updated = await repository.updateLlmGuildSettings({
      guildDiscordId: "guild-platform-policy",
      enabled: true,
      platformEnabled: false,
      defaultModel: "gpt-5.6-terra",
    });
    expect(updated.settings).toMatchObject({
      enabled: true,
      platformEnabled: false,
      defaultModel: "gpt-5.6-terra",
    });

    const directory = await repository.listPlatformGuilds({
      limit: 10,
      search: "platform-policy",
    });
    expect(directory.items).toEqual([
      expect.objectContaining({
        guildId: "guild-platform-policy",
        guildAiEnabled: true,
        platformAiEnabled: false,
        effectiveAiEnabled: false,
        defaultModel: "gpt-5.6-terra",
      }),
    ]);
  });

  it("creates selected guild memberships and lists only active administrators", async () => {
    await bootstrapGuild("guild-admins", "owner-admins");
    const target = await repository.upsertUserFromDiscord({
      discordUserId: "selected-admin",
      username: "selected-admin",
    }, false);

    const created = await repository.upsertGuildMembership("guild-admins", target.id);
    expect(created).toMatchObject({
      created: true,
      membership: { tenantRole: "USER", status: "ACTIVE" },
    });
    await repository.updateGuildMemberRole({
      guildDiscordId: "guild-admins",
      targetUserId: target.id,
      role: "ADMIN",
    });

    const administrators = await repository.listGuildAdministrators("guild-admins");
    expect(administrators.map((member) => [member.discordUserId, member.tenantRole])).toEqual([
      ["owner-admins", "OWNER"],
      ["selected-admin", "ADMIN"],
    ]);
  });

  it("preserves co-owners while reconciling a Discord ownership transfer", async () => {
    const initial = await bootstrapGuild("guild-co-owners", "discord-owner-initial");
    const initialOwner = await repository.getUserByDiscordId("discord-owner-initial");
    const coOwner = await repository.upsertUserFromDiscord({
      discordUserId: "co-owner",
      username: "co-owner",
    }, false);
    expect(initialOwner).not.toBeNull();

    await repository.upsertGuildMembership("guild-co-owners", coOwner.id);
    await repository.updateGuildMemberRole({
      guildDiscordId: "guild-co-owners",
      targetUserId: coOwner.id,
      role: "OWNER",
    });

    await bootstrapGuild("guild-co-owners", "discord-owner-initial");
    expect(await repository.ensureGuildMembership("guild-co-owners", coOwner.id)).toMatchObject({
      membership: { tenantRole: "OWNER", status: "ACTIVE" },
    });

    await bootstrapGuild("guild-co-owners", "discord-owner-transferred");
    const transferredOwner = await repository.getUserByDiscordId("discord-owner-transferred");
    expect(transferredOwner).not.toBeNull();
    expect(await repository.ensureGuildMembership("guild-co-owners", initialOwner!.id)).toMatchObject({
      membership: { tenantRole: "USER", status: "ACTIVE" },
    });
    expect(await repository.ensureGuildMembership("guild-co-owners", coOwner.id)).toMatchObject({
      membership: { tenantRole: "OWNER", status: "ACTIVE" },
    });
    expect(await repository.ensureGuildMembership("guild-co-owners", transferredOwner!.id)).toMatchObject({
      membership: { tenantRole: "OWNER", status: "ACTIVE" },
    });
    expect(await prisma.guildMember.count({
      where: {
        guildId: initial.guild.id,
        tenantRole: "OWNER",
        status: "ACTIVE",
      },
    })).toBe(2);
  });

  it("keeps the persisted owner aligned with concurrent Discord ownership reconciliation", async () => {
    const initial = await bootstrapGuild("guild-owner-reconcile", "owner-initial");
    await repository.bootstrapGuild({
      guildDiscordId: "guild-owner-reconcile",
      guildName: "Guild Owner Reconcile",
      ownerProfile: {
        discordUserId: "owner-transferred",
        username: "owner-transferred",
      },
    });
    await repository.bootstrapGuild({
      guildDiscordId: "guild-owner-reconcile",
      guildName: "Guild Owner Reconcile",
    });

    const initialOwner = await repository.getUserByDiscordId("owner-initial");
    const transferredOwner = await repository.getUserByDiscordId("owner-transferred");
    expect(initialOwner).not.toBeNull();
    expect(transferredOwner).not.toBeNull();
    expect(await repository.ensureGuildMembership("guild-owner-reconcile", initialOwner!.id)).toMatchObject({
      membership: { tenantRole: "USER", status: "ACTIVE" },
    });
    expect(await repository.ensureGuildMembership("guild-owner-reconcile", transferredOwner!.id)).toMatchObject({
      membership: { tenantRole: "OWNER", status: "ACTIVE" },
    });
    expect(await prisma.guild.findUnique({
      where: { id: initial.guild.id },
      select: { ownerDiscordUserId: true },
    })).toEqual({ ownerDiscordUserId: "owner-transferred" });

    await Promise.all([
      repository.bootstrapGuild({
        guildDiscordId: "guild-owner-reconcile",
        guildName: "Guild Owner Reconcile",
        ownerProfile: {
          discordUserId: "owner-concurrent-a",
          username: "owner-concurrent-a",
        },
      }),
      repository.bootstrapGuild({
        guildDiscordId: "guild-owner-reconcile",
        guildName: "Guild Owner Reconcile",
        ownerProfile: {
          discordUserId: "owner-concurrent-b",
          username: "owner-concurrent-b",
        },
      }),
    ]);

    const persistedGuild = await prisma.guild.findUnique({
      where: { id: initial.guild.id },
      select: { ownerDiscordUserId: true },
    });
    const persistedOwner = await repository.getUserByDiscordId(persistedGuild!.ownerDiscordUserId!);
    expect(persistedOwner).not.toBeNull();
    expect(await repository.ensureGuildMembership("guild-owner-reconcile", persistedOwner!.id)).toMatchObject({
      membership: { tenantRole: "OWNER", status: "ACTIVE" },
    });
    expect(await prisma.guildMember.count({
      where: {
        guildId: initial.guild.id,
        tenantRole: "OWNER",
        status: "ACTIVE",
      },
    })).toBe(1);
  });

  it("purges expired LLM data while retaining active conversations", async () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    const guild = await bootstrapGuild("guild-retention", "owner-retention");
    await repository.updateLlmGuildSettings({ guildDiscordId: "guild-retention", retentionDays: 7 });
    const expired = await repository.getOrCreateConversation({
      type: "GUILD_CHANNEL",
      guildDiscordId: "guild-retention",
      channelId: "expired-channel",
    });
    const active = await repository.getOrCreateConversation({
      type: "GUILD_CHANNEL",
      guildDiscordId: "guild-retention",
      channelId: "active-channel",
    });

    await prisma.llmMessage.create({
      data: { id: randomUUID(), conversationId: expired.id, role: "USER", content: "expired" },
    });
    await prisma.llmGeneration.create({
      data: {
        id: randomUUID(),
        conversationId: expired.id,
        guildId: guild.guild.id,
        provider: "openai",
        model: "test-model",
        status: "SUCCESS",
      },
    });
    await prisma.llmModerationEvent.create({
      data: {
        id: randomUUID(),
        conversationId: expired.id,
        guildId: guild.guild.id,
        category: "test",
        action: "allow",
      },
    });
    await prisma.llmConversation.update({
      where: { id: expired.id },
      data: { lastMessageAt: new Date("2026-07-01T00:00:00.000Z") },
    });
    await prisma.llmConversation.update({
      where: { id: active.id },
      data: { lastMessageAt: new Date("2026-07-11T00:00:00.000Z") },
    });

    await expect(repository.purgeExpiredLlmData(now)).resolves.toEqual({
      deletedMessages: 1,
      deletedGenerations: 1,
      deletedModerationEvents: 1,
      deletedConversations: 1,
    });
    expect(await prisma.llmConversation.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.llmConversation.findUnique({ where: { id: active.id } })).not.toBeNull();
  });
});
