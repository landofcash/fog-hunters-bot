import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/lib/config";
import { JobsService } from "../../src/modules/jobs/jobs.service";
import type { AppRepository } from "../../src/repositories/types";

function createLoggerMock(): FastifyBaseLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

describe("JobsService receipt cleanup", () => {
  it("runs bounded receipt cleanup without pg-boss", async () => {
    const purgeExpiredDiscordEventReceipts = vi.fn()
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(25);
    const service = new JobsService(
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        PGBOSS_ENABLED: "false",
      }),
      { purgeExpiredDiscordEventReceipts } as unknown as AppRepository,
      createLoggerMock(),
    );

    await service.start();

    expect(purgeExpiredDiscordEventReceipts).toHaveBeenCalledTimes(2);
    expect(purgeExpiredDiscordEventReceipts).toHaveBeenNthCalledWith(
      1,
      expect.any(Date),
      1_000,
    );
    expect(purgeExpiredDiscordEventReceipts).toHaveBeenNthCalledWith(
      2,
      expect.any(Date),
      1_000,
    );

    await service.stop();
  });
});
