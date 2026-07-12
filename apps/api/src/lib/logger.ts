import pino, { type Logger } from "pino";

export function createLogger(): Logger {
  return pino({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
  });
}
