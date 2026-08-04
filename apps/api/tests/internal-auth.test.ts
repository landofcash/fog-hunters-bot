import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { requireBotLease } from "../src/middleware/internal-auth";

describe("internal authentication", () => {
  it("rejects malformed bot IDs before querying the repository", async () => {
    const validateRuntimeLease = vi.fn();
    const request = {
      headers: {
        authorization: "Bearer invalid-lease-token",
        "x-bot-instance-id": "not-a-uuid",
        "x-bot-lease-generation": "1",
      },
      server: {
        repository: { validateRuntimeLease },
      },
    } as unknown as FastifyRequest;

    await expect(
      requireBotLease(request, {} as FastifyReply),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "BOT_LEASE_EXPIRED",
    });
    expect(validateRuntimeLease).not.toHaveBeenCalled();
  });
});
