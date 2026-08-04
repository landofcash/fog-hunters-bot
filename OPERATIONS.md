# Production operations

## Service topology

Railway runs three resources in one environment:

- **api** — public Fastify API plus the built React Admin UI.
- **bot-pool** — private supervised Discord runtime with `/healthz`.
- **postgres** — private PostgreSQL database.

The pool calls the API over Railway private networking. It has no database,
dashboard OAuth, OpenAI, session, or token-encryption credentials. API
configuration stores only the pool credential's SHA-256 hash; request
middleware handles the presented credential only long enough to compare it.

Both code services deploy from `landofcash/fog-hunters-bot` on `main`. Keep
Railway **Wait for CI** enabled for:

- `Quality`
- `Unit coverage`
- `PostgreSQL integration`

## Build and deploy settings

API service:

```text
Build:      npm --prefix apps/api ci --include=dev && npm --prefix apps/api run build
Pre-deploy: npm --prefix apps/api run prisma:migrate:deploy
Start:      npm --prefix apps/api start
Health:     /api/v1/health
```

Bot-pool service:

```text
Build:  npm --prefix apps/bot ci --include=dev && npm --prefix apps/bot run build
Start:  npm --prefix apps/bot start
Health: /healthz
```

The guarded pre-deploy command accepts an empty database or the already-applied
`20260802000000_multi_bot_baseline`. It refuses legacy application tables,
incompatible migration history, incomplete migration history, or schema drift.

Zero configured bots is a healthy pool state. One bot in `ERROR` or
`QUARANTINED` does not make the supervisor unhealthy while assignment polling
and the API connection remain functional.

## Railway variables

### API only

```text
NODE_ENV=production
DATABASE_URL=${{postgres.DATABASE_URL}}
SESSION_SECRET=<sealed>
DISCORD_CLIENT_ID=<dashboard OAuth application>
DISCORD_CLIENT_SECRET=<sealed>
DISCORD_REDIRECT_URI=https://<api-domain>/api/v1/auth/discord/callback
PLATFORM_ADMIN_DISCORD_IDS=<comma-separated Discord user IDs>
BOT_POOL_BOOTSTRAP_KEY_HASH=<lowercase SHA-256 hex>
BOT_TOKEN_ACTIVE_KEY_VERSION=1
BOT_TOKEN_ENCRYPTION_KEY_V1=<sealed Base64 32-byte key>
INTERNAL_AUTH_FAILURE_RATE_LIMIT_MAX=120
INTERNAL_POOL_RATE_LIMIT_MAX=300
INTERNAL_BOT_RATE_LIMIT_MAX=600
OPENAI_API_KEY=<sealed, when LLM is enabled>
```

Keep dashboard OAuth credentials separate from runtime Discord applications.
Only the API receives `BOT_TOKEN_ENCRYPTION_KEY_V*`. Seal every encryption key
after setting it.

Public API traffic is limited per source IP. Authenticated runtime traffic uses
separate one-minute quotas per pool credential and per bot instance, so all
clients in one pool do not consume one shared IP bucket. Authentication failures
retain a separate per-IP quota.

### Bot pool only

```text
NODE_ENV=production
API_BASE_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}/api/v1
BOT_POOL_BOOTSTRAP_KEY=<sealed plaintext credential>
ASSIGNMENT_POLL_MS=15000
LEASE_SAFETY_MARGIN_MS=20000
PORT=3001
```

Generate the credential and hash locally without committing either value:

```powershell
$poolBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($poolBytes)
$poolCredential = [Convert]::ToBase64String($poolBytes)
$poolHash = [Convert]::ToHexString(
  [Security.Cryptography.SHA256]::HashData(
    [Text.Encoding]::UTF8.GetBytes($poolCredential)
  )
).ToLowerInvariant()
```

Set `$poolCredential` as the sealed pool variable and `$poolHash` on the API.
Do not print or persist `$poolCredential`.

Generate an encryption key independently:

```powershell
$keyBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($keyBytes)
$keyBase64 = [Convert]::ToBase64String($keyBytes)
```

Set `$keyBase64` as sealed `BOT_TOKEN_ENCRYPTION_KEY_V1` on the API only.

Optional operational alerts remain available on both services:

```text
ALERT_DISCORD_WEBHOOK_URL=<sealed private Discord webhook>
ALERT_COOLDOWN_MS=300000
ALERT_REQUEST_TIMEOUT_MS=3000
```

## Empty-database cutover

This release intentionally copies no rows from the guild-centric database.

1. Provision a new empty PostgreSQL service in the target environment.
2. Point only the API `DATABASE_URL` reference to the new service.
3. Allow the API pre-deploy command to apply the new baseline.
4. Verify API health and sign in again.
5. Create bot identities, profiles, and write-only tokens in
   `/platform/bots`.
6. Stop the old single-client Discord runtime before activating any token in
   the new pool.
7. Activate bots and verify each runtime reaches `READY`.
8. Verify cached Discord guilds recreate guilds and bot installations.
9. Run the staging acceptance checks below.
10. Retain the old database through the rollback window; delete it only after
    explicit validation and approval.

Never point the replacement baseline at the old database. The guard is
designed to fail that deployment.

## Encryption-key rotation

1. Generate a new random 32-byte key.
2. Add and seal `BOT_TOKEN_ENCRYPTION_KEY_V2` on the API.
3. Deploy with both V1 and V2 present.
4. Set `BOT_TOKEN_ACTIVE_KEY_VERSION=2` and redeploy.
5. Run:

   ```text
   npm --prefix apps/api run bot-tokens:rotate-keys
   ```

6. Verify the command reports no remaining rotations on a second run.
7. Retain V1 through the rollback period.
8. Remove V1 only after rollback is no longer required.

Key re-encryption does not increment `tokenVersion` or reconnect Discord
clients. Replacing a Discord token through the Admin UI does both.

## Staging acceptance

Use two Discord applications and two guilds, with both bots in one shared
guild:

1. Confirm distinct prompts and conversation histories in the shared channel.
2. Confirm the same bot has independent settings in its two guilds.
3. Confirm the same Discord user has independent DM history for each bot.
4. Add a new active bot without redeploying the pool.
5. Rotate one token and confirm only that client restarts.
6. Configure one invalid token and confirm the other client remains `READY`.
7. Interrupt one claim response and confirm claim recovery does not wait for
   lease expiry.
8. Interrupt API access and confirm the stale runtime quarantines before the
   20-second safety margin and performs no Discord side effects.
9. Confirm unchanged command-manifest hashes do not cause a Discord overwrite.
10. Confirm both `/api/v1/health` and `/healthz` are healthy.

The deployment smoke test remains `/ping`. Do not mutate prompts, models, or
conversation state during a production smoke test.

## Verification and rollback

After deployment:

1. Confirm both Railway deployments reach `SUCCESS`.
2. Confirm the two health endpoints.
3. Inspect `/platform/bots` for desired state, observed runtime state, token
   version, heartbeat, and sanitized errors.
4. Run `/ping` once for each active bot.

For rollback, disable new bot identities first, stop the pool, restore the old
API/database references, and restart the former runtime. Never let old and new
services log in with the same Discord token concurrently.
