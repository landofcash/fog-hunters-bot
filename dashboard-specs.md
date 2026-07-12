# Dashboard Specs (Next.js + React)

## 1) Purpose
This document defines the frontend dashboard implementation for the multi-tenant Discord bot platform.

Goals:
- Let server admins configure bot behavior for their own server only.
- Provide safe tenant isolation by design (`guildId`-scoped UI and API usage).
- Offer operational visibility (audit logs and job status).

Non-goals:
- End-user chat UX inside dashboard.
- Cross-tenant analytics UI in phase 1.

## 2) Stack and Standards
- Framework: `Next.js 15+` (App Router)
- UI: `React 19` + `TypeScript`
- Styling: `Tailwind CSS`
- Components: `shadcn/ui` primitives
- State:
  - Server state: `@tanstack/react-query`
  - Local UI state: React state/hooks
- Forms and validation: `react-hook-form` + `zod`
- Date/time: `dayjs` (UTC-first display, local tooltip optional)
- Tables: `@tanstack/react-table`
- Logging: browser console only in dev; production errors to backend/Sentry

## 3) URL and Routing Model
All authenticated routes are guild-scoped.

Routes:
- `/login`
- `/select-server`
- `/[guildId]/overview`
- `/[guildId]/settings/features`
- `/[guildId]/settings/commands`
- `/[guildId]/settings/roles`
- `/[guildId]/audit-logs`
- `/[guildId]/jobs`

Route behavior:
- If unauthenticated: redirect to `/login`.
- If authenticated but no access to `guildId`: return 403 page with link to `/select-server`.
- If last selected guild exists and is still authorized: auto-redirect from `/select-server`.

## 4) Auth and Session
- OAuth provider: Discord OAuth2 (authorization code flow handled by backend).
- Session transport: secure cookie (`httpOnly`, `secure`, `sameSite=lax`).
- Frontend never stores tokens in `localStorage`.
- Frontend bootstraps with `GET /api/v1/me` to resolve user profile + accessible guilds + tenant roles.

`GET /api/v1/me` response shape:
```json
{
  "user": {
    "id": "usr_123",
    "discordUserId": "1234567890",
    "username": "alice"
  },
  "memberships": [
    {
      "guildId": "9876543210",
      "guildName": "Fog Hunters",
      "tenantRole": "ADMIN"
    }
  ],
  "platformRole": null
}
```

## 5) Layout and Navigation
Global app shell on all `/:guildId/*` pages:
- Left nav:
  - Overview
  - Features
  - Commands
  - Roles
  - Audit Logs
  - Jobs
- Top bar:
  - Guild switcher
  - Current user menu (profile/logout)
  - Role badge (`OWNER`, `ADMIN`, etc.)
- Main panel: route content

UX rules:
- Every page title includes guild name.
- Critical actions require confirm dialogs.
- Save/mutation outcomes always show toast + inline status.

## 6) Page-by-Page Specs

### 6.1 Login (`/login`)
Components:
- “Login with Discord” button
- Minimal product explanation

Actions:
- Click button -> redirect to backend OAuth start endpoint.

Acceptance:
- User can enter auth flow and return authenticated.

### 6.2 Server Selector (`/select-server`)
Components:
- Searchable list of authorized guilds from `GET /api/v1/me`
- Cards with guild name + role badge

Actions:
- Select guild -> navigate to `/{guildId}/overview`.

Acceptance:
- Only authorized guilds appear.

### 6.3 Overview (`/[guildId]/overview`)
Data:
- `GET /api/v1/guilds/:guildId/settings` (summary block)
- `GET /api/v1/guilds/:guildId/jobs?limit=5`
- `GET /api/v1/guilds/:guildId/audit-logs?limit=5`

Components:
- Feature summary cards
- Recent admin actions table
- Recent jobs panel

Acceptance:
- Overview loads in one screen without deep navigation.

### 6.4 Features (`/[guildId]/settings/features`)
Data:
- `GET /api/v1/guilds/:guildId/settings` returns `features[]`

Mutation:
- `PATCH /api/v1/guilds/:guildId/features/:featureKey`

Request shape:
```json
{
  "enabled": true,
  "config": {
    "threshold": 3
  }
}
```

Components:
- Feature list with on/off switch
- Per-feature JSON config editor (schema-guided where possible)
- Save button and dirty-state indicator

Rules:
- Disable toggle if role lacks permission.
- Validate config with zod schema per feature.

Acceptance:
- Toggle/config updates persist and reflect immediately.

### 6.5 Commands (`/[guildId]/settings/commands`)
Data:
- `GET /api/v1/guilds/:guildId/settings` returns `commands[]`

