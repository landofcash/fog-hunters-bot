import { Events, type Client } from "discord.js";
import type { Logger } from "pino";
import type { AlertNotifier } from "./alerts";

export function registerDiscordLifecycleAlerts(input: {
  client: Client;
  alerts: AlertNotifier;
  logger: Logger;
  isShuttingDown: () => boolean;
}): void {
  const sendAlert = (alert: Parameters<AlertNotifier["notify"]>[0]): void => {
    void input.alerts.notify(alert).catch((error) => {
      input.logger.error({ err: error, alertEvent: alert.event }, "Operational alert handler failed");
    });
  };

  input.client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    if (input.isShuttingDown()) {
      return;
    }

    input.logger.error(
      {
        alertEvent: "bot.discord.disconnected",
        shardId,
        closeCode: closeEvent.code,
        closeReason: closeEvent.reason,
      },
      "Discord gateway disconnected",
    );
    sendAlert({
      event: "bot.discord.disconnected",
      title: "Discord bot disconnected",
      severity: "error",
      details: {
        shardId,
        closeCode: closeEvent.code,
        closeReason: closeEvent.reason || "not provided",
      },
    });
  });

  input.client.on(Events.ShardError, (error, shardId) => {
    if (input.isShuttingDown()) {
      return;
    }

    input.logger.error(
      {
        err: error,
        alertEvent: "bot.discord.gateway_error",
        shardId,
      },
      "Discord gateway error",
    );
    sendAlert({
      event: "bot.discord.gateway_error",
      title: "Discord gateway error",
      severity: "error",
      details: {
        shardId,
        errorName: error.name,
      },
    });
  });

  input.client.on(Events.Invalidated, () => {
    if (input.isShuttingDown()) {
      return;
    }

    input.logger.fatal(
      { alertEvent: "bot.discord.session_invalidated" },
      "Discord session invalidated",
    );
    sendAlert({
      event: "bot.discord.session_invalidated",
      title: "Discord session invalidated",
      severity: "critical",
    });
  });

  input.client.on(Events.ShardReconnecting, (shardId) => {
    input.logger.warn({ shardId }, "Discord gateway reconnecting");
  });

  input.client.on(Events.ShardResume, (shardId, replayedEvents) => {
    input.logger.info({ shardId, replayedEvents }, "Discord gateway connection resumed");
  });
}
