ALTER TABLE "bot_profiles"
ADD COLUMN "reasoning_effort" TEXT NOT NULL DEFAULT 'low';

ALTER TABLE "llm_installation_settings"
ADD COLUMN "reasoning_effort_override" TEXT;

UPDATE "bot_profiles"
SET "default_model" = 'gpt-5.6-luna'
WHERE "default_model" NOT IN (
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol'
);

UPDATE "llm_installation_settings"
SET "model_override" = 'gpt-5.6-luna'
WHERE "model_override" IS NOT NULL
  AND "model_override" NOT IN (
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.6-sol'
  );

ALTER TABLE "bot_profiles"
ALTER COLUMN "default_model" SET DEFAULT 'gpt-5.6-luna';

ALTER TABLE "bot_profiles"
ADD CONSTRAINT "ck_bot_profiles_default_model"
CHECK ("default_model" IN (
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol'
));

ALTER TABLE "llm_installation_settings"
ADD CONSTRAINT "ck_llm_installation_settings_model_override"
CHECK (
  "model_override" IS NULL
  OR "model_override" IN (
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.6-sol'
  )
);

ALTER TABLE "bot_profiles"
ADD CONSTRAINT "ck_bot_profiles_reasoning_effort"
CHECK ("reasoning_effort" IN (
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
));

ALTER TABLE "llm_installation_settings"
ADD CONSTRAINT "ck_llm_installation_settings_reasoning_effort_override"
CHECK (
  "reasoning_effort_override" IS NULL
  OR "reasoning_effort_override" IN (
    'none',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
  )
);
