import "dotenv/config";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { BotPoolSupervisor } from "./runtime/bot-pool-supervisor";
import {
  closeHealthServer,
  startHealthServer,
} from "./runtime/health-server";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const supervisor = new BotPoolSupervisor(config, logger);
  supervisor.start();
  const healthServer = startHealthServer({
    port: config.port,
    supervisor,
    logger,
  });
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down bot pool");
    await supervisor.stop();
    await closeHealthServer(healthServer);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