Mutation:
- `PATCH /api/v1/guilds/:guildId/commands/:commandKey`

Request shape:
```json
{
  "minRole": "MODERATOR",
  "allowChannels": ["123", "456"],
  "denyChannels": ["789"]
}
```

Components:
- Command permissions table
- Role dropdown per command
- Channel allow/deny multiselect

Rules:
- `denyChannels` wins if overlap occurs.
- Role hierarchy enforcement in UI and backend.

Acceptance:
- Policy edits are saved and reflected in subsequent reads.

### 6.6 Roles (`/[guildId]/settings/roles`)
Data:
- `GET /api/v1/guilds/:guildId/members?cursor=...`

Mutation:
- `PUT /api/v1/guilds/:guildId/roles/:userId`

Request shape:
```json
{
  "tenantRole": "ADMIN"
}
```

Components:
- Member table with search
- Role badge + role selector
- Pagination controls

Rules:
- `ADMIN` cannot assign `OWNER`.
- Prevent demoting last `OWNER`.

Acceptance:
- Role changes enforce constraints and create audit entries.

### 6.7 Audit Logs (`/[guildId]/audit-logs`)
Data:
- `GET /api/v1/guilds/:guildId/audit-logs?cursor=...&actor=...&action=...&from=...&to=...`

Components:
- Filter bar (actor, action, date range)
- Cursor-paginated table
- Row detail drawer (before/after diff)

Acceptance:
- Admin can trace who changed what and when.

### 6.8 Jobs (`/[guildId]/jobs`)
Data:
- `GET /api/v1/guilds/:guildId/jobs?status=...&cursor=...`

Components:
- Job status table (`queued`, `running`, `failed`, `completed`)
- Retry count and last error display
- Manual retry action (optional in phase 1.1)

Acceptance:
- Failed jobs are visible with enough context for support.

## 7) API Contract Expectations
All endpoints are under `/api/v1` and require authenticated session.

Required endpoints:
- `GET /me`
- `GET /guilds/:guildId/settings`
- `PATCH /guilds/:guildId/features/:featureKey`
- `PATCH /guilds/:guildId/commands/:commandKey`
- `GET /guilds/:guildId/members`
- `PUT /guilds/:guildId/roles/:userId`
- `GET /guilds/:guildId/audit-logs`
- `GET /guilds/:guildId/jobs`

Response rules:
- Mutations return updated entity snapshot and `auditLogId`.
- Validation errors return 400 with field-level detail.
- Permission errors return 403.
- Unknown guild or entity returns 404.

## 8) Permission and Security Requirements
- Frontend route guard + backend enforcement (backend is source of truth).
- Every request uses explicit `guildId` path param, validated server-side against membership.
- CSRF protection on mutating endpoints.
- Strict Content Security Policy in production.
- No secrets exposed to browser.
- Audit log events for all admin mutations.

## 9) Performance Requirements
- First meaningful render target: < 2.5s on typical broadband for cached static assets.
- Table views use cursor pagination (no full dataset fetches).
- Debounced filtering (250-400ms) for audit/member searches.
- Use optimistic updates only for low-risk toggles; rollback on failure.

## 10) Accessibility and UX Quality
- Keyboard navigable controls and dialogs.
- Visible focus states.
- Color contrast at WCAG AA minimum.
- Action labels are explicit (avoid icon-only actions for destructive operations).

## 11) Frontend Testing Plan
- Unit tests:
  - Form schema validation
  - Permission-aware component rendering
  - Utility formatters and table mapping
- Integration tests:
  - Feature toggle + config save flow
  - Role update flow with forbidden transition case
  - Command policy edit flow
- E2E tests:
  - Login -> guild select -> change feature -> verify audit row appears
  - Unauthorized guild URL returns 403 view
  - Session expiry redirects to `/login`

## 12) Analytics and Monitoring (Frontend)
- Track events:
  - `guild_selected`
  - `feature_toggled`
  - `role_changed`
  - `command_policy_updated`
- Include `guildId` and actor id in event payload (no sensitive content).
- Capture frontend exceptions and failed API actions for observability.

## 13) Delivery Milestones
1. Shell + auth bootstrap (`/login`, `/select-server`, app shell)
2. Overview + features page end-to-end
3. Commands + roles management
4. Audit logs + jobs views
5. Hardening: accessibility, tests, telemetry, polish

## 14) Acceptance Criteria (Definition of Done)
- Authenticated admin can fully manage features, command permissions, and roles for authorized guilds.
- Cross-guild access is blocked at UI and API levels.
- Every admin mutation generates visible audit records.
- Failed background jobs are discoverable from dashboard.
- Automated tests cover critical isolation and permission scenarios.
