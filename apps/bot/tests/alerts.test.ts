import { EventEmitter } from "node:events";
import { Events, type Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { DiscordWebhookAlertNotifier, type AlertNotifier } from "../src/runtime/alerts";
import { registerDiscordLifecycleAlerts } from "../src/runtime/discord-lifecycle";
import { createLoggerMock } from "./helpers/fixtures";

describe("bot operational alerts", () => {
  it("treats an empty optional webhook variable as disabled", () => {
    const config = loadConfig({
      API_BASE_URL: "https://api.test/api/v1",
      BOT_POOL_BOOTSTRAP_KEY: "pool-bootstrap-key-at-least-32-characters",
      ALERT_DISCORD_WEBHOOK_URL: "",
    });
    expect(config.alertDiscordWebhookUrl).toBeUndefined();
  });

  it("delivers webhook alerts and applies a per-event cooldown", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const notifier = new DiscordWebhookAlertNotifier(
      "https://discord.test/webhook",
      "fhaibot-bot",
      createLoggerMock(),
      300_000,
      1_000,
      fetchImpl,
    );
    const alert = {
      event: "bot.discord.disconnected",
      title: "Discord bot disconnected",
      severity: "error" as const,
    };

    await expect(notifier.notify(alert)).resolves.toBe(true);
    await expect(notifier.notify(alert)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("alerts on unexpected gateway disconnects without alerting during shutdown", () => {
    const emitter = new EventEmitter() as unknown as Client;
    const logger = createLoggerMock();
    const alerts: AlertNotifier = {
      notify: vi.fn().mockResolvedValue(true),
    };
    let shuttingDown = false;
    registerDiscordLifecycleAlerts({
      client: emitter,
      alerts,
      logger,
      isShuttingDown: () => shuttingDown,
    });

    emitter.emit(Events.ShardDisconnect, { code: 1_006, reason: "connection lost", wasClean: false }, 0);

    expect(alerts.notify).toHaveBeenCalledWith({
      event: "bot.discord.disconnected",
      title: "Discord bot disconnected",
      severity: "error",
      details: {
        shardId: 0,
        closeCode: 1_006,
        closeReason: "connection lost",
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ alertEvent: "bot.discord.disconnected", shardId: 0 }),
      "Discord gateway disconnected",
    );

    shuttingDown = true;
    emitter.emit(Events.ShardDisconnect, { code: 1_000, reason: "shutdown", wasClean: true }, 0);
    expect(alerts.notify).toHaveBeenCalledTimes(1);
  });

  it("alerts when the Discord session is invalidated", () => {
    const emitter = new EventEmitter() as unknown as Client;
    const alerts: AlertNotifier = {
      notify: vi.fn().mockResolvedValue(true),
    };
    registerDiscordLifecycleAlerts({
      client: emitter,
      alerts,
      logger: createLoggerMock(),
      isShuttingDown: () => false,
    });

    emitter.emit(Events.Invalidated);

    expect(alerts.notify).toHaveBeenCalledWith({
      event: "bot.discord.session_invalidated",
      title: "Discord session invalidated",
      severity: "critical",
    });
  });
});
