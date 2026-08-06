import type { FastifyInstance } from "fastify";
import { APP_VERSION } from "../../lib/app-version";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  }));
}
