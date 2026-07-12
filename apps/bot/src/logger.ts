import pino, { type Logger } from "pino";
import type { BotConfig } from "./config";

export function createLogger(config: BotConfig): Logger {
  return pino({
    level: config.logLevel,
  });
}
