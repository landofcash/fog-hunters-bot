import PgBoss from "pg-boss";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../../lib/config";
import type { AppRepository } from "../../repositories/types";

interface FeatureUpdateJobData {
  jobRunId: string;
  guildDiscordId: string;
  botInstanceId: string;
  botInstallationId: string;
  featureKey: string;
  actorUserId: string;
}

interface LlmRetentionJobData {
  triggeredAt: string;
}

interface DiscordReceiptRetentionJobData {
  triggeredAt: string;
}

const FEATURE_UPDATE_JOB = "feature.update.reconcile";
const LLM_RETENTION_JOB = "llm.retention.purge";
const DISCORD_RECEIPT_RETENTION_JOB = "discord.event_receipts.purge";
const DISCORD_RECEIPT_PURGE_BATCH_SIZE = 1_000;
const DISCORD_RECEIPT_PURGE_MAX_BATCHES = 10;
const DISCORD_RECEIPT_PURGE_INTERVAL_MS = 60 * 60 * 1_000;

export class JobsService {
  private boss: PgBoss | null = null;
  private started = false;
  private receiptCleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: AppConfig,
    private readonly repository: AppRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    if (!this.config.databaseUrl || this.started) {
      return;
    }

    if (!this.config.pgBossEnabled) {
      this.started = true;
      await this.runDiscordReceiptPurge().catch((error) => {
        this.logger.error({ err: error }, "Discord event receipt purge failed");
      });
      this.receiptCleanupTimer = setInterval(() => {
        void this.runDiscordReceiptPurge()
          .then((result) => {
            this.logger.info({ result }, "Discord event receipt purge completed");
          })
          .catch((error) => {
            this.logger.error({ err: error }, "Discord event receipt purge failed");
          });
      }, DISCORD_RECEIPT_PURGE_INTERVAL_MS);
      this.receiptCleanupTimer.unref();
      this.logger.info("Local maintenance worker started");
      return;
    }

    this.boss = new PgBoss(this.config.databaseUrl);
    await this.boss.start();
    await this.boss.createQueue(FEATURE_UPDATE_JOB);
    await this.boss.createQueue(LLM_RETENTION_JOB);
    await this.boss.createQueue(DISCORD_RECEIPT_RETENTION_JOB);
    await this.boss.work<FeatureUpdateJobData>(
      FEATURE_UPDATE_JOB,
      {},
      async ([job]) => {
        if (!job) {
          return;
        }
        const now = new Date();
        await this.repository.updateJobRun({
          jobRunId: job.data.jobRunId,
          status: "RUNNING",
          attempts: ((job as { retryCount?: number }).retryCount ?? 0) + 1,
          startedAt: now,
        });

        try {
          await this.repository.updateJobRun({
            jobRunId: job.data.jobRunId,
            status: "COMPLETED",
            result: {
              guildDiscordId: job.data.guildDiscordId,
              featureKey: job.data.featureKey,
              processedAt: new Date().toISOString(),
            },
            finishedAt: new Date(),
          });
        } catch (error) {
          await this.repository.updateJobRun({
            jobRunId: job.data.jobRunId,
            status: "FAILED",
            errorText: error instanceof Error ? error.message : "Unknown job error",
            finishedAt: new Date(),
          });
          throw error;
        }
      },
    );

    await this.boss.work<LlmRetentionJobData>(
      LLM_RETENTION_JOB,
      {},
      async () => {
        const result = await this.repository.purgeExpiredLlmData(new Date());
        this.logger.info({ result }, "LLM retention purge completed");
      },
    );

    await this.boss.work<DiscordReceiptRetentionJobData>(
      DISCORD_RECEIPT_RETENTION_JOB,
      {},
      async () => {
        const result = await this.runDiscordReceiptPurge();
        this.logger.info({ result }, "Discord event receipt purge completed");
      },
    );

    await this.boss.schedule(LLM_RETENTION_JOB, "0 4 * * *", {
      triggeredAt: new Date().toISOString(),
    } satisfies LlmRetentionJobData);
    await this.boss.schedule(DISCORD_RECEIPT_RETENTION_JOB, "17 * * * *", {
      triggeredAt: new Date().toISOString(),
    } satisfies DiscordReceiptRetentionJobData);

    this.started = true;
    this.logger.info("pg-boss job worker started");
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    if (this.receiptCleanupTimer) {
      clearInterval(this.receiptCleanupTimer);
      this.receiptCleanupTimer = undefined;
    }
    if (this.boss) {
      await this.boss.stop();
      this.boss = null;
    }
    this.started = false;
    this.logger.info("Job worker stopped");
  }

  private async runDiscordReceiptPurge(): Promise<{
    deletedReceipts: number;
    batches: number;
  }> {
    const now = new Date();
    let deletedReceipts = 0;
    let batches = 0;
    for (let index = 0; index < DISCORD_RECEIPT_PURGE_MAX_BATCHES; index += 1) {
      const deleted = await this.repository.purgeExpiredDiscordEventReceipts(
        now,
        DISCORD_RECEIPT_PURGE_BATCH_SIZE,
      );
      deletedReceipts += deleted;
      batches += 1;
      if (deleted < DISCORD_RECEIPT_PURGE_BATCH_SIZE) break;
    }
    return { deletedReceipts, batches };
  }

  async enqueueFeatureUpdate(input: {
    guildDiscordId: string;
    botInstanceId: string;
    botInstallationId: string;
    featureKey: string;
    actorUserId: string;
  }): Promise<void> {
    const run = await this.repository.createJobRun({
      guildDiscordId: input.guildDiscordId,
      botInstanceId: input.botInstanceId,
      botInstallationId: input.botInstallationId,
      jobType: FEATURE_UPDATE_JOB,
      payload: input,
    });

    if (!this.boss) {
      await this.repository.updateJobRun({
        jobRunId: run.id,
        status: "COMPLETED",
        result: { skipped: "pgboss_disabled" },
        finishedAt: new Date(),
      });
      return;
    }

    await this.boss.send(
      FEATURE_UPDATE_JOB,
      {
        jobRunId: run.id,
        guildDiscordId: input.guildDiscordId,
        botInstanceId: input.botInstanceId,
        botInstallationId: input.botInstallationId,
        featureKey: input.featureKey,
        actorUserId: input.actorUserId,
      } satisfies FeatureUpdateJobData,
      {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
      },
    );
  }
}
