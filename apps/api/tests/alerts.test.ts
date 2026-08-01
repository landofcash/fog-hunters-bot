import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { DiscordWebhookAlertNotifier } from "../src/lib/alerts";
import { loadConfig } from "../src/lib/config";

function createLoggerMock(): FastifyBaseLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

describe("DiscordWebhookAlertNotifier", () => {
  it("treats an empty optional webhook variable as disabled", () => {
    expect(loadConfig({ ALERT_DISCORD_WEBHOOK_URL: "" }).alertDiscordWebhookUrl).toBeUndefined();
  });

  it("delivers a Discord embed without mentions and suppresses duplicate events", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const notifier = new DiscordWebhookAlertNotifier(
      "https://discord.test/webhook",
      "fhaibot-api",
      createLoggerMock(),
      300_000,
      1_000,
      fetchImpl,
    );
    const alert = {
      event: "api.openai.failure",
      title: "OpenAI request failed",
      severity: "error" as const,
      details: {
        model: "gpt-test",
        code: "LLM_TIMEOUT",
      },
    };

    await expect(notifier.notify(alert)).resolves.toBe(true);
    await expect(notifier.notify(alert)).resolves.toBe(false);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0]).toMatchObject({
      title: "OpenAI request failed",
      description: expect.stringContaining("fhaibot-api"),
    });
    expect(body.embeds[0].fields).toEqual(expect.arrayContaining([
      { name: "model", value: "gpt-test", inline: true },
      { name: "code", value: "LLM_TIMEOUT", inline: true },
    ]));
  });

  it("does not make a network request when the webhook is not configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const logger = createLoggerMock();
    const notifier = new DiscordWebhookAlertNotifier(
      undefined,
      "fhaibot-api",
      logger,
      300_000,
      1_000,
      fetchImpl,
    );

    await expect(notifier.notify({
      event: "api.openai.failure",
      title: "OpenAI request failed",
      severity: "error",
    })).resolves.toBe(false);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { alertEvent: "api.openai.failure" },
      "Operational alert webhook is not configured",
    );
  });
});
