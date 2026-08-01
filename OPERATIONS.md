# Production operations

## Deployment flow

Both Railway services deploy from `landofcash/fog-hunters-bot` on the `main`
branch. Railway **Wait for CI** must remain enabled so a release proceeds only
after these required GitHub checks pass:

- `Quality`
- `Unit coverage`
- `PostgreSQL integration`

The API service uses `/api/v1/health` as its Railway deployment health check.
Railway health checks protect deployment cutover; they are not continuous
uptime monitoring.

After both services reach `SUCCESS`, the only Discord smoke test is:

```text
/ping
```

Expected result: `Pong! <latency>ms`. Do not mutate AI models, prompts, or
conversation state as part of a deployment smoke test.

## Continuous API health alert

`.github/workflows/production-health.yml` checks the production API every five
minutes. It contains the current production health URL and supports overriding
it with the optional `PRODUCTION_API_HEALTH_URL` GitHub Actions variable.

On failure, the workflow:

1. Opens one deduplicated GitHub issue named
   `[alert] Production API health check failed`.
2. Keeps the workflow run failed while the outage continues.
3. Closes the issue automatically after the endpoint recovers.

If the Railway domain changes, set the repository variable to the new full
health endpoint:

```text
https://api-production-8fae.up.railway.app/api/v1/health
```

## Runtime Discord alerts

The API and bot accept the same optional Railway variables:

```text
ALERT_DISCORD_WEBHOOK_URL=<private Discord channel webhook>
ALERT_COOLDOWN_MS=300000
ALERT_REQUEST_TIMEOUT_MS=3000
```

Configure `ALERT_DISCORD_WEBHOOK_URL` on both services. The URL is a secret and
must never be committed or included in logs.

Runtime events:

- `api.openai.failure`: OpenAI gatekeeper or answer-generation failure.
- `bot.discord.disconnected`: unexpected Discord gateway disconnect.
- `bot.discord.gateway_error`: Discord gateway error.
- `bot.discord.session_invalidated`: unrecoverable Discord session.

Alerts include only operational identifiers and error codes. They never include
Discord message content, prompts, API tokens, or the webhook URL. Repeated
events of the same type are suppressed for the configured cooldown.

For deployment failures and crashed Railway services, add the same Discord
webhook under the Railway project **Settings → Webhooks**. Railway automatically
formats project events for Discord.

## Production verification

1. Confirm GitHub CI succeeded for the `main` commit.
2. Confirm the API and bot Railway deployments both reached `SUCCESS`.
3. Confirm `GET /api/v1/health` returns `{"status":"ok", ...}`.
4. Run `/ping` once in Discord.
5. Do not test alert delivery by disconnecting the live bot or forcing an
   OpenAI failure. Use the Discord webhook's test action outside production.
