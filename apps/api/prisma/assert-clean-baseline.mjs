import { PrismaClient } from "@prisma/client";

const baselineName = "20260802000000_multi_bot_baseline";
const supportedMigrations = new Set([
  baselineName,
  "20260806000000_gpt56_reasoning",
]);
const expectedTables = new Set([
  "audit_logs",
  "bot_installations",
  "bot_instances",
  "bot_profiles",
  "bot_runtime_leases",
  "bot_token_secrets",
  "command_permissions",
  "discord_event_receipts",
  "feature_flags",
  "guild_members",
  "guilds",
  "job_runs",
  "llm_channel_settings",
  "llm_conversations",
  "llm_generations",
  "llm_installation_settings",
  "llm_messages",
  "llm_moderation_events",
  "oauth_sessions",
  "users",
  "webhook_deliveries",
]);

const prisma = new PrismaClient();

function refuse(message) {
  throw new Error(`Multi-bot baseline guard refused deployment: ${message}`);
}

try {
  const tables = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  const tableNames = tables.map(({ tablename }) => tablename);

  const [{ migration_table_exists: migrationTableExists }] =
    await prisma.$queryRaw`
      SELECT to_regclass('public._prisma_migrations') IS NOT NULL
        AS migration_table_exists
    `;

  const migrations = migrationTableExists
    ? await prisma.$queryRawUnsafe(`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at
      `)
    : [];

  if (migrations.length === 0) {
    if (tableNames.length > 0) {
      refuse(`application tables exist without migration history: ${tableNames.join(", ")}`);
    }

    console.log("Baseline guard: empty database confirmed.");
    process.exitCode = 0;
  } else {
    const incompatible = migrations.filter(
      ({ migration_name }) => !supportedMigrations.has(migration_name),
    );
    if (incompatible.length > 0) {
      refuse(
        `incompatible migration history: ${incompatible
          .map(({ migration_name }) => migration_name)
          .join(", ")}`,
      );
    }

    const appliedBaseline = migrations.find(
      ({ migration_name, finished_at, rolled_back_at }) =>
        migration_name === baselineName && finished_at !== null && rolled_back_at === null,
    );
    if (!appliedBaseline) {
      refuse("the baseline migration is incomplete or rolled back");
    }

    const incompleteSupportedMigration = migrations.find(
      ({ migration_name, finished_at, rolled_back_at }) =>
        supportedMigrations.has(migration_name)
        && (finished_at === null || rolled_back_at !== null),
    );
    if (incompleteSupportedMigration) {
      refuse(`migration is incomplete or rolled back: ${incompleteSupportedMigration.migration_name}`);
    }

    const unexpectedTables = tableNames.filter((table) => !expectedTables.has(table));
    const missingTables = [...expectedTables].filter((table) => !tableNames.includes(table));
    if (unexpectedTables.length > 0 || missingTables.length > 0) {
      refuse(
        `applied baseline schema does not match (unexpected: ${
          unexpectedTables.join(", ") || "none"
        }; missing: ${missingTables.join(", ") || "none"})`,
      );
    }

    console.log("Baseline guard: supported multi-bot migration history confirmed.");
  }
} finally {
  await prisma.$disconnect();
}
