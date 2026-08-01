import type { Logger } from "pino";

export type AlertSeverity = "warning" | "error" | "critical";

export interface OperationalAlert {
  event: string;
  title: string;
  severity: AlertSeverity;
  details?: Record<string, string | number | boolean | null | undefined>;
}

export interface AlertNotifier {
  notify(alert: OperationalAlert): Promise<boolean>;
}

type FetchLike = typeof fetch;

const DISCORD_COLORS: Record<AlertSeverity, number> = {
  warning: 0xf59e0b,
  error: 0xef4444,
  critical: 0x991b1b,
};

function alertFields(details: OperationalAlert["details"]): Array<{ name: string; value: string; inline: boolean }> {
  return Object.entries(details ?? {})
    .filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined)
    .slice(0, 10)
    .map(([name, value]) => ({
      name: name.slice(0, 256),
      value: String(value).slice(0, 1_024),
      inline: true,
    }));
}

export class DiscordWebhookAlertNotifier implements AlertNotifier {
  private readonly lastAttemptByEvent = new Map<string, number>();

  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly serviceName: string,
    private readonly logger: Logger,
    private readonly cooldownMs: number,
    private readonly requestTimeoutMs: number,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async notify(alert: OperationalAlert): Promise<boolean> {
    if (!this.webhookUrl) {
      this.logger.warn({ alertEvent: alert.event }, "Operational alert webhook is not configured");
      return false;
    }

    const now = Date.now();
    const lastAttempt = this.lastAttemptByEvent.get(alert.event);
    if (lastAttempt !== undefined && now - lastAttempt < this.cooldownMs) {
      this.logger.debug({ alertEvent: alert.event }, "Operational alert suppressed by cooldown");
      return false;
    }
    this.lastAttemptByEvent.set(alert.event, now);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "Fog Hunters Alerts",
          allowed_mentions: { parse: [] },
          embeds: [
            {
              title: alert.title.slice(0, 256),
              description: `Service: **${this.serviceName}**\nEvent: \`${alert.event}\``,
              color: DISCORD_COLORS[alert.severity],
              fields: alertFields(alert.details),
              timestamp: new Date(now).toISOString(),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(
          { alertEvent: alert.event, statusCode: response.status },
          "Operational alert delivery failed",
        );
        return false;
      }

      this.logger.info({ alertEvent: alert.event }, "Operational alert delivered");
      return true;
    } catch (error) {
      this.logger.error({ err: error, alertEvent: alert.event }, "Operational alert delivery failed");
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
