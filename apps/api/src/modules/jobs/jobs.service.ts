import PgBoss from "pg-boss";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../../lib/config";
import type { AppRepository } from "../../repositories/types";

interface FeatureUpdateJobData {
  jobRunId: string;
  guildDiscordId: string;
  featureKey: string;
  actorUserId: string;
}

interface LlmRetentionJobData {
  triggeredAt: string;
}

const FEATURE_UPDATE_JOB = "feature.update.reconcile";
const LLM_RETENTION_JOB = "llm.retention.purge";

export class JobsService {
  private boss: PgBoss | null = null;
  private started = false;

  constructor(
    private readonly config: AppConfig,
    private readonly repository: AppRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    if (!this.config.pgBossEnabled || !this.config.databaseUrl || this.started) {
      return;
    }

    this.boss = new PgBoss(this.config.databaseUrl);
    await this.boss.start();
    await this.boss.createQueue(FEATURE_UPDATE_JOB);
    await this.boss.createQueue(LLM_RETENTION_JOB);
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

    await this.boss.schedule(LLM_RETENTION_JOB, "0 4 * * *", {
      triggeredAt: new Date().toISOString(),
    } satisfies LlmRetentionJobData);

    this.started = true;
    this.logger.info("pg-boss job worker started");
  }

  async stop(): Promise<void> {
    if (!this.boss || !this.started) {
      return;
    }
    await this.boss.stop();
    this.started = false;
    this.logger.info("pg-boss job worker stopped");
  }

  async enqueueFeatureUpdate(input: {
    guildDiscordId: string;
    featureKey: string;
    actorUserId: string;
  }): Promise<void> {
    const run = await this.repository.createJobRun({
      guildDiscordId: input.guildDiscordId,
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
