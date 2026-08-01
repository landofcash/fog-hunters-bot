# Administration Dashboard Plan

Status: MVP implemented on 2026-08-01

The implemented MVP includes Discord OAuth entry, authenticated guild routing,
the shadcn-based application shell, guild and Platform Admin directories,
overview, AI and prompt settings, channel controls, command permissions,
administrator roles, audit history, operations, Platform Admin-only model
assignment, and per-guild AI suspension.

Discord channel-name catalog sync, persisted bot heartbeat/OpenAI summaries,
shared browser/server contract packaging, and end-to-end Playwright coverage
remain follow-up hardening work. The current channel UI uses authoritative
Discord channel IDs, and the operations view labels unavailable telemetry
instead of inferring it.

This document defines the administration dashboard for FHAIBot. It replaces the
older Next.js dashboard proposal with a React and Vite single-page application
using shadcn/ui.

## 1. Goals

- Give guild owners and administrators a clear UI for configuring their guild.
- Give platform administrators a controlled view across all registered guilds.
- Make long prompt editing easier than Discord modal inputs.
- Reuse the existing Fastify API, Discord OAuth sessions, Prisma repositories,
  PostgreSQL data, authorization rules, and audit trail.
- Keep every guild as an explicit tenant boundary.

## 2. Access Model

### Guild OWNER

- View and configure their guild.
- Manage guild administrators.
- Configure AI behavior, prompts, channels, command permissions, and retention.
- View, but not change, the AI model assigned to the guild.
- View audit logs and operational status.

### Guild ADMIN

- View and configure guild settings allowed by the API role policy.
- View, but not change, the AI model assigned to the guild.
- View administrators and audit history.
- Cannot grant or remove ownership unless explicitly allowed by backend policy.

### PLATFORM_ADMIN

- Search and view every registered guild.
- Open any guild configuration in an explicit Platform Admin mode.
- Diagnose settings, authorization, bot connectivity, and failures.
- Assign the AI model used by each guild.
- Suspend or restore a guild's AI access to control provider expenses.
- Apply supported configuration changes without impersonating a guild owner.

Platform Admin access must be visually obvious and every effective mutation must
be audited with `actorType: PLATFORM_ADMIN`.

The frontend may hide unavailable actions for usability, but the API remains the
source of truth for authorization.

## 3. MVP Functionality

### Authentication and guild selection

- Sign in with Discord OAuth.
- Restore the existing secure session on refresh.
- Show only authorized guilds to guild-level administrators.
- Show an all-guild directory to Platform Admins.
- Remember the last selected guild as non-sensitive UI preference data.

### Guild overview

- Guild identity and current role.
- Bot/API status.
- Guild AI preference, platform AI access state, effective AI state, and assigned
  model.
- Enabled AI channels.
- Recent administrative changes.
- Recent failures or job status.

### AI settings

- Let guild owners and administrators enable or disable their guild AI
  preference when platform AI access is available.
- Display the assigned model as read-only to guild owners and administrators.
- Allow only Platform Admins to select a model from the backend-supported model
  list.
- Configure DM behavior, retention, input limits, and output limits.
- Edit assistant, gatekeeper, and style prompts independently per guild.
- Reset prompt overrides to application defaults.

### Platform AI policy

- Allow only `PLATFORM_ADMIN` to assign or change a guild's AI model.
- Allow only `PLATFORM_ADMIN` to suspend or restore AI access for a guild.
- Make platform suspension override the guild enabled preference and every
  channel setting.
- Check platform access before any billable provider or gatekeeper request.
- Show guild administrators that AI was disabled by the platform without
  exposing controls that can override it.
- Require confirmation before suspension and audit suspension, restoration, and
  model changes.

### Prompt editing

- Large monospace text area.
- Character counter and configured limit.
- Dirty-state and unsaved-navigation warning.
- Save, reset, and restore actions with confirmation where appropriate.
- Optional full-screen editor dialog.
- No code editor dependency in the MVP.

### Channels

- List Discord channels by name and ID.
- Enable or disable AI per channel.
- Configure mention-only behavior.
- Clear retained channel memory with a destructive-action confirmation.

### Command permissions

- List configurable commands.
- Set minimum role.
- Configure allowed and denied channels.
- Explain that denied channels take precedence.

### Administrators

- List owners and administrators.
- Add or remove administrators where the actor is authorized.
- Protect owners from administrator removal flows.
- Confirm effective role changes and show the resulting role.

### Audit and operations

- Filter audit entries by actor and action.
- View before/after values in a side panel.
- View recent jobs and failures.
- Show API, bot connectivity, and OpenAI failure indicators when data is
  available.

## 4. Technology Stack

### Frontend

