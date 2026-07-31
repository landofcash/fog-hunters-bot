ALTER TABLE "llm_guild_settings"
  RENAME COLUMN "style_prompt" TO "assistant_prompt";

UPDATE "llm_guild_settings"
SET "assistant_prompt" = NULL;

ALTER TABLE "llm_guild_settings"
  ADD COLUMN "gatekeeper_prompt" TEXT;
