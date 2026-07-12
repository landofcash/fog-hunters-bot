# Database Structure Plan and Description

## 1) Purpose
This document defines the PostgreSQL database structure for the multi-tenant Discord bot platform, with strict isolation per Discord server (`guild`), admin configuration support, and operational observability.

Primary goals:
- Strong tenant isolation using `guild_id` boundaries.
- Clear permission and role modeling for dashboard and bot commands.
- Auditability for all admin and configuration changes.
- Reliable async processing with Postgres-backed job queue metadata.

## 2) Database Engine and Conventions
- Engine: PostgreSQL 16+
- ID strategy:
  - Internal PKs: `uuid` values generated as **UUIDv7** in the application layer.
  - Node standard: use `uuid` package `v7()` and pass IDs explicitly on insert.
  - Keep DB column type as `uuid`; do not rely on random UUID defaults for core IDs.
  - External Discord IDs: `text` storing Discord snowflakes exactly.
- Timestamps:
  - Use `timestamptz`.
  - Standard columns: `created_at`, `updated_at`.
- Naming:
  - `snake_case` for schema objects.
  - Foreign keys named `fk_<table>_<referenced_table>`.
- Soft delete:
  - Use `status` columns where restore/history matters.
  - Hard delete only for non-critical cache-like records.

## 3) Tenant Isolation Model
- Tenant key is `guild_id` on all tenant-owned data.
- Any read/write query in application code must include tenant scope unless endpoint is platform-admin scoped.
- Platform support override is explicit and audited.
- Cross-guild joins are disallowed in tenant request paths.

Recommended hardening:
- Add Postgres Row-Level Security (RLS) in phase 2.
- Set request-scoped DB variable (example `app.current_guild_id`) and enforce via RLS policies.

## 4) Core Enumerations
Use Postgres enums or constrained text with check constraints.

- `tenant_role`: `OWNER`, `ADMIN`, `MODERATOR`, `USER`
- `platform_role`: `PLATFORM_ADMIN`, `NONE`
- `guild_status`: `ACTIVE`, `DISABLED`, `LEFT`
- `member_status`: `ACTIVE`, `INVITED`, `REMOVED`
- `job_status`: `QUEUED`, `RUNNING`, `FAILED`, `COMPLETED`, `CANCELLED`
- `audit_actor_type`: `USER`, `SYSTEM`, `PLATFORM_ADMIN`

## 5) Tables

### 5.0 Table Catalog (Purpose + Description)
| Table | Purpose | Description |
|---|---|---|
| `guilds` | Tenant root | One row per Discord server; owns all tenant-scoped data. |
| `users` | Identity registry | Canonical user records keyed by Discord user ID across all guilds. |
| `guild_members` | Tenant membership + role | Maps users to guilds with tenant role and membership lifecycle status. |
| `feature_flags` | Per-guild feature control | Stores feature enablement and JSON config for each guild. |
| `command_permissions` | Per-guild command access policy | Defines minimum role and channel allow/deny lists per command. |
| `audit_logs` | Immutable compliance trail | Records who changed what, with before/after snapshots and metadata. |
| `job_runs` | Async execution tracking | Tracks queue/job lifecycle, retries, and failure details by guild. |
| `oauth_sessions` | Dashboard session persistence | Stores authenticated web sessions and expiry for secure access. |
| `webhook_deliveries` | Integration delivery tracking (optional) | Captures outbound webhook attempts, status, and error diagnostics. |
| `llm_guild_settings` | AI policy per guild | Stores per-guild AI enablement, model, style, and retention policy. |
| `llm_channel_settings` | AI channel routing | Enables/disables AI responses per guild channel with mention-only mode. |
| `llm_conversations` | Memory scope root | Conversation/thread state for guild-channel and DM scopes. |
| `llm_messages` | Persistent memory turns | Ordered user/assistant/system turns used for prompt context. |
| `llm_generations` | LLM execution telemetry | Provider/model usage, token counts, latency, and failure details. |
| `llm_moderation_events` | Safety trace | Logged moderation/safety outcomes and actions per conversation. |

### 5.1 `guilds`
Purpose:
- Tenant root entity for each Discord server the bot joins.

Columns:
- `id uuid pk`
- `discord_guild_id text not null unique`
- `name text not null`
- `status guild_status not null default 'ACTIVE'`
- `owner_discord_user_id text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:
- unique `ux_guilds_discord_guild_id(discord_guild_id)`
- `ix_guilds_status(status)`

### 5.2 `users`
Purpose:
- Canonical user profile keyed by Discord user identity.

Columns:
- `id uuid pk`
- `discord_user_id text not null unique`
- `username text null`
- `global_name text null`
- `avatar_url text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:
- unique `ux_users_discord_user_id(discord_user_id)`

### 5.3 `guild_members`
Purpose:
- Membership and tenant role assignment per guild.

