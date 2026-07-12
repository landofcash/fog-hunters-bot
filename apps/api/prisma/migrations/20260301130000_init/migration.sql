-- Enums
CREATE TYPE "tenant_role" AS ENUM ('OWNER', 'ADMIN', 'MODERATOR', 'USER');
CREATE TYPE "platform_role" AS ENUM ('PLATFORM_ADMIN', 'NONE');
CREATE TYPE "guild_status" AS ENUM ('ACTIVE', 'DISABLED', 'LEFT');
CREATE TYPE "member_status" AS ENUM ('ACTIVE', 'INVITED', 'REMOVED');
CREATE TYPE "job_status" AS ENUM ('QUEUED', 'RUNNING', 'FAILED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'SYSTEM', 'PLATFORM_ADMIN');

-- Core tables
CREATE TABLE "guilds" (
  "id" UUID NOT NULL,
  "discord_guild_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "guild_status" NOT NULL DEFAULT 'ACTIVE',
  "owner_discord_user_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_guilds" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "username" TEXT,
  "global_name" TEXT,
  "avatar_url" TEXT,
  "platform_role" "platform_role" NOT NULL DEFAULT 'NONE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_users" PRIMARY KEY ("id")
);

CREATE TABLE "guild_members" (
  "guild_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "tenant_role" "tenant_role" NOT NULL DEFAULT 'USER',
  "status" "member_status" NOT NULL DEFAULT 'ACTIVE',
  "joined_at" TIMESTAMPTZ(6),
  "last_seen_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_guild_members" PRIMARY KEY ("guild_id", "user_id"),
  CONSTRAINT "fk_guild_members_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_guild_members_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "feature_flags" (
  "id" UUID NOT NULL,
  "guild_id" UUID NOT NULL,
  "feature_key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_feature_flags" PRIMARY KEY ("id"),
  CONSTRAINT "fk_feature_flags_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "command_permissions" (
  "id" UUID NOT NULL,
  "guild_id" UUID NOT NULL,
  "command_key" TEXT NOT NULL,
  "min_role" "tenant_role" NOT NULL DEFAULT 'MODERATOR',
  "allow_channels_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "deny_channels_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_command_permissions" PRIMARY KEY ("id"),
  CONSTRAINT "fk_command_permissions_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "guild_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "actor_type" "audit_actor_type" NOT NULL,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "before_json" JSONB,
  "after_json" JSONB,
  "metadata_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id"),
  CONSTRAINT "fk_audit_logs_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_audit_logs_users" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "job_runs" (
  "id" UUID NOT NULL,
  "guild_id" UUID NOT NULL,
  "job_type" TEXT NOT NULL,
  "status" "job_status" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 10,
  "payload_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result_json" JSONB,
  "error_text" TEXT,
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_job_runs" PRIMARY KEY ("id"),
  CONSTRAINT "fk_job_runs_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "oauth_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "session_token_hash" TEXT NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_oauth_sessions" PRIMARY KEY ("id"),
  CONSTRAINT "fk_oauth_sessions_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "webhook_deliveries" (
  "id" UUID NOT NULL,
  "guild_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "target_url" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_webhook_deliveries" PRIMARY KEY ("id"),
  CONSTRAINT "fk_webhook_deliveries_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Unique constraints
CREATE UNIQUE INDEX "ux_guilds_discord_guild_id" ON "guilds" ("discord_guild_id");
CREATE UNIQUE INDEX "ux_users_discord_user_id" ON "users" ("discord_user_id");
CREATE UNIQUE INDEX "ux_feature_flags_guild_feature_key" ON "feature_flags" ("guild_id", "feature_key");
CREATE UNIQUE INDEX "ux_command_permissions_guild_command_key" ON "command_permissions" ("guild_id", "command_key");
CREATE UNIQUE INDEX "ux_oauth_sessions_session_token_hash" ON "oauth_sessions" ("session_token_hash");

-- Indexes
CREATE INDEX "ix_guilds_status" ON "guilds" ("status");
CREATE INDEX "ix_guild_members_user_id" ON "guild_members" ("user_id");
CREATE INDEX "ix_guild_members_guild_role" ON "guild_members" ("guild_id", "tenant_role");
CREATE INDEX "ix_feature_flags_guild_id" ON "feature_flags" ("guild_id");
CREATE INDEX "ix_feature_flags_guild_enabled" ON "feature_flags" ("guild_id", "enabled");
CREATE INDEX "ix_feature_flags_config_json" ON "feature_flags" USING GIN ("config_json");
CREATE INDEX "ix_command_permissions_guild_id" ON "command_permissions" ("guild_id");
CREATE INDEX "ix_audit_logs_guild_created" ON "audit_logs" ("guild_id", "created_at" DESC);
CREATE INDEX "ix_audit_logs_guild_action" ON "audit_logs" ("guild_id", "action", "created_at" DESC);
CREATE INDEX "ix_audit_logs_actor" ON "audit_logs" ("actor_user_id", "created_at" DESC);
CREATE INDEX "ix_job_runs_guild_status" ON "job_runs" ("guild_id", "status", "created_at" DESC);
CREATE INDEX "ix_job_runs_schedule" ON "job_runs" ("status", "scheduled_at");
CREATE INDEX "ix_oauth_sessions_user_id" ON "oauth_sessions" ("user_id");
CREATE INDEX "ix_oauth_sessions_expires_at" ON "oauth_sessions" ("expires_at");
