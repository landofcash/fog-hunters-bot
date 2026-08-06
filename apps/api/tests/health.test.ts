import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../src/lib/app-version";
import { registerHealthRoutes } from "../src/modules/health/health.routes";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("health route", () => {
  it("reports the running API version", async () => {
    app = Fastify({ logger: false });
    await app.register(registerHealthRoutes, { prefix: "/api/v1" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      version: APP_VERSION,
    });
    expect(Date.parse(response.json().timestamp)).not.toBeNaN();
  });
});