- React with TypeScript.
- Vite for development and production builds.
- Tailwind CSS v4.
- shadcn/ui as the only UI control system.
- React Router for application routing.
- TanStack Query v5 for server state, caching, mutations, and invalidation.
- React Hook Form with Zod validation.
- TanStack Table for guild, member, administrator, audit, and job tables.
- Lucide React for icons.
- Sonner for mutation success and failure notifications.
- date-fns for dates, relative timestamps, and retention values.

### Testing

- Vitest for frontend unit tests.
- React Testing Library for component and form behavior.
- Mock Service Worker for API contract scenarios.
- Playwright for critical browser flows.

### Existing backend

- Fastify API.
- Prisma and PostgreSQL.
- Discord OAuth session cookies.
- CSRF protection for mutations.
- Guild roles and `PLATFORM_ADMIN` authorization.
- Audit logs and PostgreSQL-backed jobs.

### Libraries intentionally deferred

- Redux or Zustand: unnecessary while TanStack Query, form state, router state,
  and local React state cover the dashboard.
- Monaco or CodeMirror: unnecessary for plain-text prompts.
- A second UI framework such as Material UI, Mantine, or Ant Design.
- Charting until useful operational metrics are stored.
- Storybook until the application has enough custom shared components to
  justify maintaining it.

## 5. Project Structure

```text
apps/
  admin/
    src/
      api/
      components/
        ui/
      features/
        auth/
        guilds/
        ai/
        channels/
        commands/
        administrators/
        audit/
        operations/
      layouts/
      routes/
      test/
  api/
  bot/

packages/
  contracts/
```

`packages/contracts` should contain browser-safe Zod schemas and shared
TypeScript types. It must not contain server configuration, Prisma clients, or
secrets.

## 6. UI Structure and shadcn Controls

### Application shell

- `Sidebar` for primary navigation.
- `Breadcrumb` for guild and page context.
- `Command` for fast guild switching.
- `Avatar`, `DropdownMenu`, and `Badge` for the current user and role.
- `Alert` or persistent banner for Platform Admin mode.
- `Alert` and `Badge` for a guild whose AI access is suspended by the platform.

### Settings pages

- `Card`, `Tabs`, and `Separator` for sections.
- `Switch`, `Select`, `Input`, and `Textarea` for settings.
- A read-only model field for guild owners and administrators.
- A Platform Admin-only model `Select` and AI access `Switch`.
- `Field` and React Hook Form integration for validation messages.
- `Skeleton` for initial loading.
- `Tooltip` for technical options.

### Lists and actions

- shadcn `Table` composed with TanStack Table.
- `Badge` for roles, job states, and health states.
- `DropdownMenu` for row actions.
- `Sheet` for record details and audit before/after data.
- `Dialog` for focused editing.
- `AlertDialog` for destructive actions.
- `Sonner` toasts for mutation outcomes.

## 7. Routes

```text
/login
/guilds
/guilds/:guildId/overview
/guilds/:guildId/ai
/guilds/:guildId/channels
/guilds/:guildId/commands
/guilds/:guildId/administrators
/guilds/:guildId/audit
/guilds/:guildId/operations
/platform/guilds
```

`/platform/guilds` is available only to `PLATFORM_ADMIN`. Opening a guild from
that page uses the normal guild routes with a persistent Platform Admin banner.

Unknown or unauthorized guild routes show a dedicated access-denied page and do
not attempt to render cached tenant data.

## 8. API Integration

### Existing endpoints to reuse

- `GET /api/v1/me`
- `GET /api/v1/guilds/:guildId/settings`
- `PATCH /api/v1/guilds/:guildId/features/:featureKey`
- `PATCH /api/v1/guilds/:guildId/commands/:commandKey`
- `GET /api/v1/guilds/:guildId/members`
- `PUT /api/v1/guilds/:guildId/roles/:userId`
- `GET /api/v1/guilds/:guildId/audit-logs`
- `GET /api/v1/guilds/:guildId/jobs`
- `GET /api/v1/guilds/:guildId/llm/settings`
- `PATCH /api/v1/guilds/:guildId/llm/settings`
- `POST /api/v1/guilds/:guildId/llm/channels/:channelId`
- `DELETE /api/v1/guilds/:guildId/llm/channels/:channelId`
- `POST /api/v1/guilds/:guildId/llm/memory/channels/:channelId/clear`

### API gaps to implement

- Cursor-paginated Platform Admin guild directory.
- Platform Admin guild summary and operational status.
- Dashboard-readable Discord channel catalog with names and IDs.
- Platform Admin-only supported AI model metadata for the model selector.
- Platform Admin AI policy mutation for the assigned model and per-guild AI
  access state.
- Field-level authorization that rejects model changes from guild owners and
  administrators, including direct API requests.
