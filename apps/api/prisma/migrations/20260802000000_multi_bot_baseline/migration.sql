-- This is an intentional replacement baseline for disposable/test databases.
-- Prisma records the currently-running migration before executing this script,
-- so that one history row is allowed. Any prior history or application table
-- means the database must be recreated instead of being upgraded in place.
DO $$
DECLARE
    existing_tables TEXT[];
BEGIN
    SELECT array_agg(tablename ORDER BY tablename)
    INTO existing_tables
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations';

    IF COALESCE(cardinality(existing_tables), 0) > 0 THEN
        RAISE EXCEPTION
            'Multi-bot baseline refused: public application tables already exist: %',
            array_to_string(existing_tables, ', ');
    END IF;

    IF to_regclass('public._prisma_migrations') IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM "_prisma_migrations"
           WHERE migration_name <> '20260802000000_multi_bot_baseline'
       ) THEN
        RAISE EXCEPTION
            'Multi-bot baseline refused: incompatible Prisma migration history exists';
    END IF;
END
$$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_role" AS ENUM ('OWNER', 'ADMIN', 'MODERATOR', 'USER');

-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('PLATFORM_ADMIN', 'NONE');

-- CreateEnum
CREATE TYPE "guild_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "member_status" AS ENUM ('ACTIVE', 'INVITED', 'REMOVED');

-- CreateEnum
CREATE TYPE "bot_desired_status" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "bot_installation_presence_status" AS ENUM ('PRESENT', 'LEFT');