Columns:
- `guild_id uuid not null fk -> guilds(id)`
- `user_id uuid not null fk -> users(id)`
- `tenant_role tenant_role not null default 'USER'`
- `status member_status not null default 'ACTIVE'`
- `joined_at timestamptz null`
- `last_seen_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- primary key `(guild_id, user_id)`
- check to ensure active guild membership changes are valid in service layer.

Indexes:
- `ix_guild_members_user_id(user_id)`
- `ix_guild_members_guild_role(guild_id, tenant_role)`

### 5.4 `feature_flags`
Purpose:
- Feature enablement and per-feature JSON config for each guild.

Columns:
- `id uuid pk`
- `guild_id uuid not null fk -> guilds(id)`
- `feature_key text not null`
- `enabled boolean not null default false`
- `config_json jsonb not null default '{}'::jsonb`
- `version int not null default 1`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- unique `(guild_id, feature_key)`

Indexes:
- `ix_feature_flags_guild_id(guild_id)`
- `ix_feature_flags_guild_enabled(guild_id, enabled)`
- GIN `ix_feature_flags_config_json on config_json`

### 5.5 `command_permissions`
Purpose:
- Command authorization policy by guild.

Columns:
- `id uuid pk`
- `guild_id uuid not null fk -> guilds(id)`
- `command_key text not null`
- `min_role tenant_role not null default 'MODERATOR'`
- `allow_channels_json jsonb not null default '[]'::jsonb`
- `deny_channels_json jsonb not null default '[]'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- unique `(guild_id, command_key)`

Indexes:
- `ix_command_permissions_guild_id(guild_id)`

### 5.6 `audit_logs`
Purpose:
- Immutable record of admin/config actions for security and support.

Columns:
- `id uuid pk`
- `guild_id uuid not null fk -> guilds(id)`
- `actor_user_id uuid null fk -> users(id)`
- `actor_type audit_actor_type not null`
- `action text not null`
- `entity_type text not null`
- `entity_id text not null`
- `before_json jsonb null`
- `after_json jsonb null`
- `metadata_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

Indexes:
- `ix_audit_logs_guild_created(guild_id, created_at desc)`
- `ix_audit_logs_guild_action(guild_id, action, created_at desc)`
- `ix_audit_logs_actor(actor_user_id, created_at desc)`

Retention:
- Keep minimum 12 months online by default.
- Optional archive process for older records.

### 5.7 `job_runs`
Purpose:
- Track async processing lifecycle and failure diagnostics.

Columns:
- `id uuid pk`
- `guild_id uuid not null fk -> guilds(id)`
- `job_type text not null`
- `status job_status not null default 'QUEUED'`
- `attempts int not null default 0`
- `max_attempts int not null default 10`
- `payload_json jsonb not null default '{}'::jsonb`
- `result_json jsonb null`
- `error_text text null`
- `scheduled_at timestamptz not null default now()`
- `started_at timestamptz null`
- `finished_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:
- `ix_job_runs_guild_status(guild_id, status, created_at desc)`
- `ix_job_runs_schedule(status, scheduled_at)`

### 5.8 `oauth_sessions` (backend session store)
Purpose:
- Persist authenticated dashboard sessions safely.

Columns:
- `id uuid pk`
- `user_id uuid not null fk -> users(id)`
- `session_token_hash text not null unique`
- `ip_address text null`
- `user_agent text null`
- `expires_at timestamptz not null`
- `created_at timestamptz not null default now()`

Indexes:
- unique `ux_oauth_sessions_session_token_hash(session_token_hash)`
- `ix_oauth_sessions_user_id(user_id)`
- `ix_oauth_sessions_expires_at(expires_at)`

### 5.9 `webhook_deliveries` (optional phase 2)
Purpose:
- Idempotency and diagnostics for outbound webhooks/integrations.

Columns:
- `id uuid pk`
- `guild_id uuid not null fk -> guilds(id)`
- `event_type text not null`
- `target_url text not null`
- `payload_json jsonb not null`
- `status text not null`
- `attempts int not null default 0`
- `last_error text null`
- `created_at timestamptz not null default now()`

### 5.10 `llm_guild_settings`
Purpose:
- Stores default AI behavior and retention policy per guild.

Columns:
- `id uuid pk`
- `guild_id uuid not null unique fk -> guilds(id)`
- `enabled boolean not null default false`
- `default_model text not null default 'gpt-4.1-mini'`
- `style_prompt text null`
- `retention_days int not null default 90`
- `dm_enabled boolean not null default true`
- `max_input_chars int not null default 4000`
- `max_output_tokens int not null default 512`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### 5.11 `llm_channel_settings`
Purpose:
- Per-channel on/off switch for always-on AI replies, scoped to guild.

Columns:
- `id uuid pk`
- `guild_id uuid not null fk -> guilds(id)`
- `discord_channel_id text not null`
- `enabled boolean not null default false`
- `respond_on_mention_only boolean not null default false`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- unique `(guild_id, discord_channel_id)`

### 5.12 `llm_conversations`
Purpose:
- Memory scope root for both guild channels and DMs.