- Bot connectivity and recent OpenAI failure summaries.
- Any missing owner-only administrator mutations required by the web UI.

All list endpoints should support pagination appropriate to their expected size.
Table filters should be translated into API filters instead of downloading
unbounded cross-guild data.

### AI enablement rules

AI availability must use separate guild and platform controls:

```text
effectiveAiEnabled =
  globalAiEnabled
  AND platformGuildAiEnabled
  AND guildAiEnabled
```

- `guildAiEnabled` is the guild owner's or administrator's preference.
- `platformGuildAiEnabled` is controlled only by `PLATFORM_ADMIN`.
- The existing global AI kill switch remains the highest-level override.
- The effective state must be checked inside the API before any OpenAI request,
  not only in the dashboard or Discord command handler.
- A platform-suspended request must return a non-billable disabled result and
  must not invoke the configured LLM provider.
- Model assignment and platform access changes must create audit records.

## 9. Authentication and Security

- Reuse Discord OAuth authorization-code flow handled by the API.
- Keep the session token in an `httpOnly`, `secure`, `sameSite` cookie.
- Never store access tokens or session tokens in browser storage.
- Send the existing CSRF token/header on every mutation.
- Enforce guild scope and roles on every API request.
- Enforce Platform Admin access in the API, not only in route guards.
- Reject model assignment and platform AI access mutations from guild-level
  owners and administrators.
- Prevent guild settings mutations from bypassing a platform AI suspension.
- Do not implement silent owner impersonation.
- Audit every effective guild or platform mutation.
- Confirm destructive actions such as clearing memory or disabling a guild.
- Clear guild-specific query caches when switching identity or logging out.

## 10. Data and Form Behavior

- Fetch server state through TanStack Query.
- Use guild-scoped query keys such as `["guild", guildId, "llm-settings"]`.
- Invalidate affected queries after successful mutations.
- Use optimistic updates only for reversible, low-risk toggles.
- Use React Hook Form and shared Zod schemas for settings validation.
- Preserve form input after recoverable API failures.
- Show field errors for validation failures and a general error for transport or
  authorization failures.
- Treat `409` responses as conflicts and refresh the affected server state.

## 11. Deployment

The initial dashboard should use same-origin deployment:

```text
https://admin.example.com/
https://admin.example.com/api/v1/...
```

- Vite provides the local development server and proxies `/api` to Fastify.
- Production runs `vite build`.
- Fastify serves the compiled SPA and handles the `/api/v1` routes.
- The SPA fallback must never intercept API or health endpoints.

This avoids cross-origin cookie and CORS complexity. A separate frontend service
can be introduced later if scaling or release independence requires it.

## 12. Delivery Phases

### Phase 1: Foundation

- Create `apps/admin`.
- Add Vite, React, TypeScript, Tailwind, and shadcn/ui.
- Add shared contracts package.
- Implement API client, CSRF handling, Discord login, route guards, and app
  shell.

### Phase 2: Guild AI configuration

- Guild selector and overview.
- AI settings form.
- Prompt editors.
- Read-only assigned model display.
- Channel settings and memory clearing.

### Phase 3: Administration

- Command permissions.
- Administrator management.
- Audit log and operational views.

### Phase 4: Platform administration

- All-guild directory.
- Guild search, filters, and status.
- Explicit Platform Admin mode.
- Per-guild model assignment.
- Per-guild AI suspension and restoration.
- Cross-guild diagnostics and audited configuration.

### Phase 5: Hardening

- Empty, loading, failure, conflict, and permission-denied states.
- Accessibility review.
- Authorization tests proving guild owners and administrators cannot change the
  assigned model or restore platform-suspended AI.
- Provider tests proving a suspended guild performs no OpenAI request.
- Unit, integration, and Playwright coverage.
- Production error reporting and frontend health monitoring.

## 13. Definition of Done

- A guild owner can configure AI behavior, prompts, channels, commands,
  administrators, and retention without changing the platform-assigned model.
- A guild administrator sees only authorized guilds and actions.
- A Platform Admin can search and inspect all guilds with an explicit mode
  indicator.
- Only a Platform Admin can assign a guild model or suspend and restore its AI
  access.
- A platform-suspended guild cannot cause billable provider calls.
- Cross-guild access is rejected by the API.
- Every effective administrative change is auditable.
- Authentication tokens are never exposed to browser JavaScript or storage.
- Critical dashboard workflows have automated browser coverage.
- The production dashboard and API work through the same origin.

## 14. Non-Goals for the MVP

- End-user chat inside the dashboard.
- Billing or subscription management.
- Rich analytics without stored metrics.
- Mobile-native applications.
- General-purpose Discord server administration unrelated to FHAIBot.