-- CreateEnum
CREATE TYPE "bot_installation_operational_status" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "bot_runtime_state" AS ENUM ('STOPPED', 'CLAIMED', 'CONNECTING', 'READY', 'BACKOFF', 'ERROR', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "discord_event_type" AS ENUM ('MESSAGE_CREATE', 'INTERACTION_CREATE');

-- CreateEnum
CREATE TYPE "discord_event_processing_status" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('QUEUED', 'RUNNING', 'FAILED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'SYSTEM', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "llm_conversation_type" AS ENUM ('GUILD_CHANNEL', 'DM');

-- CreateEnum
CREATE TYPE "llm_message_role" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "llm_generation_status" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "bot_instances" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "discord_application_id" TEXT NOT NULL,
    "discord_bot_user_id" TEXT,
    "discord_username" TEXT,
    "discord_avatar_url" TEXT,
    "desired_status" "bot_desired_status" NOT NULL DEFAULT 'DRAFT',
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_bot_instances" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_profiles" (
    "id" UUID NOT NULL,
    "bot_instance_id" UUID NOT NULL,
    "default_model" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
    "assistant_prompt" TEXT,
    "gatekeeper_prompt" TEXT,
    "dm_enabled" BOOLEAN NOT NULL DEFAULT true,
    "retention_days" INTEGER NOT NULL DEFAULT 90,
    "max_input_chars" INTEGER NOT NULL DEFAULT 4000,
    "max_output_tokens" INTEGER NOT NULL DEFAULT 512,
    "settings_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_bot_profiles" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_token_secrets" (
    "id" UUID NOT NULL,
    "bot_instance_id" UUID NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "authentication_tag" BYTEA NOT NULL,
    "encryption_key_version" INTEGER NOT NULL,
    "rotated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_bot_token_secrets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_runtime_leases" (
    "id" UUID NOT NULL,
    "bot_instance_id" UUID NOT NULL,
    "runtime_instance_id" TEXT,
    "claim_request_id" TEXT,
    "lease_generation" INTEGER NOT NULL DEFAULT 0,
    "lease_token_hash" TEXT,
    "runtime_state" "bot_runtime_state" NOT NULL DEFAULT 'STOPPED',
    "expires_at" TIMESTAMPTZ(6),
    "last_heartbeat_at" TIMESTAMPTZ(6),
    "last_connected_at" TIMESTAMPTZ(6),
    "last_error_code" TEXT,
    "last_error_at" TIMESTAMPTZ(6),
    "claimed_token_version" INTEGER,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_bot_runtime_leases" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guilds" (
    "id" UUID NOT NULL,
    "discord_guild_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "guild_status" NOT NULL DEFAULT 'ACTIVE',
    "owner_discord_user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_guilds" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "username" TEXT,
    "global_name" TEXT,
    "avatar_url" TEXT,
    "platform_role" "platform_role" NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_users" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_members" (
    "guild_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_role" "tenant_role" NOT NULL DEFAULT 'USER',
    "status" "member_status" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_guild_members" PRIMARY KEY ("guild_id","user_id")
);

-- CreateTable
CREATE TABLE "bot_installations" (
    "id" UUID NOT NULL,
    "bot_instance_id" UUID NOT NULL,
    "guild_id" UUID NOT NULL,
    "presence_status" "bot_installation_presence_status" NOT NULL DEFAULT 'PRESENT',
    "operational_status" "bot_installation_operational_status" NOT NULL DEFAULT 'ENABLED',
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_command_manifest_hash" TEXT,
    "last_command_sync_at" TIMESTAMPTZ(6),
    "last_command_sync_error_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_bot_installations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_installation_settings" (
    "id" UUID NOT NULL,
    "bot_installation_id" UUID NOT NULL,
    "llm_enabled_by_guild" BOOLEAN NOT NULL DEFAULT false,
    "llm_enabled_by_platform" BOOLEAN NOT NULL DEFAULT true,
    "model_override" TEXT,
    "assistant_prompt_override" TEXT,
    "gatekeeper_prompt_override" TEXT,
    "retention_days_override" INTEGER,
    "max_input_chars_override" INTEGER,
    "max_output_tokens_override" INTEGER,
    "settings_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_llm_installation_settings" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "bot_installation_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_feature_flags" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_permissions" (
    "id" UUID NOT NULL,
    "bot_installation_id" UUID NOT NULL,
    "command_key" TEXT NOT NULL,
    "min_role" "tenant_role" NOT NULL DEFAULT 'MODERATOR',
    "allow_channels_json" JSONB NOT NULL DEFAULT '[]',
    "deny_channels_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_command_permissions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_channel_settings" (
    "id" UUID NOT NULL,
    "bot_installation_id" UUID NOT NULL,
    "discord_channel_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "respond_on_mention_only" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_llm_channel_settings" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_conversations" (
    "id" UUID NOT NULL,
    "bot_instance_id" UUID NOT NULL,
    "bot_installation_id" UUID,
    "discord_channel_id" TEXT,
    "discord_user_id" TEXT,
    "type" "llm_conversation_type" NOT NULL,
    "summary_text" TEXT,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_llm_conversations" PRIMARY KEY ("id"),
    CONSTRAINT "ck_llm_conversations_scope" CHECK (
        (
            "type" = 'GUILD_CHANNEL'
            AND "bot_installation_id" IS NOT NULL
            AND "discord_channel_id" IS NOT NULL
            AND "discord_user_id" IS NULL
        )
        OR
        (
            "type" = 'DM'
            AND "bot_installation_id" IS NULL
            AND "discord_channel_id" IS NULL
            AND "discord_user_id" IS NOT NULL
        )
    )
);

-- CreateTable
CREATE TABLE "llm_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "llm_message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_llm_messages" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_generations" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "bot_instance_id" UUID NOT NULL,
    "bot_installation_id" UUID,
    "guild_id" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "llm_generation_status" NOT NULL DEFAULT 'SUCCESS',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_llm_generations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_moderation_events" (
    "id" UUID NOT NULL,
    "bot_instance_id" UUID NOT NULL,
    "bot_installation_id" UUID,
    "guild_id" UUID,
    "conversation_id" UUID,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_llm_moderation_events" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "guild_id" UUID,
    "bot_instance_id" UUID,
    "bot_installation_id" UUID,
    "actor_user_id" UUID,
    "actor_type" "audit_actor_type" NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id"),
    CONSTRAINT "ck_audit_logs_installation_bot" CHECK (
        "bot_installation_id" IS NULL OR "bot_instance_id" IS NOT NULL
    )
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "guild_id" UUID,
    "bot_instance_id" UUID,
    "bot_installation_id" UUID,
    "job_type" TEXT NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 10,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "result_json" JSONB,
    "error_text" TEXT,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_job_runs" PRIMARY KEY ("id"),
    CONSTRAINT "ck_job_runs_installation_bot" CHECK (
        "bot_installation_id" IS NULL OR "bot_instance_id" IS NOT NULL
    )
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "guild_id" UUID,
    "bot_instance_id" UUID,
    "bot_installation_id" UUID,
    "event_type" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_webhook_deliveries" PRIMARY KEY ("id"),
    CONSTRAINT "ck_webhook_deliveries_installation_bot" CHECK (
        "bot_installation_id" IS NULL OR "bot_instance_id" IS NOT NULL
    )
);

-- CreateTable
CREATE TABLE "discord_event_receipts" (
    "id" UUID NOT NULL,
    "bot_instance_id" UUID NOT NULL,
    "discord_event_id" TEXT NOT NULL,
    "event_type" "discord_event_type" NOT NULL,
    "lease_generation" INTEGER NOT NULL,
    "processing_status" "discord_event_processing_status" NOT NULL DEFAULT 'RECEIVED',
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "last_error_code" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_discord_event_receipts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_oauth_sessions" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_bot_instances_slug" ON "bot_instances"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bot_instances_discord_application_id" ON "bot_instances"("discord_application_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bot_instances_discord_bot_user_id" ON "bot_instances"("discord_bot_user_id");

-- CreateIndex
CREATE INDEX "ix_bot_instances_desired_status" ON "bot_instances"("desired_status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bot_profiles_bot_instance_id" ON "bot_profiles"("bot_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bot_token_secrets_bot_instance_id" ON "bot_token_secrets"("bot_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bot_runtime_leases_bot_instance_id" ON "bot_runtime_leases"("bot_instance_id");

-- CreateIndex
CREATE INDEX "ix_bot_runtime_leases_state_expiry" ON "bot_runtime_leases"("runtime_state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_guilds_discord_guild_id" ON "guilds"("discord_guild_id");

-- CreateIndex
CREATE INDEX "ix_guilds_status" ON "guilds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_users_discord_user_id" ON "users"("discord_user_id");

-- CreateIndex
CREATE INDEX "ix_guild_members_user_id" ON "guild_members"("user_id");

-- CreateIndex
CREATE INDEX "ix_guild_members_guild_role" ON "guild_members"("guild_id", "tenant_role");

-- CreateIndex
CREATE INDEX "ix_bot_installations_guild_presence" ON "bot_installations"("guild_id", "presence_status");

-- CreateIndex
CREATE INDEX "ix_bot_installations_bot_presence" ON "bot_installations"("bot_instance_id", "presence_status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bot_installations_bot_guild" ON "bot_installations"("bot_instance_id", "guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bot_installations_id_bot" ON "bot_installations"("id", "bot_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_llm_installation_settings_installation_id" ON "llm_installation_settings"("bot_installation_id");

-- CreateIndex
CREATE INDEX "ix_feature_flags_installation_enabled" ON "feature_flags"("bot_installation_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ux_feature_flags_installation_feature" ON "feature_flags"("bot_installation_id", "feature_key");

-- CreateIndex
CREATE INDEX "ix_command_permissions_installation_id" ON "command_permissions"("bot_installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_command_permissions_installation_command" ON "command_permissions"("bot_installation_id", "command_key");

-- CreateIndex
CREATE INDEX "ix_llm_channel_settings_installation_id" ON "llm_channel_settings"("bot_installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_llm_channel_settings_installation_channel" ON "llm_channel_settings"("bot_installation_id", "discord_channel_id");

-- CreateIndex
CREATE INDEX "ix_llm_conversations_installation_last_message" ON "llm_conversations"("bot_installation_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "ix_llm_conversations_bot_user_last_message" ON "llm_conversations"("bot_instance_id", "discord_user_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ux_llm_conversations_installation_channel_type" ON "llm_conversations"("bot_installation_id", "discord_channel_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ux_llm_conversations_bot_user_type" ON "llm_conversations"("bot_instance_id", "discord_user_id", "type");

-- CreateIndex
CREATE INDEX "ix_llm_messages_conversation_created" ON "llm_messages"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_llm_generations_installation_created" ON "llm_generations"("bot_installation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_llm_generations_bot_created" ON "llm_generations"("bot_instance_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_llm_generations_conversation_created" ON "llm_generations"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_llm_moderation_events_installation_created" ON "llm_moderation_events"("bot_installation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_llm_moderation_events_bot_created" ON "llm_moderation_events"("bot_instance_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_llm_moderation_events_conversation_created" ON "llm_moderation_events"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_logs_guild_created" ON "audit_logs"("guild_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_logs_bot_created" ON "audit_logs"("bot_instance_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_logs_installation_created" ON "audit_logs"("bot_installation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_logs_actor" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_job_runs_guild_status" ON "job_runs"("guild_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_job_runs_installation_status" ON "job_runs"("bot_installation_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_job_runs_schedule" ON "job_runs"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "ix_webhook_deliveries_installation_created" ON "webhook_deliveries"("bot_installation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_discord_event_receipts_expiry" ON "discord_event_receipts"("expires_at");

-- CreateIndex
CREATE INDEX "ix_discord_event_receipts_bot_processing" ON "discord_event_receipts"("bot_instance_id", "processing_status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_discord_event_receipts_bot_event_type" ON "discord_event_receipts"("bot_instance_id", "discord_event_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "ux_oauth_sessions_session_token_hash" ON "oauth_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "ix_oauth_sessions_user_id" ON "oauth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "ix_oauth_sessions_expires_at" ON "oauth_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "bot_profiles" ADD CONSTRAINT "fk_bot_profiles_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_token_secrets" ADD CONSTRAINT "fk_bot_token_secrets_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_token_secrets" ADD CONSTRAINT "fk_bot_token_secrets_rotated_by" FOREIGN KEY ("rotated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_runtime_leases" ADD CONSTRAINT "fk_bot_runtime_leases_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "fk_guild_members_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "fk_guild_members_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_installations" ADD CONSTRAINT "fk_bot_installations_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_installations" ADD CONSTRAINT "fk_bot_installations_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_installation_settings" ADD CONSTRAINT "fk_llm_installation_settings_installations" FOREIGN KEY ("bot_installation_id") REFERENCES "bot_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "fk_feature_flags_installations" FOREIGN KEY ("bot_installation_id") REFERENCES "bot_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_permissions" ADD CONSTRAINT "fk_command_permissions_installations" FOREIGN KEY ("bot_installation_id") REFERENCES "bot_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_channel_settings" ADD CONSTRAINT "fk_llm_channel_settings_installations" FOREIGN KEY ("bot_installation_id") REFERENCES "bot_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_conversations" ADD CONSTRAINT "fk_llm_conversations_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_conversations" ADD CONSTRAINT "fk_llm_conversations_installation_bot" FOREIGN KEY ("bot_installation_id", "bot_instance_id") REFERENCES "bot_installations"("id", "bot_instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_messages" ADD CONSTRAINT "fk_llm_messages_conversations" FOREIGN KEY ("conversation_id") REFERENCES "llm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_generations" ADD CONSTRAINT "fk_llm_generations_conversations" FOREIGN KEY ("conversation_id") REFERENCES "llm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_generations" ADD CONSTRAINT "fk_llm_generations_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_generations" ADD CONSTRAINT "fk_llm_generations_installation_bot" FOREIGN KEY ("bot_installation_id", "bot_instance_id") REFERENCES "bot_installations"("id", "bot_instance_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_generations" ADD CONSTRAINT "fk_llm_generations_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_moderation_events" ADD CONSTRAINT "fk_llm_moderation_events_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_moderation_events" ADD CONSTRAINT "fk_llm_moderation_events_installation_bot" FOREIGN KEY ("bot_installation_id", "bot_instance_id") REFERENCES "bot_installations"("id", "bot_instance_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_moderation_events" ADD CONSTRAINT "fk_llm_moderation_events_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_moderation_events" ADD CONSTRAINT "fk_llm_moderation_events_conversations" FOREIGN KEY ("conversation_id") REFERENCES "llm_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_installation_bot" FOREIGN KEY ("bot_installation_id", "bot_instance_id") REFERENCES "bot_installations"("id", "bot_instance_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_users" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "fk_job_runs_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "fk_job_runs_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "fk_job_runs_installation_bot" FOREIGN KEY ("bot_installation_id", "bot_instance_id") REFERENCES "bot_installations"("id", "bot_instance_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_installation_bot" FOREIGN KEY ("bot_installation_id", "bot_instance_id") REFERENCES "bot_installations"("id", "bot_instance_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_event_receipts" ADD CONSTRAINT "fk_discord_event_receipts_bot_instances" FOREIGN KEY ("bot_instance_id") REFERENCES "bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "fk_oauth_sessions_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