Columns:
- `id uuid pk`
- `guild_id uuid null fk -> guilds(id)`
- `discord_channel_id text null`
- `discord_user_id text null`
- `type text enum ('GUILD_CHANNEL','DM')`
- `summary_text text null`
- `last_message_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### 5.13 `llm_messages`
Purpose:
- Stores persistent turn history used to build future LLM context.

Columns:
- `id uuid pk`
- `conversation_id uuid not null fk -> llm_conversations(id)`
- `role text enum ('SYSTEM','USER','ASSISTANT')`
- `content text not null`
- `token_count int null`
- `created_at timestamptz not null default now()`

### 5.14 `llm_generations`
Purpose:
- Tracks model/provider execution outcomes and usage.

Columns:
- `id uuid pk`
- `conversation_id uuid not null fk -> llm_conversations(id)`
- `guild_id uuid null fk -> guilds(id)`
- `provider text not null`
- `model text not null`
- `status text enum ('SUCCESS','FAILED','SKIPPED')`
- `input_tokens int not null default 0`
- `output_tokens int not null default 0`
- `latency_ms int not null default 0`
- `error_code text null`
- `error_text text null`
- `created_at timestamptz not null default now()`

### 5.15 `llm_moderation_events`
Purpose:
- Logs moderation/safety checks and actions for observability and review.

Columns:
- `id uuid pk`
- `guild_id uuid null fk -> guilds(id)`
- `conversation_id uuid null fk -> llm_conversations(id)`
- `category text not null`
- `action text not null`
- `details_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

## 6) Referential Integrity and Rules
- Use `ON DELETE RESTRICT` for `guilds` referenced by critical logs/jobs.
- Use `ON DELETE CASCADE` only where safe:
  - `guild_members` from `guilds`
  - `feature_flags` from `guilds`
  - `command_permissions` from `guilds`
- Prevent deleting a guild with unresolved compliance data unless archive/export completed.
- Enforce "cannot demote last OWNER" in application service transaction with locking.

## 7) Transaction and Concurrency Strategy
- Use `SERIALIZABLE` or `REPEATABLE READ` for sensitive role transitions.
- For config updates (`feature_flags`, `command_permissions`), use optimistic concurrency:
  - compare `version` (or `updated_at`) before update.
- For role changes:
  - lock relevant `guild_members` rows (`SELECT ... FOR UPDATE`) to avoid race conditions.

## 8) Indexing Strategy Summary
- Always index:
  - tenant selector first (`guild_id`) for tenant tables.
  - time for list pages (`created_at desc`) where pagination applies.
- Use partial indexes for high-volume statuses if needed, example:
  - `job_runs` failed-only index for support page.
- Review index hit ratios after load testing; remove unused indexes.

## 9) Migration Plan (Phased)
1. `v1_init_core`
- Create enums and core tables: `guilds`, `users`, `guild_members`.
- Seed baseline constraints and indexes.

2. `v2_config_and_policy`
- Add `feature_flags`, `command_permissions`.
- Seed default features and command policies for existing guilds.

3. `v3_audit_and_jobs`
- Add `audit_logs`, `job_runs`.
- Add write hooks in service layer for mutation audit events.

4. `v4_auth_sessions`
- Add `oauth_sessions`.
- Add cleanup job for expired sessions.

5. `v5_security_hardening`
- Introduce RLS policies and request-scoped DB variables.
- Validate all existing queries still pass tenant scoping tests.

## 10) Example DDL Skeleton (Condensed)
```sql
-- Core IDs are generated by the application as UUIDv7 before insert.
create table guilds (
  id uuid primary key,
  discord_guild_id text not null unique,
  name text not null,
  status text not null default 'ACTIVE',
  owner_discord_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  discord_user_id text not null unique,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table guild_members (
  guild_id uuid not null references guilds(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  tenant_role text not null default 'USER',
  status text not null default 'ACTIVE',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);
```

## 11) Data Retention and Maintenance
- `oauth_sessions`: purge expired rows daily.
- `job_runs`: keep full details 90 days, then summarize/archive.
- `audit_logs`: retain at least 12 months.
- Weekly `VACUUM (ANALYZE)` monitoring and autovacuum tuning for high-write tables.
- Monthly restore test from backups.

## 12) Observability and DB Health
- Track:
  - p95 query latency per endpoint/query family
  - deadlocks and lock wait times
  - table bloat/autovacuum lag
  - slow query log outliers
- Add dashboard panels filtered by tenant-heavy tables (`audit_logs`, `job_runs`).

## 13) Validation Checklist Before Production
- All tenant endpoints include `guild_id` predicates.
- Role transition tests cover "last OWNER cannot be removed."
- Audit rows created for every admin mutation endpoint.
- DB migrations are forward-only and reversible by additive rollback strategy.
- Backups verified and restore rehearsal completed.

## 14) Assumptions
- Single Postgres instance for phase 1 with automated backups.
- No cross-guild analytics in phase 1 data model.
- `pg-boss` internal tables are managed by the library and excluded from custom domain schema docs.
- Existing UUIDv4 rows (if any) remain valid; all new rows should use UUIDv7.
