import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { LLM_PROMPT_MAX_LENGTH } from "../../src/contracts/llm";
import { loadConfig } from "../../src/lib/config";
import { isApiError } from "../../src/lib/errors";
import { hashToken } from "../../src/lib/ids";
import { hashOpaqueToken } from "../../src/modules/bots/bot-token-crypto";
import { getEffectivePrompts } from "../../src/modules/llm/prompts";
import { PrismaAppRepository } from "../../src/repositories/prisma.repository";

const databaseUrl = process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const repository = new PrismaAppRepository(prisma);

async function createBot(slug: string, applicationId: string) {
  return repository.createBot({
    slug,
    displayName: `Bot ${slug}`,
    discordApplicationId: applicationId,
  });
}

async function expectApiCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(isApiError(error)).toBe(true);
    if (isApiError(error)) expect(error.code).toBe(code);
  }
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "bot_instances", "guilds", "users" CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("multi-bot repository", () => {
  it("isolates two bot installations, conversations, settings, and flags in one guild", async () => {
    const { bot: botA } = await createBot("alpha", "application-alpha");
    const { bot: botB } = await createBot("beta", "application-beta");
    const owner = {
      discordUserId: "owner-1",
      username: "owner",
    };
    const [installA] = await Promise.all([
      repository.bootstrapInstallation({
        botInstanceId: botA.id,
        guildDiscordId: "guild-1",
        guildName: "Shared guild",
        ownerProfile: owner,
      }),
      repository.bootstrapInstallation({
        botInstanceId: botA.id,
        guildDiscordId: "guild-1",
        guildName: "Shared guild",
        ownerProfile: owner,
      }),
    ]);
    const installB = await repository.bootstrapInstallation({
      botInstanceId: botB.id,
      guildDiscordId: "guild-1",
      guildName: "Shared guild",
      ownerProfile: owner,
    });

    expect(installA.guild.id).toBe(installB.guild.id);
    expect(installA.installation.id).not.toBe(installB.installation.id);
    expect(await repository.listGuildBots("guild-1")).toHaveLength(2);

    await repository.updateInstallationSettings({
      botInstanceId: botA.id,
      guildDiscordId: "guild-1",
      assistantPromptOverride: "Only Alpha",
    });
    const [settingsA, settingsB] = await Promise.all([
      repository.getInstallationSettings(botA.id, "guild-1"),
      repository.getInstallationSettings(botB.id, "guild-1"),
    ]);
    expect(settingsA.settings.assistantPromptOverride).toBe("Only Alpha");
    expect(settingsB.settings.assistantPromptOverride).toBeNull();

    await repository.updateCommandManifest({
      botInstanceId: botA.id,
      guildDiscordId: "guild-1",
      hash: "current-manifest",
      errorCode: null,
      syncedAt: new Date(),
    });
    expect(await repository.listPendingCommandSyncs(botA.id)).toHaveLength(0);
    await repository.requestCommandResync(
      botA.id,
      installA.installation.id,
    );
    expect(await repository.listPendingCommandSyncs(botA.id)).toEqual([
      expect.objectContaining({ id: installA.installation.id }),
    ]);

    await repository.upsertFeatureFlag({
      botInstanceId: botA.id,
      guildDiscordId: "guild-1",
      featureKey: "isolated-feature",
      enabled: true,
      configJson: { owner: "alpha" },
    });
    expect(
      await repository.getFeatureFlag(botB.id, "guild-1", "isolated-feature"),
    ).toBeNull();

    const conversationA = await repository.getOrCreateConversation({
      botInstanceId: botA.id,
      type: "GUILD_CHANNEL",
      guildDiscordId: "guild-1",
      channelId: "channel-1",
    });
    const conversationB = await repository.getOrCreateConversation({
      botInstanceId: botB.id,
      type: "GUILD_CHANNEL",
      guildDiscordId: "guild-1",
      channelId: "channel-1",
    });
    const dmA = await repository.getOrCreateConversation({
      botInstanceId: botA.id,
      type: "DM",
      discordUserId: "user-1",
    });
    const dmB = await repository.getOrCreateConversation({
      botInstanceId: botB.id,
      type: "DM",
      discordUserId: "user-1",
    });
    expect(conversationA.id).not.toBe(conversationB.id);
    expect(dmA.id).not.toBe(dmB.id);

    await expect(
      prisma.llmConversation.create({
        data: {
          id: randomUUID(),
          botInstanceId: botA.id,
          botInstallationId: installB.installation.id,
          discordChannelId: "cross-bot",
          type: "GUILD_CHANNEL",
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.llmConversation.create({
        data: {
          id: randomUUID(),
          botInstanceId: botA.id,
          botInstallationId: installA.installation.id,
          discordChannelId: "invalid-dm",
          discordUserId: "user-1",
          type: "DM",
        },
      }),
    ).rejects.toThrow();
  });

  it("fences leases, supports claim recovery, and revokes on token rotation", async () => {
    const { bot } = await createBot("lease-bot", "application-lease");
    await repository.configureBotToken({
      botInstanceId: bot.id,
      ciphertext: Buffer.from("ciphertext"),
      nonce: Buffer.alloc(12, 1),
      authenticationTag: Buffer.alloc(16, 2),
      encryptionKeyVersion: 1,
      rotatedAt: new Date(),
    });
    await repository.updateBot({
      botInstanceId: bot.id,
      desiredStatus: "ACTIVE",
    });

    const now = new Date();
    const first = await repository.claimRuntime({
      botInstanceId: bot.id,
      runtimeInstanceId: "runtime-a",
      claimRequestId: "11111111-1111-4111-8111-111111111111",
      leaseToken: "lease-one",
      leaseTokenHash: "hash-one",
      now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const recovery = await repository.claimRuntime({
      botInstanceId: bot.id,
      runtimeInstanceId: "runtime-a",
      claimRequestId: "11111111-1111-4111-8111-111111111111",
      leaseToken: "lease-two",
      leaseTokenHash: "hash-two",
      now: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 61_000),
    });
    expect(recovery.lease.leaseGeneration).toBe(first.lease.leaseGeneration);

    await expectApiCode(
      repository.validateRuntimeLease({
        botInstanceId: bot.id,
        leaseGeneration: first.lease.leaseGeneration,
        leaseTokenHash: "hash-one",
        now: new Date(now.getTime() + 2_000),
      }),
      "BOT_LEASE_REVOKED",
    );
    await expectApiCode(
      repository.claimRuntime({
        botInstanceId: bot.id,
        runtimeInstanceId: "runtime-a",
        claimRequestId: "22222222-2222-4222-8222-222222222222",
        leaseToken: "unused",
        leaseTokenHash: "unused",
        now: new Date(now.getTime() + 2_000),
        expiresAt: new Date(now.getTime() + 62_000),
      }),
      "BOT_LEASE_ALREADY_OWNED",
    );
    await expectApiCode(
      repository.claimRuntime({
        botInstanceId: bot.id,
        runtimeInstanceId: "runtime-b",
        claimRequestId: "33333333-3333-4333-8333-333333333333",
        leaseToken: "unused",
        leaseTokenHash: "unused",
        now: new Date(now.getTime() + 2_000),
        expiresAt: new Date(now.getTime() + 62_000),
      }),
      "BOT_LEASE_CONFLICT",
    );

    await repository.configureBotToken({
      botInstanceId: bot.id,
      ciphertext: Buffer.from("rotated"),
      nonce: Buffer.alloc(12, 3),
      authenticationTag: Buffer.alloc(16, 4),
      encryptionKeyVersion: 1,
      rotatedAt: new Date(now.getTime() + 3_000),
    });
    await expectApiCode(
      repository.validateRuntimeLease({
        botInstanceId: bot.id,
        leaseGeneration: recovery.lease.leaseGeneration,
        leaseTokenHash: "hash-two",
        now: new Date(now.getTime() + 4_000),
      }),
      "BOT_LEASE_REVOKED",
    );
  });

  it("resolves profile inheritance, preserves installation controls, and transfers ownership", async () => {
    const { bot } = await createBot("domain-bot", "application-domain");
    await expect(
      createBot("duplicate-application", "application-domain"),
    ).rejects.toThrow();
    await repository.updateBotProfile({
      botInstanceId: bot.id,
      defaultModel: "gpt-4.1-mini",
      assistantPrompt: "Profile prompt",
      gatekeeperPrompt: "Profile gatekeeper",
      dmEnabled: true,
      retentionDays: 45,
      maxInputChars: 5_000,
      maxOutputTokens: 700,
    });

    const first = await repository.bootstrapInstallation({
      botInstanceId: bot.id,
      guildDiscordId: "domain-guild-a",
      guildName: "Domain Guild A",
      ownerProfile: { discordUserId: "owner-a", username: "owner-a" },
    });
    await repository.bootstrapInstallation({
      botInstanceId: bot.id,
      guildDiscordId: "domain-guild-b",
      guildName: "Domain Guild B",
      ownerProfile: { discordUserId: "owner-b", username: "owner-b" },
    });
    await repository.updateInstallationSettings({
      botInstanceId: bot.id,
      guildDiscordId: "domain-guild-a",
      assistantPromptOverride: "Guild A prompt",
      retentionDaysOverride: 10,
    });

    const [guildA, guildB, dm] = await Promise.all([
      repository.getEffectiveBotSettings({
        botInstanceId: bot.id,
        guildDiscordId: "domain-guild-a",
      }),
      repository.getEffectiveBotSettings({
        botInstanceId: bot.id,
        guildDiscordId: "domain-guild-b",
      }),
      repository.getEffectiveBotSettings({ botInstanceId: bot.id }),
    ]);
    expect(guildA).toMatchObject({
      assistantPrompt: "Guild A prompt",
      gatekeeperPrompt: "Profile gatekeeper",
      retentionDays: 10,
    });
    expect(guildB).toMatchObject({
      assistantPrompt: "Profile prompt",
      retentionDays: 45,
    });
    expect(dm).toMatchObject({
      assistantPrompt: "Profile prompt",
      dmEnabled: true,
    });

    await repository.updateInstallationOperationalStatus({
      botInstanceId: bot.id,
      guildDiscordId: "domain-guild-a",
      operationalStatus: "DISABLED",
    });
    await repository.markInstallationLeft({
      botInstanceId: bot.id,
      guildDiscordId: "domain-guild-a",
    });
    const reinstalled = await repository.bootstrapInstallation({
      botInstanceId: bot.id,
      guildDiscordId: "domain-guild-a",
      guildName: "Domain Guild A",
      ownerProfile: { discordUserId: "owner-c", username: "owner-c" },
    });
    expect(reinstalled.installation).toMatchObject({
      id: first.installation.id,
      presenceStatus: "PRESENT",
      operationalStatus: "DISABLED",
    });

    const [previousOwner, currentOwner] = await Promise.all([
      repository.getMembershipByDiscordUser("domain-guild-a", "owner-a"),
      repository.getMembershipByDiscordUser("domain-guild-a", "owner-c"),
    ]);
    expect(previousOwner?.tenantRole).toBe("USER");
    expect(currentOwner?.tenantRole).toBe("OWNER");
    await expectApiCode(
      repository.updateGuildMemberRole({
        guildDiscordId: "domain-guild-a",
        targetUserId: currentOwner!.userId,
        role: "USER",
      }),
      "LAST_OWNER_PROTECTED",
    );
    const audit = await repository.listAuditLogs({
      guildDiscordId: "domain-guild-a",
      botInstanceId: bot.id,
      limit: 20,
    });
    expect(audit.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "guild.owner.transferred" }),
      ]),
    );
  });

  it("deduplicates event receipts and fences completion by generation", async () => {
    const { bot } = await createBot("receipt-bot", "application-receipt");
    const now = new Date();
    const first = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });
    const duplicate = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      now: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });
    expect(first.acquired).toBe(true);
    expect(duplicate.acquired).toBe(false);
    expect(duplicate.receipt.id).toBe(first.receipt.id);

    await expectApiCode(
      repository.completeDiscordEvent({
        receiptId: first.receipt.id,
        botInstanceId: bot.id,
        leaseGeneration: 5,
      }),
      "BOT_LEASE_GENERATION_MISMATCH",
    );
    await repository.completeDiscordEvent({
      receiptId: first.receipt.id,
      botInstanceId: bot.id,
      leaseGeneration: 4,
    });
    const completed = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      now: new Date(now.getTime() + 120_000),
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() + 60_000),
      maxAttempts: 3,
    });
    expect(completed.acquired).toBe(false);
    expect(completed.receipt.processingStatus).toBe("COMPLETED");

    await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "expired-message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      now,
      expiresAt: new Date(now.getTime() - 2_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });
    await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "expired-message-2",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      now,
      expiresAt: new Date(now.getTime() - 1_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });
    await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "future-message",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });

    expect(await repository.purgeExpiredDiscordEventReceipts(now, 1)).toBe(1);
    expect(await prisma.discordEventReceipt.count({
      where: { expiresAt: { lte: now } },
    })).toBe(1);
    expect(await repository.purgeExpiredDiscordEventReceipts(now, 1)).toBe(1);
    expect(await prisma.discordEventReceipt.count({
      where: { expiresAt: { lte: now } },
    })).toBe(0);
    expect(await prisma.discordEventReceipt.count({
      where: { discordEventId: "future-message" },
    })).toBe(1);
  });
});

