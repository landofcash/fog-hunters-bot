-- Enums
CREATE TYPE "llm_conversation_type" AS ENUM ('GUILD_CHANNEL', 'DM');
CREATE TYPE "llm_message_role" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT');
CREATE TYPE "llm_generation_status" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

CREATE TABLE "llm_guild_settings" (
  "id" UUID NOT NULL,
  "guild_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "default_model" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
  "style_prompt" TEXT,
  "retention_days" INTEGER NOT NULL DEFAULT 90,
  "dm_enabled" BOOLEAN NOT NULL DEFAULT true,
  "max_input_chars" INTEGER NOT NULL DEFAULT 4000,
  "max_output_tokens" INTEGER NOT NULL DEFAULT 512,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_llm_guild_settings" PRIMARY KEY ("id"),
  CONSTRAINT "fk_llm_guild_settings_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "llm_channel_settings" (
  "id" UUID NOT NULL,
  "guild_id" UUID NOT NULL,
  "discord_channel_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "respond_on_mention_only" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_llm_channel_settings" PRIMARY KEY ("id"),
  CONSTRAINT "fk_llm_channel_settings_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "llm_conversations" (
  "id" UUID NOT NULL,
  "guild_id" UUID,
  "discord_channel_id" TEXT,
  "discord_user_id" TEXT,
  "type" "llm_conversation_type" NOT NULL,
  "summary_text" TEXT,
  "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_llm_conversations" PRIMARY KEY ("id"),
  CONSTRAINT "fk_llm_conversations_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "llm_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "role" "llm_message_role" NOT NULL,
  "content" TEXT NOT NULL,
  "token_count" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_llm_messages" PRIMARY KEY ("id"),
  CONSTRAINT "fk_llm_messages_conversations" FOREIGN KEY ("conversation_id") REFERENCES "llm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "llm_generations" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "guild_id" UUID,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" "llm_generation_status" NOT NULL DEFAULT 'SUCCESS',
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "latency_ms" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_text" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_llm_generations" PRIMARY KEY ("id"),
  CONSTRAINT "fk_llm_generations_conversations" FOREIGN KEY ("conversation_id") REFERENCES "llm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_llm_generations_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "llm_moderation_events" (
  "id" UUID NOT NULL,
  "guild_id" UUID,
  "conversation_id" UUID,
  "category" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_llm_moderation_events" PRIMARY KEY ("id"),
  CONSTRAINT "fk_llm_moderation_events_guilds" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fk_llm_moderation_events_conversations" FOREIGN KEY ("conversation_id") REFERENCES "llm_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ux_llm_guild_settings_guild_id" ON "llm_guild_settings" ("guild_id");
CREATE UNIQUE INDEX "ux_llm_channel_settings_guild_channel" ON "llm_channel_settings" ("guild_id", "discord_channel_id");
CREATE UNIQUE INDEX "ux_llm_conversations_guild_channel_type" ON "llm_conversations" ("guild_id", "discord_channel_id", "type");
CREATE UNIQUE INDEX "ux_llm_conversations_user_type" ON "llm_conversations" ("discord_user_id", "type");

CREATE INDEX "ix_llm_channel_settings_guild_id" ON "llm_channel_settings" ("guild_id");
CREATE INDEX "ix_llm_conversations_guild_last_message" ON "llm_conversations" ("guild_id", "last_message_at" DESC);
CREATE INDEX "ix_llm_conversations_user_last_message" ON "llm_conversations" ("discord_user_id", "last_message_at" DESC);
CREATE INDEX "ix_llm_messages_conversation_created" ON "llm_messages" ("conversation_id", "created_at" DESC);
CREATE INDEX "ix_llm_generations_guild_created" ON "llm_generations" ("guild_id", "created_at" DESC);
CREATE INDEX "ix_llm_generations_conversation_created" ON "llm_generations" ("conversation_id", "created_at" DESC);
CREATE INDEX "ix_llm_moderation_events_guild_created" ON "llm_moderation_events" ("guild_id", "created_at" DESC);
CREATE INDEX "ix_llm_moderation_events_conversation_created" ON "llm_moderation_events" ("conversation_id", "created_at" DESC);
