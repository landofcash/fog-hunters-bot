import type { FastifyInstance } from "fastify";

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(import("@fastify/rate-limit"), {
    max: 120,
    timeWindow: "1 minute",
    skipOnError: true,
  });
}
