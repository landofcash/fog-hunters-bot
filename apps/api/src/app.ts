import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { loadConfig, type AppConfig } from "./lib/config";
import { isApiError } from "./lib/errors";
import { createPrismaClient } from "./lib/prisma";
import { registerAuthRoutes } from "./modules/auth/auth.routes";
import { registerGuildRoutes } from "./modules/guilds/guilds.routes";
import { registerHealthRoutes } from "./modules/health/health.routes";
import { registerInternalRoutes } from "./modules/internal/internal.routes";
import { JobsService } from "./modules/jobs/jobs.service";
import { registerLlmRoutes } from "./modules/llm/llm.routes";
import { registerMeRoutes } from "./modules/users/me.routes";
import { registerRateLimit } from "./plugins/rate-limit";
import { PrismaAppRepository } from "./repositories/prisma.repository";
import type { AppRepository } from "./repositories/types";

export interface BuildAppOptions {
  config?: AppConfig;
  repository?: AppRepository;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const appConfig = options.config ?? loadConfig();
  const app = Fastify({
    logger: true,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  const repository =
    options.repository ??
    new PrismaAppRepository(
      createPrismaClient(appConfig.databaseUrl),
    );
  const jobs = new JobsService(appConfig, repository, app.log);

  app.decorate("appConfig", appConfig);
  app.decorate("repository", repository);
  app.decorate("jobs", jobs);

  await app.register(cookie, {
    secret: appConfig.sessionSecret,
    parseOptions: {},
  });
  await registerRateLimit(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.flatten(),
          requestId: request.id,
        },
      });
      return;
    }

    if (isApiError(error)) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
      return;
    }

    request.log.error({ err: error }, "Unhandled error");
    reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error.",
        requestId: request.id,
      },
    });
  });

  await app.register(registerHealthRoutes, { prefix: "/api/v1" });
  await app.register(registerAuthRoutes, { prefix: "/api/v1" });
  await app.register(registerMeRoutes, { prefix: "/api/v1" });
  await app.register(registerGuildRoutes, { prefix: "/api/v1" });
  await app.register(registerLlmRoutes, { prefix: "/api/v1" });
  await app.register(registerInternalRoutes, { prefix: "/api/v1" });

  app.addHook("onReady", async () => {
    await jobs.start();
  });

  app.addHook("onClose", async () => {
    await jobs.stop();
  });

  return app;
}
