# FHAIBot

Multi-tenant Discord bot with a Fastify API, PostgreSQL persistence, Prisma, and an optional OpenAI-backed chat module.

## Prerequisites

- Node.js 22+
- Docker Desktop with Linux containers
- Discord application credentials for live bot development

Install dependencies in each application:

```powershell
npm --prefix apps/api install
npm --prefix apps/bot install
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

The integration suite applies migrations and covers tenant isolation, optimistic feature versions, concurrent owner protection, member pagination, and LLM retention. It truncates application tables between cases but preserves Prisma migration history.

Generate report-only unit-test coverage:

```powershell
npm run test:coverage
```

## Continuous Integration

GitHub Actions runs three independent checks for every pull request, every push to `main`, and manual workflow runs:

- **Quality** validates the Prisma schema, type-checks both applications, and creates production builds.
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

## Environment

Copy the relevant example before starting an application:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/bot/.env.example apps/bot/.env
```

Replace all placeholder secrets and Discord credentials. Never commit `.env` files.
