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
    defaultModel: "gpt-4.1-mini",
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

async function waitForBotInstanceLockWait(timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE '%FROM bot_instances%FOR UPDATE%'
      ) AS waiting
    `;
    if (row?.waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

async function waitForBotInstanceLockWaiters(expected: number, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query LIKE '%bot_instances%'
    `;
    if ((row?.waiting ?? 0) >= expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

async function stageReplacementLease(input: {
  botInstanceId: string;
  leaseGeneration: number;
  claimedTokenVersion: number;
  now: Date;
}) {
  let signalLocked!: () => void;
  let allowReplacement!: () => void;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  const canReplace = new Promise<void>((resolve) => {
    allowReplacement = resolve;
  });
  const replacement = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bot_instances WHERE id = ${input.botInstanceId}::uuid FOR UPDATE`;
    signalLocked();
    await canReplace;
    return tx.botRuntimeLease.update({
      where: { botInstanceId: input.botInstanceId },
      data: {
        runtimeInstanceId: "replacement-runtime",
        claimRequestId: "99999999-9999-4999-8999-999999999999",
        leaseGeneration: input.leaseGeneration + 1,
        leaseTokenHash: "replacement-hash",
        runtimeState: "CLAIMED",
        expiresAt: new Date(input.now.getTime() + 120_000),
        lastHeartbeatAt: input.now,
        claimedTokenVersion: input.claimedTokenVersion,
        revokedAt: null,
      },
    });
  });
  await locked;
  return {
    commitReplacement: allowReplacement,
    replacement,
  };
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
  it("revokes a stored platform role when the configured check is false", async () => {
    const profile = {
      discordUserId: "removed-platform-admin",
      username: "removed-admin",
    };

    expect(await repository.upsertUserFromDiscord(profile, true)).toMatchObject({
      platformRole: "PLATFORM_ADMIN",
    });
    expect(await repository.upsertUserFromDiscord(profile, false)).toMatchObject({
      platformRole: "NONE",
    });
    expect(await repository.getUserByDiscordId(profile.discordUserId)).toMatchObject({
      platformRole: "NONE",
    });
  });

  it("reconciles installation presence from a bot's ready guild snapshot", async () => {
    const { bot } = await createBot("snapshot-bot", "snapshot-application");
    const { bot: otherBot } = await createBot("snapshot-other", "snapshot-other-application");
    for (const guildDiscordId of [
      "snapshot-available",
      "snapshot-unavailable",
      "snapshot-missing",
      "snapshot-already-left",
    ]) {
      await repository.bootstrapInstallation({
        botInstanceId: bot.id,
        guildDiscordId,
        guildName: guildDiscordId,
      });
    }
    await repository.bootstrapInstallation({
      botInstanceId: otherBot.id,
      guildDiscordId: "snapshot-other-missing",
      guildName: "snapshot-other-missing",
    });
    const alreadyLeft = await repository.markInstallationLeft({
      botInstanceId: bot.id,
      guildDiscordId: "snapshot-already-left",
    });
    const reconciledAt = new Date("2026-08-05T12:00:00.000Z");

    await expect(repository.reconcileInstallationPresence({
      botInstanceId: bot.id,
      observedGuildDiscordIds: [
        "snapshot-available",
        "snapshot-unavailable",
      ],
      now: reconciledAt,
    })).resolves.toBe(1);

    const installations = new Map(
      (await repository.listBotInstallations(bot.id))
        .map((installation) => [installation.guildDiscordId, installation]),
    );
    expect(installations.get("snapshot-available")?.presenceStatus).toBe("PRESENT");
    expect(installations.get("snapshot-unavailable")?.presenceStatus).toBe("PRESENT");
    expect(installations.get("snapshot-missing")).toMatchObject({
      presenceStatus: "LEFT",
      leftAt: reconciledAt,
    });
    expect(installations.get("snapshot-already-left")).toMatchObject({
      presenceStatus: "LEFT",
      leftAt: alreadyLeft?.leftAt,
    });
    expect(await repository.getInstallation(
      otherBot.id,
      "snapshot-other-missing",
    )).toMatchObject({ presenceStatus: "PRESENT" });

    await expect(repository.reconcileInstallationPresence({
      botInstanceId: otherBot.id,
      observedGuildDiscordIds: [],
      now: reconciledAt,
    })).resolves.toBe(1);
    expect(await repository.getInstallation(
      otherBot.id,
      "snapshot-other-missing",
    )).toMatchObject({
      presenceStatus: "LEFT",
      leftAt: reconciledAt,
    });
  });

  it("rotates failed command syncs behind later pending installations", async () => {
    const { bot } = await createBot("command-rotation", "command-rotation-application");
    const installedAt = new Date("2026-01-01T00:00:00.000Z");
    const installations = Array.from({ length: 26 }, (_, index) => ({
      guildId: randomUUID(),
      installationId: randomUUID(),
      guildDiscordId: `command-rotation-${index.toString().padStart(2, "0")}`,
      timestamp: new Date(installedAt.getTime() + index * 1_000),
    }));
    await prisma.guild.createMany({
      data: installations.map((installation) => ({
        id: installation.guildId,
        discordGuildId: installation.guildDiscordId,
        name: installation.guildDiscordId,
      })),
    });
    await prisma.botInstallation.createMany({
      data: installations.map((installation) => ({
        id: installation.installationId,
        botInstanceId: bot.id,
        guildId: installation.guildId,
        installedAt: installation.timestamp,
        lastSeenAt: installation.timestamp,
        createdAt: installation.timestamp,
        updatedAt: installation.timestamp,
      })),
    });

    expect((await repository.listPendingCommandSyncs(bot.id))
      .map((installation) => installation.guildDiscordId)).toEqual(
      installations.slice(0, 25).map((installation) => installation.guildDiscordId),
    );

    await repository.updateCommandManifest({
      botInstanceId: bot.id,
      guildDiscordId: installations[0]!.guildDiscordId,
      errorCode: "COMMAND_SYNC_FAILED",
    });

    expect((await repository.listPendingCommandSyncs(bot.id))
      .map((installation) => installation.guildDiscordId)).toEqual(
      installations.slice(1).map((installation) => installation.guildDiscordId),
    );
  });

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

  it("fences leases, supports claim recovery, and delays replacement after token rotation", async () => {
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

    const revokedLease = await repository.getRuntimeLease(bot.id);
    expect(revokedLease).toMatchObject({
      runtimeInstanceId: "runtime-a",
      claimRequestId: "11111111-1111-4111-8111-111111111111",
      leaseGeneration: recovery.lease.leaseGeneration,
      runtimeState: "STOPPED",
      expiresAt: new Date(now.getTime() + 61_000),
      claimedTokenVersion: recovery.bot.tokenVersion,
    });
    expect(revokedLease?.revokedAt).toBeInstanceOf(Date);

    await expectApiCode(
      repository.claimRuntime({
        botInstanceId: bot.id,
        runtimeInstanceId: "runtime-b",
        claimRequestId: "44444444-4444-4444-8444-444444444444",
        leaseToken: "lease-three",
        leaseTokenHash: "hash-three",
        now: new Date(now.getTime() + 60_999),
        expiresAt: new Date(now.getTime() + 120_999),
      }),
      "BOT_LEASE_CONFLICT",
    );
    await expectApiCode(
      repository.claimRuntime({
        botInstanceId: bot.id,
        runtimeInstanceId: "runtime-a",
        claimRequestId: "11111111-1111-4111-8111-111111111111",
        leaseToken: "lease-two",
        leaseTokenHash: "hash-two",
        now: new Date(now.getTime() + 61_000),
        expiresAt: new Date(now.getTime() + 121_000),
      }),
      "BOT_LEASE_CONFLICT",
    );

    const replacement = await repository.claimRuntime({
      botInstanceId: bot.id,
      runtimeInstanceId: "runtime-b",
      claimRequestId: "44444444-4444-4444-8444-444444444444",
      leaseToken: "lease-three",
      leaseTokenHash: "hash-three",
      now: new Date(now.getTime() + 61_000),
      expiresAt: new Date(now.getTime() + 121_000),
    });
    expect(replacement.lease).toMatchObject({
      runtimeInstanceId: "runtime-b",
      leaseGeneration: recovery.lease.leaseGeneration + 1,
      runtimeState: "CLAIMED",
      claimedTokenVersion: recovery.bot.tokenVersion + 1,
      revokedAt: null,
    });
  });

  it("preserves the runtime safety deadline across token deletion and status revocation", async () => {
    const now = new Date();
    const scenarios = [
      {
        suffix: "token-deletion",
        revokeAndReactivate: async (botInstanceId: string) => {
          await repository.deleteBotToken(botInstanceId);
          await repository.configureBotToken({
            botInstanceId,
            ciphertext: Buffer.from("replacement-token"),
            nonce: Buffer.alloc(12, 3),
            authenticationTag: Buffer.alloc(16, 4),
            encryptionKeyVersion: 1,
            rotatedAt: new Date(now.getTime() + 1_000),
          });
          await repository.updateBot({
            botInstanceId,
            desiredStatus: "ACTIVE",
          });
        },
      },
      {
        suffix: "status-revocation",
        revokeAndReactivate: async (botInstanceId: string) => {
          await repository.updateBot({
            botInstanceId,
            desiredStatus: "DISABLED",
          });
          await repository.updateBot({
            botInstanceId,
            desiredStatus: "ACTIVE",
          });
        },
      },
    ];

    for (const scenario of scenarios) {
      const { bot } = await createBot(
        `lease-${scenario.suffix}`,
        `application-lease-${scenario.suffix}`,
      );
      await repository.configureBotToken({
        botInstanceId: bot.id,
        ciphertext: Buffer.from(`token-${scenario.suffix}`),
        nonce: Buffer.alloc(12, 1),
        authenticationTag: Buffer.alloc(16, 2),
        encryptionKeyVersion: 1,
        rotatedAt: now,
      });
      await repository.updateBot({
        botInstanceId: bot.id,
        desiredStatus: "ACTIVE",
      });
      const claim = await repository.claimRuntime({
        botInstanceId: bot.id,
        runtimeInstanceId: `runtime-${scenario.suffix}`,
        claimRequestId: randomUUID(),
        leaseToken: `lease-${scenario.suffix}`,
        leaseTokenHash: `hash-${scenario.suffix}`,
        now,
        expiresAt: new Date(now.getTime() + 60_000),
      });

      await scenario.revokeAndReactivate(bot.id);

      expect(await repository.getRuntimeLease(bot.id)).toMatchObject({
        runtimeInstanceId: null,
        claimRequestId: null,
        leaseGeneration: claim.lease.leaseGeneration,
        runtimeState: "STOPPED",
        expiresAt: new Date(now.getTime() + 60_000),
        claimedTokenVersion: null,
        revokedAt: expect.any(Date),
      });
      await expectApiCode(
        repository.claimRuntime({
          botInstanceId: bot.id,
          runtimeInstanceId: `replacement-${scenario.suffix}`,
          claimRequestId: randomUUID(),
          leaseToken: `replacement-lease-${scenario.suffix}`,
          leaseTokenHash: `replacement-hash-${scenario.suffix}`,
          now: new Date(now.getTime() + 59_999),
          expiresAt: new Date(now.getTime() + 119_999),
        }),
        "BOT_LEASE_CONFLICT",
      );

      const replacement = await repository.claimRuntime({
        botInstanceId: bot.id,
        runtimeInstanceId: `replacement-${scenario.suffix}`,
        claimRequestId: randomUUID(),
        leaseToken: `replacement-lease-${scenario.suffix}`,
        leaseTokenHash: `replacement-hash-${scenario.suffix}`,
        now: new Date(now.getTime() + 60_000),
        expiresAt: new Date(now.getTime() + 120_000),
      });
      expect(replacement.lease).toMatchObject({
        runtimeInstanceId: `replacement-${scenario.suffix}`,
        leaseGeneration: claim.lease.leaseGeneration + 1,
        runtimeState: "CLAIMED",
        revokedAt: null,
      });
    }
  });

  it("serializes activation with token deletion", async () => {
    const { bot } = await createBot("activation-race", "application-activation-race");
    await repository.configureBotToken({
      botInstanceId: bot.id,
      ciphertext: Buffer.from("activation-race-ciphertext"),
      nonce: Buffer.alloc(12, 1),
      authenticationTag: Buffer.alloc(16, 2),
      encryptionKeyVersion: 1,
      rotatedAt: new Date(),
    });

    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const canRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bot_instances WHERE id = ${bot.id}::uuid FOR UPDATE`;
      signalLocked();
      await canRelease;
    });
    await locked;

    const deletion = repository.deleteBotToken(bot.id);
    const deletionWaited = await waitForBotInstanceLockWaiters(1);
    const activation = repository.updateBot({
      botInstanceId: bot.id,
      desiredStatus: "ACTIVE",
    }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const activationWaited = await waitForBotInstanceLockWaiters(2);

    releaseLock();
    await blocker;
    await deletion;
    const outcome = await activation;

    expect(deletionWaited).toBe(true);
    expect(activationWaited).toBe(true);
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(isApiError(outcome.error)).toBe(true);
      if (isApiError(outcome.error)) {
        expect(outcome.error.code).toBe("BOT_TOKEN_NOT_CONFIGURED");
      }
    }
    expect(await repository.getBot(bot.id)).toMatchObject({
      desiredStatus: "DRAFT",
      tokenConfigured: false,
    });
  });

  it("serializes heartbeat and release with replacement lease ownership", async () => {
    const now = new Date();
    const createClaimedBot = async (suffix: string) => {
      const { bot } = await createBot(`lease-race-${suffix}`, `application-lease-race-${suffix}`);
      await repository.configureBotToken({
        botInstanceId: bot.id,
        ciphertext: Buffer.from(`ciphertext-${suffix}`),
        nonce: Buffer.alloc(12, 1),
        authenticationTag: Buffer.alloc(16, 2),
        encryptionKeyVersion: 1,
        rotatedAt: now,
      });
      await repository.updateBot({
        botInstanceId: bot.id,
        desiredStatus: "ACTIVE",
      });
      const claim = await repository.claimRuntime({
        botInstanceId: bot.id,
        runtimeInstanceId: `runtime-${suffix}`,
        claimRequestId: randomUUID(),
        leaseToken: `lease-${suffix}`,
        leaseTokenHash: `hash-${suffix}`,
        now,
        expiresAt: new Date(now.getTime() + 60_000),
      });
      return { bot, claim };
    };

    const heartbeatLease = await createClaimedBot("heartbeat");
    const heartbeatReplacement = await stageReplacementLease({
      botInstanceId: heartbeatLease.bot.id,
      leaseGeneration: heartbeatLease.claim.lease.leaseGeneration,
      claimedTokenVersion: heartbeatLease.claim.bot.tokenVersion,
      now: new Date(now.getTime() + 2_000),
    });
    const heartbeatOutcome = repository.heartbeatRuntime({
      botInstanceId: heartbeatLease.bot.id,
      leaseGeneration: heartbeatLease.claim.lease.leaseGeneration,
      leaseTokenHash: "hash-heartbeat",
      now: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 61_000),
      runtimeState: "READY",
    }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const heartbeatWaited = await waitForBotInstanceLockWait();
    heartbeatReplacement.commitReplacement();
    await heartbeatReplacement.replacement;
    const heartbeatResult = await heartbeatOutcome;

    expect(heartbeatWaited).toBe(true);
    expect(heartbeatResult.status).toBe("rejected");
    if (heartbeatResult.status === "rejected") {
      expect(isApiError(heartbeatResult.error)).toBe(true);
      if (isApiError(heartbeatResult.error)) {
        expect(heartbeatResult.error.code).toBe("BOT_LEASE_GENERATION_MISMATCH");
      }
    }
    expect(await prisma.botRuntimeLease.findUnique({
      where: { botInstanceId: heartbeatLease.bot.id },
    })).toMatchObject({
      runtimeInstanceId: "replacement-runtime",
      leaseGeneration: heartbeatLease.claim.lease.leaseGeneration + 1,
      leaseTokenHash: "replacement-hash",
      runtimeState: "CLAIMED",
    });

    const releaseLease = await createClaimedBot("release");
    const releaseReplacement = await stageReplacementLease({
      botInstanceId: releaseLease.bot.id,
      leaseGeneration: releaseLease.claim.lease.leaseGeneration,
      claimedTokenVersion: releaseLease.claim.bot.tokenVersion,
      now: new Date(now.getTime() + 2_000),
    });
    const releaseOutcome = repository.releaseRuntime({
      botInstanceId: releaseLease.bot.id,
      leaseGeneration: releaseLease.claim.lease.leaseGeneration,
      leaseTokenHash: "hash-release",
      now: new Date(now.getTime() + 1_000),
    }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const releaseWaited = await waitForBotInstanceLockWait();
    releaseReplacement.commitReplacement();
    await releaseReplacement.replacement;
    const releaseResult = await releaseOutcome;

    expect(releaseWaited).toBe(true);
    expect(releaseResult.status).toBe("rejected");
    if (releaseResult.status === "rejected") {
      expect(isApiError(releaseResult.error)).toBe(true);
      if (isApiError(releaseResult.error)) {
        expect(releaseResult.error.code).toBe("BOT_LEASE_GENERATION_MISMATCH");
      }
    }
    expect(await prisma.botRuntimeLease.findUnique({
      where: { botInstanceId: releaseLease.bot.id },
    })).toMatchObject({
      runtimeInstanceId: "replacement-runtime",
      leaseGeneration: releaseLease.claim.lease.leaseGeneration + 1,
      leaseTokenHash: "replacement-hash",
      runtimeState: "CLAIMED",
    });
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

  it("grants each Discord bot installer one idempotent ADMIN membership", async () => {
    const { bot } = await createBot("installer-bot", "application-installer");
    const first = await repository.bootstrapInstallation({
      botInstanceId: bot.id,
      guildDiscordId: "installer-guild",
      guildName: "Installer Guild",
      ownerProfile: { discordUserId: "installer-owner", username: "owner" },
      installerProfile: { discordUserId: "installer-admin", username: "installer" },
      installerAuditLogEntryId: "discord-audit-entry-1",
    });

    expect(first).toMatchObject({
      ownerMembershipCreated: true,
      installerMembershipCreated: true,
      installerAdminGranted: true,
      installerDiscordUserId: "installer-admin",
    });
    expect(await repository.getMembershipByDiscordUser(
      "installer-guild",
      "installer-owner",
    )).toMatchObject({
      tenantRole: "OWNER",
      status: "ACTIVE",
    });
    const installerMembership = await repository.getMembershipByDiscordUser(
      "installer-guild",
      "installer-admin",
    );
    expect(installerMembership).toMatchObject({
      tenantRole: "ADMIN",
      status: "ACTIVE",
    });

    await repository.updateGuildMemberRole({
      guildDiscordId: "installer-guild",
      targetUserId: installerMembership!.userId,
      role: "USER",
    });
    const replay = await repository.bootstrapInstallation({
      botInstanceId: bot.id,
      guildDiscordId: "installer-guild",
      guildName: "Installer Guild",
      ownerProfile: { discordUserId: "installer-owner", username: "owner" },
      installerProfile: { discordUserId: "installer-admin", username: "installer" },
      installerAuditLogEntryId: "discord-audit-entry-1",
    });
    expect(replay).toMatchObject({
      installerMembershipCreated: false,
      installerAdminGranted: false,
    });
    expect(await repository.getMembershipByDiscordUser(
      "installer-guild",
      "installer-admin",
    )).toMatchObject({
      tenantRole: "USER",
      status: "ACTIVE",
    });

    const reinstall = await repository.bootstrapInstallation({
      botInstanceId: bot.id,
      guildDiscordId: "installer-guild",
      guildName: "Installer Guild",
      ownerProfile: { discordUserId: "installer-owner", username: "owner" },
      installerProfile: { discordUserId: "installer-admin", username: "installer" },
      installerAuditLogEntryId: "discord-audit-entry-2",
    });
    expect(reinstall.installerAdminGranted).toBe(true);
    expect(await repository.getMembershipByDiscordUser(
      "installer-guild",
      "installer-admin",
    )).toMatchObject({
      tenantRole: "ADMIN",
      status: "ACTIVE",
    });

    const ownerInstalled = await repository.bootstrapInstallation({
      botInstanceId: bot.id,
      guildDiscordId: "owner-installed-guild",
      guildName: "Owner Installed Guild",
      ownerProfile: { discordUserId: "same-user", username: "same" },
      installerProfile: { discordUserId: "same-user", username: "same" },
      installerAuditLogEntryId: "discord-audit-entry-owner",
    });
    expect(ownerInstalled.installerAdminGranted).toBe(false);
    expect(await repository.getMembershipByDiscordUser(
      "owner-installed-guild",
      "same-user",
    )).toMatchObject({
      tenantRole: "OWNER",
      status: "ACTIVE",
    });
  });

  it("maps concurrent owner demotions to last-owner protection", async () => {
    const { bot } = await createBot("owner-race-bot", "application-owner-race");
    await repository.bootstrapInstallation({
      botInstanceId: bot.id,
      guildDiscordId: "owner-race-guild",
      guildName: "Owner Race Guild",
      ownerProfile: { discordUserId: "owner-race-a", username: "owner-race-a" },
    });
    const secondOwner = await repository.upsertUserFromDiscord({
      discordUserId: "owner-race-b",
      username: "owner-race-b",
    }, false);
    const secondMembership = await repository.upsertGuildMembership(
      "owner-race-guild",
      secondOwner.id,
    );
    expect(secondMembership).not.toBeNull();
    await repository.updateGuildMemberRole({
      guildDiscordId: "owner-race-guild",
      targetUserId: secondOwner.id,
      role: "OWNER",
    });
    const firstOwner = await repository.getMembershipByDiscordUser(
      "owner-race-guild",
      "owner-race-a",
    );
    expect(firstOwner).not.toBeNull();

    const outcomes = await Promise.allSettled([
      repository.updateGuildMemberRole({
        guildDiscordId: "owner-race-guild",
        targetUserId: firstOwner!.userId,
        role: "USER",
      }),
      repository.updateGuildMemberRole({
        guildDiscordId: "owner-race-guild",
        targetUserId: secondOwner.id,
        role: "USER",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      expect(isApiError(rejected.reason)).toBe(true);
      if (isApiError(rejected.reason)) {
        expect(rejected.reason.code).toBe("LAST_OWNER_PROTECTED");
      }
    }
    expect(await prisma.guildMember.count({
      where: {
        guild: { discordGuildId: "owner-race-guild" },
        tenantRole: "OWNER",
        status: "ACTIVE",
      },
    })).toBe(1);
  });

  it("idempotently retries event receipts and fences each processing attempt", async () => {
    const { bot } = await createBot("receipt-bot", "application-receipt");
    const now = new Date();
    const firstRequestId = randomUUID();
    const first = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      acquisitionRequestId: firstRequestId,
      now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });
    const acquisitionRetry = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      acquisitionRequestId: firstRequestId,
      now: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });
    const duplicate = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      acquisitionRequestId: randomUUID(),
      now: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });
    expect(first.acquired).toBe(true);
    expect(acquisitionRetry.acquired).toBe(true);
    expect(acquisitionRetry.receipt.attemptCount).toBe(1);
    expect(duplicate.acquired).toBe(false);
    expect(duplicate.receipt.id).toBe(first.receipt.id);

    await expectApiCode(
      repository.completeDiscordEvent({
        receiptId: first.receipt.id,
        botInstanceId: bot.id,
        leaseGeneration: 5,
        acquisitionRequestId: firstRequestId,
      }),
      "EVENT_RECEIPT_OWNERSHIP_MISMATCH",
    );
    await expectApiCode(
      repository.completeDiscordEvent({
        receiptId: first.receipt.id,
        botInstanceId: bot.id,
        leaseGeneration: 4,
        acquisitionRequestId: randomUUID(),
      }),
      "EVENT_RECEIPT_OWNERSHIP_MISMATCH",
    );
    await repository.completeDiscordEvent({
      receiptId: first.receipt.id,
      botInstanceId: bot.id,
      leaseGeneration: 4,
      acquisitionRequestId: firstRequestId,
    });
    await repository.completeDiscordEvent({
      receiptId: first.receipt.id,
      botInstanceId: bot.id,
      leaseGeneration: 4,
      acquisitionRequestId: firstRequestId,
    });
    const completed = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      acquisitionRequestId: randomUUID(),
      now: new Date(now.getTime() + 120_000),
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() + 60_000),
      maxAttempts: 3,
    });
    expect(completed.acquired).toBe(false);
    expect(completed.receipt.processingStatus).toBe("COMPLETED");

    await expectApiCode(
      repository.failDiscordEvent({
        receiptId: first.receipt.id,
        botInstanceId: bot.id,
        leaseGeneration: 4,
        acquisitionRequestId: firstRequestId,
        errorCode: "LATE_FAILURE",
      }),
      "EVENT_RECEIPT_ALREADY_COMPLETED",
    );
    expect(await prisma.discordEventReceipt.findUnique({
      where: { id: first.receipt.id },
      select: { processingStatus: true, lastErrorCode: true },
    })).toEqual({ processingStatus: "COMPLETED", lastErrorCode: null });

    const staleFirstRequestId = randomUUID();
    const staleFirst = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "stale-message",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      acquisitionRequestId: staleFirstRequestId,
      now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() - 60_000),
      maxAttempts: 3,
    });
    const staleSecondRequestId = randomUUID();
    const staleSecond = await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "stale-message",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      acquisitionRequestId: staleSecondRequestId,
      now: new Date(now.getTime() + 120_000),
      expiresAt: new Date(now.getTime() + 86_400_000),
      staleBefore: new Date(now.getTime() + 60_000),
      maxAttempts: 3,
    });
    expect(staleSecond).toMatchObject({
      acquired: true,
      receipt: {
        id: staleFirst.receipt.id,
        acquisitionRequestId: staleSecondRequestId,
        attemptCount: 2,
      },
    });
    await expectApiCode(
      repository.completeDiscordEvent({
        receiptId: staleFirst.receipt.id,
        botInstanceId: bot.id,
        leaseGeneration: 4,
        acquisitionRequestId: staleFirstRequestId,
      }),
      "EVENT_RECEIPT_OWNERSHIP_MISMATCH",
    );
    await expectApiCode(
      repository.failDiscordEvent({
        receiptId: staleFirst.receipt.id,
        botInstanceId: bot.id,
        leaseGeneration: 4,
        acquisitionRequestId: staleFirstRequestId,
        errorCode: "STALE_ATTEMPT_FAILED",
      }),
      "EVENT_RECEIPT_OWNERSHIP_MISMATCH",
    );
    await repository.failDiscordEvent({
      receiptId: staleSecond.receipt.id,
      botInstanceId: bot.id,
      leaseGeneration: 4,
      acquisitionRequestId: staleSecondRequestId,
      errorCode: "CURRENT_ATTEMPT_FAILED",
    });
    await repository.failDiscordEvent({
      receiptId: staleSecond.receipt.id,
      botInstanceId: bot.id,
      leaseGeneration: 4,
      acquisitionRequestId: staleSecondRequestId,
      errorCode: "CURRENT_ATTEMPT_FAILED",
    });

    await repository.acquireDiscordEvent({
      botInstanceId: bot.id,
      discordEventId: "expired-message-1",
      eventType: "MESSAGE_CREATE",
      leaseGeneration: 4,
      acquisitionRequestId: randomUUID(),
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
      acquisitionRequestId: randomUUID(),
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
      acquisitionRequestId: randomUUID(),
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

  it("purges aged moderation events independently of conversation expiry", async () => {
    const { bot } = await createBot("moderation-retention", "application-moderation-retention");
    const conversation = await repository.getOrCreateConversation({
      botInstanceId: bot.id,
      type: "DM",
      discordUserId: "moderation-retention-user",
    });
    const oldConversationEvent = await repository.recordLlmModerationEvent({
      botInstanceId: bot.id,
      conversationId: conversation.id,
      category: "old-conversation-event",
      action: "BLOCK",
    });
    const oldUnscopedEvent = await repository.recordLlmModerationEvent({
      botInstanceId: bot.id,
      category: "old-unscoped-event",
      action: "BLOCK",
    });
    const recentEvent = await repository.recordLlmModerationEvent({
      botInstanceId: bot.id,
      conversationId: conversation.id,
      category: "recent-event",
      action: "ALLOW",
    });
    const now = new Date();
    await prisma.llmModerationEvent.updateMany({
      where: { id: { in: [oldConversationEvent.id, oldUnscopedEvent.id] } },
      data: { createdAt: new Date(now.getTime() - 91 * 86_400_000) },
    });

    expect(await repository.purgeExpiredLlmData(now)).toEqual({
      deletedMessages: 0,
      deletedGenerations: 0,
      deletedModerationEvents: 2,
      deletedConversations: 0,
    });
    expect(await prisma.llmConversation.count({
      where: { id: conversation.id },
    })).toBe(1);
    expect(await prisma.llmModerationEvent.findMany({
      select: { id: true },
    })).toEqual([{ id: recentEvent.id }]);
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
      LLM_DEFAULT_MODEL: "gpt-5.6-luna",
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
      const createdBot = createResponse.json();
      const botId = createdBot.bot.id as string;
      expect(createdBot.profile.defaultModel).toBe(config.llmDefaultModel);

      const immutablePatch = await app.inject({
        method: "PATCH",
        url: `/api/v1/platform/bots/${botId}`,
        headers: browserHeaders,
        payload: { discordApplicationId: "changed" },
      });
      expect(immutablePatch.statusCode).toBe(400);

      const installUrlResponse = await app.inject({
        method: "GET",
        url: `/api/v1/platform/bots/${botId}/install-url`,
        headers: browserHeaders,
      });
      expect(installUrlResponse.statusCode).toBe(200);
      const installUrl = new URL(installUrlResponse.json().url);
      expect(installUrl.searchParams.get("client_id")).toBe("987654321");
      expect(installUrl.searchParams.get("scope")).toBe("bot applications.commands");
      expect(installUrl.searchParams.get("permissions")).toBe("68736");

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

      const claimPayload = {
        runtimeInstanceId: "integration-runtime",
        claimRequestId: "44444444-4444-4444-8444-444444444444",
      };
      const claim = await app.inject({
        method: "POST",
        url: `/api/v1/internal/runtime/assignments/${botId}/claim`,
        headers: { authorization: `Bearer ${poolCredential}` },
        payload: claimPayload,
      });
      expect(claim.statusCode).toBe(200);
      expect(claim.headers["cache-control"]).toBe("no-store");
      const claimBody = claim.json();
      expect(claimBody.discordToken).toBe(discordToken);

      const recoveredClaim = await app.inject({
        method: "POST",
        url: `/api/v1/internal/runtime/assignments/${botId}/claim`,
        headers: { authorization: `Bearer ${poolCredential}` },
        payload: claimPayload,
      });
      expect(recoveredClaim.statusCode).toBe(200);
      expect(recoveredClaim.json()).toMatchObject({
        leaseToken: claimBody.leaseToken,
        lease: {
          leaseGeneration: claimBody.lease.leaseGeneration,
        },
      });

      const leaseHeaders = {
        authorization: `Bearer ${claimBody.leaseToken as string}`,
        "x-bot-instance-id": botId,
        "x-bot-lease-generation": String(claimBody.lease.leaseGeneration),
      };
      const recoveredHeartbeat = await app.inject({
        method: "POST",
        url: `/api/v1/internal/runtime/assignments/${botId}/heartbeat`,
        headers: leaseHeaders,
        payload: { runtimeState: "CONNECTING" },
      });
      expect(recoveredHeartbeat.statusCode).toBe(200);

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
        defaultModel: config.llmDefaultModel,
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
      await repository.bootstrapInstallation({
        botInstanceId: botId,
        guildDiscordId: "api-unavailable-guild",
        guildName: "API Unavailable Guild",
      });
      await repository.bootstrapInstallation({
        botInstanceId: botId,
        guildDiscordId: "api-missing-guild",
        guildName: "API Missing Guild",
      });
      const reconcileInstallations = await app.inject({
        method: "POST",
        url: "/api/v1/internal/installations/reconcile",
        headers: leaseHeaders,
        payload: {
          guildIds: [
            "foreign-guild",
            "api-guild",
            "api-unavailable-guild",
          ],
        },
      });
      expect(reconcileInstallations.statusCode).toBe(200);
      expect(reconcileInstallations.json()).toEqual({ leftCount: 1 });
      expect(await repository.getInstallation(
        botId,
        "api-unavailable-guild",
      )).toMatchObject({ presenceStatus: "PRESENT" });
      expect(await repository.getInstallation(
        botId,
        "api-missing-guild",
      )).toMatchObject({ presenceStatus: "LEFT" });
      const featureUpdate = await app.inject({
        method: "PATCH",
        url: `/api/v1/guilds/api-guild/bots/${botId}/features/operations-feature`,
        headers: browserHeaders,
        payload: {
          enabled: true,
          configJson: { mode: "enabled" },
        },
      });
      expect(featureUpdate.statusCode).toBe(200);
      expect((await repository.listJobRuns({
        guildDiscordId: "api-guild",
        botInstanceId: botId,
        limit: 10,
      })).items).toEqual([
        expect.objectContaining({
          botInstanceId: botId,
          botInstallationId: installation.installation.id,
          jobType: "feature.update.reconcile",
          status: "COMPLETED",
        }),
      ]);
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
        botInstanceId: botId,
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
      await prisma.botRuntimeLease.update({
        where: { botInstanceId: botId },
        data: { expiresAt: new Date(Date.now() - 1) },
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
