# FHAIBot

Multi-bot Discord control plane with a Fastify API, React Admin UI, PostgreSQL,
Prisma, and a supervised pool of isolated Discord clients.

## Prerequisites

- Node.js 22+
- Docker Desktop with Linux containers
- Discord application credentials for live bot development

Install dependencies in each application:

```powershell
npm --prefix apps/api install
npm --prefix apps/bot install
npm --prefix apps/admin install
```

## Local PostgreSQL

Start the PostgreSQL 16 container and wait for it to become healthy:

```powershell
npm run db:start
```

Apply the committed Prisma migrations:

```powershell
npm run db:migrate
```

The local test database listens only on `127.0.0.1:55432`. Its credentials are development-only values defined in `compose.yaml` and must not be reused outside local development.

Stop the container while preserving its volume:

```powershell
npm run db:stop
```

Remove the container and its database volume when a clean database is required:

```powershell
npm run db:reset
```

## Verification

Run TypeScript checks, fast tests, and production builds:

```powershell
npm run check
```

Run real Prisma repository tests against the local PostgreSQL container:

```powershell
npm run check:integration
```

The integration suite applies the replacement baseline and covers same-guild
multi-bot isolation, DM isolation, composite identity constraints, runtime
claim recovery and fencing, event receipts, strict DTOs, and token secrecy. It
truncates application tables between cases but preserves Prisma migration
history.

Generate report-only unit-test coverage:

```powershell
npm run test:coverage
```

## Continuous Integration

GitHub Actions runs three independent checks for every pull request, every push to `main`, and manual workflow runs:

- **Quality** validates the Prisma schema, type-checks all three applications, and creates production builds.
- **Unit coverage** runs the API and bot unit suites with V8 coverage.
- **PostgreSQL integration** applies committed migrations to PostgreSQL 16 and runs the real Prisma repository suite.

The coverage reports are published as the `unit-coverage` workflow artifact and retained for 14 days. The equivalent local verification commands are:

```powershell
npm run check
npm run test:coverage
npm run check:integration
```

After the workflow runs on GitHub for the first time, require the `Quality`, `Unit coverage`, and `PostgreSQL integration` checks in the `main` branch ruleset.

CI validates the repository only. It does not deploy or change the Railway project.

Railway deploys the API/Admin service and pooled Discord runtime automatically
from `main` after CI succeeds.
Production health monitoring, runtime alerts, and the `/ping`-only deployment
smoke test are documented in [OPERATIONS.md](./OPERATIONS.md).

## Environment

Copy the relevant example before starting an application:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/bot/.env.example apps/bot/.env
```

Replace all placeholder secrets and Discord credentials. Never commit `.env` files.

The development examples use a matching pool credential and SHA-256 hash. Use
fresh random values outside local development. Discord runtime tokens are
created through the platform Admin UI; they are not environment variables.

## Multi-bot provisioning

1. Sign in with the dashboard Discord OAuth application.
2. Open **Platform → Bot directory**.
3. Create a bot using its immutable Discord application ID.
4. Configure the bot profile and enter the Discord token in the write-only
   token field.
5. Activate the bot explicitly.
6. Start the pooled runtime with `npm run dev:bot`.
7. Use the generated install URL to add the bot to a guild. The bot requests
   **View Audit Log** so it can identify the Discord member who completed the
   installation and grant that member FHAIBot `ADMIN` access. The Discord guild
   owner remains FHAIBot `OWNER`.

The API encrypts every Discord token with AES-256-GCM. The pool receives a
plaintext token only in memory after an authenticated lease claim.

## Encryption-key rotation

Deploy the API with the old and new versioned keys, change
`BOT_TOKEN_ACTIVE_KEY_VERSION`, then run:

```powershell
npm --prefix apps/api run bot-tokens:rotate-keys
```

The rotation is bounded and idempotent; retain the previous key through the
rollback window.