describe("multi-bot API contracts", () => {
  it("separates platform, pool, and bot-lease credentials without leaking tokens", async () => {
    const poolCredential = "pool-bootstrap-credential-at-least-32-characters";
    const sessionToken = "platform-session";
    const csrfToken = "csrf-token";
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: "test-session-secret-at-least-32-characters",
      PLATFORM_ADMIN_DISCORD_IDS: "platform-admin",
      BOT_POOL_BOOTSTRAP_KEY_HASH: hashOpaqueToken(poolCredential),
      PGBOSS_ENABLED: "false",
      LLM_ENABLED: "true",
    });
    const app = await buildApp({ config, repository });
    await app.ready();

    try {
      const user = await repository.upsertUserFromDiscord(
        { discordUserId: "platform-admin", username: "admin" },
        true,
      );
      await repository.createSession({
        userId: user.id,
        sessionTokenHash: hashToken(sessionToken, config.sessionSecret),
        expiresAt: new Date(Date.now() + 60_000),
      });
      const browserHeaders = {
        cookie: `${config.sessionCookieName}=${sessionToken}; ${config.csrfCookieName}=${csrfToken}`,
        "x-csrf-token": csrfToken,
      };

      const createResponse = await app.inject({
        method: "POST",
        url: "/api/v1/platform/bots",
        headers: browserHeaders,
        payload: {
          slug: "api-bot",
          displayName: "API Bot",
          discordApplicationId: "987654321",
        },
      });
      expect(createResponse.statusCode).toBe(200);
      const botId = createResponse.json().bot.id as string;

      const immutablePatch = await app.inject({
        method: "PATCH",
        url: `/api/v1/platform/bots/${botId}`,
        headers: browserHeaders,
        payload: { discordApplicationId: "changed" },
      });
      expect(immutablePatch.statusCode).toBe(400);

      const discordToken = "discord-token-never-returned-from-admin-routes";
      const tokenResponse = await app.inject({
        method: "PUT",
        url: `/api/v1/platform/bots/${botId}/token`,
        headers: browserHeaders,
        payload: { token: discordToken },
      });
      expect(tokenResponse.statusCode).toBe(200);
      expect(tokenResponse.headers["cache-control"]).toBe("no-store");
      expect(tokenResponse.body).not.toContain(discordToken);

      const activate = await app.inject({
        method: "PATCH",
        url: `/api/v1/platform/bots/${botId}`,
        headers: browserHeaders,
        payload: { desiredStatus: "ACTIVE" },
      });
      expect(activate.statusCode).toBe(200);

      const foreignInstallation = await repository.bootstrapInstallation({
        botInstanceId: botId,
        guildDiscordId: "foreign-guild",
        guildName: "Foreign Guild",
        ownerProfile: { discordUserId: "foreign-owner", username: "owner" },
      });
      const platformPolicy = await app.inject({
        method: "PATCH",
        url: `/api/v1/platform/bots/${botId}/installations/${foreignInstallation.installation.id}/policy`,
        headers: browserHeaders,
        payload: { llmEnabledByPlatform: false },
      });
      expect(platformPolicy.statusCode).toBe(200);
      const fabricatedGuildAccess = await app.inject({
        method: "PATCH",
        url: `/api/v1/guilds/foreign-guild/bots/${botId}/llm/settings`,
        headers: browserHeaders,
        payload: { llmEnabledByGuild: false },
      });
      expect(fabricatedGuildAccess.statusCode).toBe(403);

      const deniedAssignments = await app.inject({
        method: "GET",
        url: "/api/v1/internal/runtime/assignments",
        headers: { authorization: "Bearer wrong-credential" },
      });
      expect(deniedAssignments.statusCode).toBe(401);

      const assignments = await app.inject({
        method: "GET",
        url: "/api/v1/internal/runtime/assignments",
        headers: { authorization: `Bearer ${poolCredential}` },
      });
      expect(assignments.statusCode).toBe(200);
      expect(assignments.body).not.toContain(discordToken);

      const claim = await app.inject({
        method: "POST",
        url: `/api/v1/internal/runtime/assignments/${botId}/claim`,
        headers: { authorization: `Bearer ${poolCredential}` },
        payload: {
          runtimeInstanceId: "integration-runtime",
          claimRequestId: "44444444-4444-4444-8444-444444444444",
        },
      });
      expect(claim.statusCode).toBe(200);
      expect(claim.headers["cache-control"]).toBe("no-store");
      const claimBody = claim.json();
      expect(claimBody.discordToken).toBe(discordToken);

      const leaseHeaders = {
        authorization: `Bearer ${claimBody.leaseToken as string}`,
        "x-bot-instance-id": botId,
        "x-bot-lease-generation": String(claimBody.lease.leaseGeneration),
      };
      const poolWithLease = await app.inject({
        method: "GET",
        url: "/api/v1/internal/runtime/assignments",
        headers: leaseHeaders,
      });
      expect(poolWithLease.statusCode).toBe(401);

      const second = await repository.createBot({
        slug: "other-api-bot",
        displayName: "Other Bot",
        discordApplicationId: "123456789",
      });
      const crossBotHeartbeat = await app.inject({
        method: "POST",
        url: `/api/v1/internal/runtime/assignments/${second.bot.id}/heartbeat`,
        headers: leaseHeaders,
        payload: { runtimeState: "READY" },
      });
      expect(crossBotHeartbeat.statusCode).toBe(403);

      const installation = await repository.bootstrapInstallation({
        botInstanceId: botId,
        guildDiscordId: "api-guild",
        guildName: "API Guild",
        ownerProfile: { discordUserId: "platform-admin", username: "admin" },
      });
      const inheritedPrompts = await app.inject({
        method: "GET",
        url: `/api/v1/guilds/api-guild/bots/${botId}/settings`,
        headers: browserHeaders,
      });
      expect(inheritedPrompts.statusCode).toBe(200);
      expect(inheritedPrompts.json()).toMatchObject({
        settings: {
          assistantPromptOverride: null,
          gatekeeperPromptOverride: null,
        },
        effective: {
          assistantPrompt: null,
          gatekeeperPrompt: null,
        },
        effectiveAiEnabled: false,
        effectivePrompts: getEffectivePrompts({
          assistantPrompt: null,
          gatekeeperPrompt: null,
        }),
      });

      const promptAtLimit = "a".repeat(LLM_PROMPT_MAX_LENGTH);
      const acceptedPrompt = await app.inject({
        method: "PATCH",
        url: `/api/v1/guilds/api-guild/bots/${botId}/llm/settings`,
        headers: browserHeaders,
        payload: {
          llmEnabledByGuild: true,
          assistantPromptOverride: promptAtLimit,
        },
      });
      expect(acceptedPrompt.statusCode).toBe(200);
      expect(acceptedPrompt.json().settings.assistantPromptOverride).toBe(promptAtLimit);
      expect(acceptedPrompt.json().effectiveAiEnabled).toBe(true);
      const guildPromptAudit = (await repository.listAuditLogs({
        guildDiscordId: "api-guild",
        botInstanceId: botId,
        action: "bot.installation.llm_settings.updated",
        limit: 10,
      })).items[0];
      expect(guildPromptAudit).toMatchObject({
        before: {
          assistantPromptOverride: {
            configured: false,
            length: 0,
            sha256: null,
          },
        },
        after: {
          assistantPromptOverride: {
            configured: true,
            length: LLM_PROMPT_MAX_LENGTH,
            sha256: expect.any(String),
          },
        },
      });
      expect(JSON.stringify(guildPromptAudit)).not.toContain(promptAtLimit);

      const installationPolicy = await app.inject({
        method: "PATCH",
        url: `/api/v1/platform/bots/${botId}/installations/${installation.installation.id}/policy`,
        headers: browserHeaders,
        payload: { modelOverride: "gpt-4.1-mini" },
      });
      expect(installationPolicy.statusCode).toBe(200);
      const installationPolicyAudit = (await repository.listAuditLogs({
        guildDiscordId: "api-guild",
        botInstanceId: botId,
        action: "bot.installation.platform_policy.updated",
        limit: 10,
      })).items[0];
      expect(installationPolicyAudit).toMatchObject({
        before: {
          assistantPromptOverride: {
            configured: true,
            length: LLM_PROMPT_MAX_LENGTH,
            sha256: expect.any(String),
          },
        },
        after: {
          assistantPromptOverride: {
            configured: true,
            length: LLM_PROMPT_MAX_LENGTH,
            sha256: expect.any(String),
          },
        },
      });
      expect(JSON.stringify(installationPolicyAudit)).not.toContain(promptAtLimit);

      const rejectedPrompt = await app.inject({
        method: "PATCH",
        url: `/api/v1/guilds/api-guild/bots/${botId}/llm/settings`,
        headers: browserHeaders,
        payload: { assistantPromptOverride: `${promptAtLimit}a` },
      });
      expect(rejectedPrompt.statusCode).toBe(400);

      const settingsMutation = await app.inject({
        method: "PATCH",
        url: "/api/v1/internal/guilds/api-guild/llm/settings",
        headers: leaseHeaders,
        payload: {
          actorDiscordUserId: "platform-admin",
          commandKey: "ai.retention",
          gatekeeperPromptOverride: "internal-prompt-audit-secret",
          retentionDaysOverride: 45,
        },
      });
      expect(settingsMutation.statusCode).toBe(200);
      expect(settingsMutation.json()).toMatchObject({
        installation: {
          id: installation.installation.id,
          guildId: installation.installation.guildId,
          guildDiscordId: "api-guild",
          guildName: "API Guild",
        },
        settings: { retentionDaysOverride: 45 },
        effective: { retentionDays: 45 },
        effectiveAiEnabled: true,
        effectivePrompts: getEffectivePrompts({
          assistantPrompt: promptAtLimit,
          gatekeeperPrompt: "internal-prompt-audit-secret",
        }),
      });
      const settingsAudits = await repository.listAuditLogs({
        guildDiscordId: "api-guild",
        botInstanceId: botId,
        action: "bot.installation.llm_settings.updated",
        limit: 10,
      });
      const settingsAudit = settingsAudits.items.find(
        (item) => item.metadata.commandKey === "ai.retention",
      );
      expect(settingsAudit).toMatchObject({
        guildId: installation.guild.id,
        botInstanceId: botId,
        botInstallationId: installation.installation.id,
        actorUserId: user.id,
        actorType: "PLATFORM_ADMIN",
        entityType: "llm_installation_settings",
        entityId: settingsMutation.json().settings.id,
        before: {
          gatekeeperPromptOverride: {
            configured: false,
            length: 0,
            sha256: null,
          },
        },
        after: {
          gatekeeperPromptOverride: {
            configured: true,
            length: "internal-prompt-audit-secret".length,
            sha256: expect.any(String),
          },
        },
      });
      expect(JSON.stringify(settingsAudit)).not.toContain("internal-prompt-audit-secret");
      expect(JSON.stringify(settingsAudit)).not.toContain(promptAtLimit);

      const channelEnable = await app.inject({
        method: "POST",
        url: "/api/v1/internal/guilds/api-guild/llm/channels/enable",
        headers: leaseHeaders,
        payload: {
          actorDiscordUserId: "platform-admin",
          channelId: "audit-channel",
        },
      });
      expect(channelEnable.statusCode).toBe(200);
      const channelAudit = (await repository.listAuditLogs({
        guildDiscordId: "api-guild",
        botInstanceId: botId,
        action: "bot.installation.llm_channel.updated",
        limit: 10,
      })).items.find((item) => item.metadata.channelId === "audit-channel");
      expect(channelAudit).toMatchObject({
        guildId: installation.guild.id,
        botInstanceId: botId,
        botInstallationId: installation.installation.id,
        actorUserId: user.id,
        actorType: "PLATFORM_ADMIN",
        entityType: "llm_channel_settings",
        entityId: channelEnable.json().channel.id,
        before: null,
        after: {
          discordChannelId: "audit-channel",
          enabled: true,
        },
      });

      const memoryClear = await app.inject({
        method: "POST",
        url: "/api/v1/internal/guilds/api-guild/llm/channels/memory/clear",
        headers: leaseHeaders,
        payload: {
          actorDiscordUserId: "platform-admin",
          channelId: "audit-channel",
        },
      });
      expect(memoryClear.statusCode).toBe(200);
      expect(memoryClear.json()).toEqual({
        deletedMessages: 0,
        deletedConversations: 0,
      });
      const memoryAudit = (await repository.listAuditLogs({
        guildDiscordId: "api-guild",
        botInstanceId: botId,
        action: "bot.installation.llm_memory.cleared",
        limit: 10,
      })).items.find((item) => item.metadata.channelId === "audit-channel");
      expect(memoryAudit).toMatchObject({
        guildId: installation.guild.id,
        botInstanceId: botId,
        botInstallationId: installation.installation.id,
        actorUserId: user.id,
        actorType: "PLATFORM_ADMIN",
        entityType: "llm_channel",
        entityId: "audit-channel",
        after: {
          deletedMessages: 0,
          deletedConversations: 0,
        },
      });

      const adminTarget = {
        discordUserId: "audit-admin-target",
        username: "audit-admin-target",
      };
      const addAdmin = await app.inject({
        method: "POST",
        url: "/api/v1/internal/guilds/api-guild/admins/add",
        headers: leaseHeaders,
        payload: {
          actorDiscordUserId: "platform-admin",
          target: adminTarget,
        },
      });
      expect(addAdmin.statusCode).toBe(200);
      expect(addAdmin.json()).toMatchObject({
        changed: true,
        membership: { tenantRole: "ADMIN" },
      });
      const addedAdminAudit = (await repository.listAuditLogs({
        guildDiscordId: "api-guild",
        botInstanceId: botId,
        action: "member.admin.added",
        limit: 10,
      })).items[0];
      expect(addedAdminAudit).toMatchObject({
        guildId: installation.guild.id,
        botInstanceId: botId,
        botInstallationId: installation.installation.id,
        actorUserId: user.id,
        actorType: "PLATFORM_ADMIN",
        entityType: "guild_member",
        before: { tenantRole: "USER" },
        after: { tenantRole: "ADMIN" },
        metadata: {
          commandKey: "settings.admin.add",
          targetDiscordUserId: adminTarget.discordUserId,
          membershipCreated: true,
        },
      });

      const removeAdmin = await app.inject({
        method: "POST",
        url: "/api/v1/internal/guilds/api-guild/admins/remove",
        headers: leaseHeaders,
        payload: {
          actorDiscordUserId: "platform-admin",
          target: adminTarget,
        },
      });
      expect(removeAdmin.statusCode).toBe(200);
      expect(removeAdmin.json()).toMatchObject({
        changed: true,
        membership: { tenantRole: "USER" },
      });
      const removedAdminAudit = (await repository.listAuditLogs({
        guildDiscordId: "api-guild",
        botInstanceId: botId,
        action: "member.admin.removed",
        limit: 10,
      })).items[0];
      expect(removedAdminAudit).toMatchObject({
        guildId: installation.guild.id,
        botInstanceId: botId,
        botInstallationId: installation.installation.id,
        actorUserId: user.id,
        actorType: "PLATFORM_ADMIN",
        entityType: "guild_member",
        before: { tenantRole: "ADMIN" },
        after: { tenantRole: "USER" },
      });

      const missingAdminTarget = {
        discordUserId: "missing-admin-target",
        username: "missing-admin-target",
      };
      const removeMissingAdmin = await app.inject({
        method: "POST",
        url: "/api/v1/internal/guilds/api-guild/admins/remove",
        headers: leaseHeaders,
        payload: {
          actorDiscordUserId: "platform-admin",
          target: missingAdminTarget,
        },
      });
      expect(removeMissingAdmin.statusCode).toBe(200);
      expect(removeMissingAdmin.json()).toEqual({
        changed: false,
        reason: "NOT_ADMIN",
        membership: null,
      });
      expect(await repository.getUserByDiscordId(missingAdminTarget.discordUserId)).toBeNull();

      const targetUser = await repository.getUserByDiscordId(adminTarget.discordUserId);
      expect(targetUser).not.toBeNull();
      const roleMutation = await app.inject({
        method: "PUT",
        url: `/api/v1/guilds/api-guild/roles/${targetUser!.id}`,
        headers: browserHeaders,
        payload: { role: "MODERATOR" },
      });
      expect(roleMutation.statusCode).toBe(200);
      expect(roleMutation.json()).toMatchObject({
        before: { tenantRole: "USER" },
        after: { tenantRole: "MODERATOR" },
      });
      const roleAudit = (await repository.listAuditLogs({
        guildDiscordId: "api-guild",
        action: "member.role.updated",
        limit: 10,
      })).items[0];
      expect(roleAudit).toMatchObject({
        guildId: installation.guild.id,
        botInstanceId: null,
        botInstallationId: null,
        actorUserId: user.id,
        actorType: "PLATFORM_ADMIN",
        entityType: "guild_member",
        entityId: `${installation.guild.id}:${targetUser!.id}`,
        before: { tenantRole: "USER" },
        after: { tenantRole: "MODERATOR" },
      });

      const removeModerator = await app.inject({
        method: "POST",
        url: "/api/v1/internal/guilds/api-guild/admins/remove",
        headers: leaseHeaders,
        payload: {
          actorDiscordUserId: "platform-admin",
          target: adminTarget,
        },
      });
      expect(removeModerator.statusCode).toBe(200);
      expect(removeModerator.json()).toMatchObject({
        changed: false,
        reason: "NOT_ADMIN",
        membership: { tenantRole: "MODERATOR", status: "ACTIVE" },
      });
      expect(await repository.getMembershipByDiscordUser(
        "api-guild",
        adminTarget.discordUserId,
      )).toMatchObject({
        tenantRole: "MODERATOR",
        status: "ACTIVE",
      });

      await prisma.guildMember.update({
        where: {
          guildId_userId: {
            guildId: installation.guild.id,
            userId: targetUser!.id,
          },
        },
        data: { status: "REMOVED" },
      });
      const removeInactiveModerator = await app.inject({
        method: "POST",
        url: "/api/v1/internal/guilds/api-guild/admins/remove",
        headers: leaseHeaders,
        payload: {
          actorDiscordUserId: "platform-admin",
          target: adminTarget,
        },
      });
      expect(removeInactiveModerator.statusCode).toBe(200);
      expect(removeInactiveModerator.json()).toMatchObject({
        changed: false,
        reason: "NOT_ADMIN",
        membership: { tenantRole: "MODERATOR", status: "REMOVED" },
      });
      expect(await repository.getMembershipByDiscordUser(
        "api-guild",
        adminTarget.discordUserId,
      )).toMatchObject({
        tenantRole: "MODERATOR",
        status: "REMOVED",
      });

      await repository.updateCommandManifest({
        botInstanceId: botId,
        guildDiscordId: "api-guild",
        hash: "current-manifest",
        errorCode: null,
        syncedAt: new Date(),
      });
      const forceResync = await app.inject({
        method: "POST",
        url: `/api/v1/platform/bots/${botId}/installations/${installation.installation.id}/commands/resync`,
        headers: browserHeaders,
        payload: {},
      });
      expect(forceResync.statusCode).toBe(200);
      await repository.updateInstallationOperationalStatus({
        botInstanceId: botId,
        guildDiscordId: "api-guild",
        operationalStatus: "DISABLED",
      });
      const pendingManifests = await app.inject({
        method: "GET",
        url: "/api/v1/internal/command-manifests/pending",
        headers: leaseHeaders,
      });
      expect(pendingManifests.statusCode).toBe(200);
      expect(pendingManifests.json().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: installation.installation.id }),
        ]),
      );
      const failedDisabledManifestReport = await app.inject({
        method: "PUT",
        url: "/api/v1/internal/guilds/api-guild/command-manifest",
        headers: leaseHeaders,
        payload: { errorCode: "COMMAND_SYNC_FAILED" },
      });
      expect(failedDisabledManifestReport.statusCode).toBe(200);
      expect(failedDisabledManifestReport.json()).toMatchObject({
        installation: {
          operationalStatus: "DISABLED",
          lastCommandSyncErrorCode: "COMMAND_SYNC_FAILED",
        },
      });
      const successfulDisabledManifestReport = await app.inject({
        method: "PUT",
        url: "/api/v1/internal/guilds/api-guild/command-manifest",
        headers: leaseHeaders,
        payload: {
          hash: "disabled-installation-manifest",
          errorCode: null,
          syncedAt: new Date().toISOString(),
        },
      });
      expect(successfulDisabledManifestReport.statusCode).toBe(200);
      expect(successfulDisabledManifestReport.json()).toMatchObject({
        installation: {
          operationalStatus: "DISABLED",
          lastCommandManifestHash: "disabled-installation-manifest",
          lastCommandSyncErrorCode: null,
        },
      });
      await repository.updateInstallationOperationalStatus({
        botInstanceId: botId,
        guildDiscordId: "api-guild",
        operationalStatus: "ENABLED",
      });
      const forbiddenGuildFields = await app.inject({
        method: "PATCH",
        url: `/api/v1/guilds/api-guild/bots/${botId}/llm/settings`,
        headers: browserHeaders,
        payload: {
          llmEnabledByGuild: true,
          modelOverride: "platform-controlled",
        },
      });
      expect(forbiddenGuildFields.statusCode).toBe(400);

      const disableBot = await app.inject({
        method: "PATCH",
        url: `/api/v1/platform/bots/${botId}`,
        headers: browserHeaders,
        payload: { desiredStatus: "DISABLED" },
      });
      expect(disableBot.statusCode).toBe(200);
      const stoppedBotSettings = await app.inject({
        method: "GET",
        url: `/api/v1/guilds/api-guild/bots/${botId}/settings`,
        headers: browserHeaders,
      });
      expect(stoppedBotSettings.statusCode).toBe(200);
      expect(stoppedBotSettings.json().effectiveAiEnabled).toBe(false);

      const profileAssistantPrompt = "platform profile assistant audit secret";
      const profileGatekeeperPrompt = "platform profile gatekeeper audit secret";
      const profileUpdate = await app.inject({
        method: "PUT",
        url: `/api/v1/platform/bots/${botId}/profile`,
        headers: browserHeaders,
        payload: {
          defaultModel: "gpt-4.1-mini",
          assistantPrompt: profileAssistantPrompt,
          gatekeeperPrompt: profileGatekeeperPrompt,
          dmEnabled: false,
          retentionDays: 30,
          maxInputChars: 4_000,
          maxOutputTokens: 512,
        },
      });
      expect(profileUpdate.statusCode).toBe(200);
      const profileAudit = await prisma.auditLog.findFirst({
        where: {
          botInstanceId: botId,
          action: "bot.profile.updated",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(profileAudit).toMatchObject({
        beforeJson: {
          assistantPrompt: {
            configured: false,
            length: 0,
            sha256: null,
          },
          gatekeeperPrompt: {
            configured: false,
            length: 0,
            sha256: null,
          },
        },
        afterJson: {
          assistantPrompt: {
            configured: true,
            length: profileAssistantPrompt.length,
            sha256: expect.any(String),
          },
          gatekeeperPrompt: {
            configured: true,
            length: profileGatekeeperPrompt.length,
            sha256: expect.any(String),
          },
        },
      });
      expect(JSON.stringify(profileAudit)).not.toContain(profileAssistantPrompt);
      expect(JSON.stringify(profileAudit)).not.toContain(profileGatekeeperPrompt);

      const reactivateForDecryptFailure = await app.inject({
        method: "PATCH",
        url: `/api/v1/platform/bots/${botId}`,
        headers: browserHeaders,
        payload: { desiredStatus: "ACTIVE" },
      });
      expect(reactivateForDecryptFailure.statusCode).toBe(200);

      const tokenSecret = await prisma.botTokenSecret.findUniqueOrThrow({
        where: { botInstanceId: botId },
      });
      expect(config.botTokenEncryptionKeys.has(tokenSecret.encryptionKeyVersion)).toBe(true);
      await prisma.botTokenSecret.update({
        where: { botInstanceId: botId },
        data: { ciphertext: Buffer.from("corrupted-token-ciphertext") },
      });

      const failedDecryptClaim = await app.inject({
        method: "POST",
        url: `/api/v1/internal/runtime/assignments/${botId}/claim`,
        headers: { authorization: `Bearer ${poolCredential}` },
        payload: {
          runtimeInstanceId: "failed-decrypt-runtime",
          claimRequestId: "66666666-6666-4666-8666-666666666666",
        },
      });
      expect(failedDecryptClaim.statusCode).toBe(409);
      expect(failedDecryptClaim.json()).toMatchObject({
        error: { code: "BOT_TOKEN_DECRYPT_FAILED" },
      });
      expect(await repository.getRuntimeLease(botId)).toMatchObject({
        runtimeInstanceId: null,
        claimRequestId: null,
        runtimeState: "STOPPED",
        expiresAt: null,
        claimedTokenVersion: null,
        revokedAt: expect.any(Date),
      });
      expect((await prisma.botRuntimeLease.findUniqueOrThrow({
        where: { botInstanceId: botId },
      })).leaseTokenHash).toBeNull();

      const secondFailedDecryptClaim = await app.inject({
        method: "POST",
        url: `/api/v1/internal/runtime/assignments/${botId}/claim`,
        headers: { authorization: `Bearer ${poolCredential}` },
        payload: {
          runtimeInstanceId: "second-failed-decrypt-runtime",
          claimRequestId: "77777777-7777-4777-8777-777777777777",
        },
      });
      expect(secondFailedDecryptClaim.statusCode).toBe(409);
      expect(secondFailedDecryptClaim.json()).toMatchObject({
        error: { code: "BOT_TOKEN_DECRYPT_FAILED" },
      });
      expect(await repository.getRuntimeLease(botId)).toMatchObject({
        runtimeInstanceId: null,
        claimRequestId: null,
        runtimeState: "STOPPED",
        expiresAt: null,
        revokedAt: expect.any(Date),
      });
    } finally {
      await app.close();
    }
  });
});
