# Phase 0 — Inventory

Audit of `the-one-tracker` at commit `73c7561` (2026-09-24). Discovery only; no code changed in this phase.

## 1. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16.2.6, App Router, React 19.2.6, TypeScript 5.9.3 |
| Rendering | One client-side app (`app/page.tsx` → `app/tracker.tsx`, `"use client"`). Every API route is `dynamic = 'force-dynamic'`. |
| Styling | Tailwind 4 (`@tailwindcss/postcss`) + **7 hand-written global stylesheets** imported in `app/layout.tsx` (`globals`, `modern`, `team`, `login`, `date-picker`, `flow`, `print`, `invoice`) |
| UI kit | shadcn-style components in `components/ui/*` (~60 files, Radix + Base UI). Only a subset is used. |
| Icons | `lucide-react` |
| Database | Postgres. Supabase in production (`DATABASE_URL` = transaction pooler), PGlite (`@electric-sql/pglite`) in `.data/pglite` locally |
| ORM | Drizzle (`db/schema.ts`, 7 migrations in `drizzle/`) — **schema/migrations only**. All runtime queries are hand-written SQL through `lib/database.ts`. |
| Auth | Own implementation: scrypt password hashes, random session token in an `HttpOnly` cookie, token stored hashed. No third-party provider, **no self sign-up**. |
| State | `useState` inside `app/tracker.tsx` + a 5 s poll of `GET /api/records`. No React Query/Redux/Zustand/context store. |
| i18n | Gettext-style: the French string is the key. `lib/i18n/{en,ar}.ts` + `lib/portal-i18n.ts` (fr/ar/en) + `lib/i18n/printing.ts`. `dir=rtl` for Arabic. |
| Mail | Nodemailer via Gmail app password (invitations, client notices) |
| PDF | `pdf-lib` (quotes/invoices/contracts, invitation sheets) |
| Automation | n8n workflow in `automation/`, talks to `/api/editorial/queue` with a bearer token |
| Hosting | Vercel (`the-one-tracker-app`, production alias `space.the1core.com`), daily cron → `/api/flow/sweep` |

### Notable structural facts
- **No `middleware.ts`.** Every authorization decision is taken inside the API route handlers.
- **Only 3 Next.js routes exist**: `/` (the whole studio + portal + print app), `/login`, and the API. Navigation is internal state (`route = {page, id, tab}`), synced to `location.hash`.
- `next.config.ts` sets `typescript.ignoreBuildErrors: true` **and** `eslint.ignoreDuringBuilds: true` — the production build does not enforce either gate.
- `app/tracker.tsx` is **5 217 lines** and holds the routing, most pages, the modals and the design primitives.

## 2. Routes and endpoints

### Pages (Next.js)
| Path | File | Auth |
|---|---|---|
| `/` | `app/page.tsx` → `app/tracker.tsx` | Client-side: renders `<Login>` when `GET /api/records` answers 401 |
| `/login` | `app/login/page.tsx` | Server component; redirects to `/#home` when already signed in |

### Internal "pages" (state routes inside `app/tracker.tsx`)
`home`, `tasks`, `internal` (internal tasks), `clients`, `client` (tabs: overview / projects / tasks / editorial / documents), `task`, `team`, `library`, `flow` (dashboard), `annex` (contract annex), `portal` (client portal, studio preview), `review` (portal review screen).

### Internal pages — The One Print (`app/print-workspace.tsx`)
`dashboard`, `transactions`, `orders`, `factures`, `team`.

### Client portal tabs (`app/portal.tsx`)
`home`, `review`, `tasks`, `calendar`, `files`, `documents`, `request`.

### API endpoints
| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/records` | GET, POST | Session cookie | **The entire app's data plane.** GET returns the role-filtered workspace; POST dispatches ~30 actions (below). |
| `/api/assets` | POST | Session cookie | Upload logo / banner / avatar / audio (limits: 1.5 MB images, 8 MB audio) |
| `/api/assets/[id]` | GET | Session cookie | Serve an asset to members of its workspace (avatars to any signed-in user) |
| `/api/auth/password` | POST | Public (sign-in) / session (change) | `sign-in`, `change-password` |
| `/api/auth/signout` | POST | Session cookie | Delete the session row, clear the cookie |
| `/api/auth/status` | GET | **Public** | Secret-free config health check |
| `/api/editorial/queue` | GET, POST | `Bearer $AUTOMATION_SECRET` | n8n publishing jobs and their outcomes |
| `/api/flow/sweep` | GET/POST | `Bearer $CRON_SECRET` | Daily sweep (48 h tacit validation, reminders) |

### `POST /api/records` actions
- **Membership**: `invite-member`, `renew-invitation`, `set-member-role`, `remove-member`, `create-print-workspace`
- **Generic CRUD**: `create` / `update` for `client`, `project`, `task` (shared block) and dedicated blocks for `library`, `platform`, `editorial_post`, `document`; `delete` (generic + dedicated for `library`, `platform`, `document`)
- **Workflow**: `comment`, `approve`, `request-changes`, `publish`, `request` (portal), `start-timer`, `stop-timer`, `mark-read`, `notify-client`, `update-profile`
- **Print workspace only**: `print-save`, `print-task-status`, `print-delete` (via `lib/printing-server.ts`)

## 3. Roles

Defined in `lib/workspace.ts`. One workspace per studio (`ws:<ownerId>`), plus an optional print workspace (`ws:<ownerId>:print`).

| Role | Scope |
|---|---|
| `owner` | Everything, single instance. Only role that can create clients and see `document` (quotes/invoices). |
| `admin` | Manages existing clients, projects, tasks, archiving, J−7 lock, dashboard, invitations. **No** client creation, **no** documents. |
| `creative` | Own + unassigned tasks, comments, sub-projects. Team read-only. No client create/edit, no task creation, no client validation, no archiving, no dashboard. |
| `print_operator` | Print workspace: own/unassigned print tasks, status, timer. Sees linked orders **without amounts or history**. |
| `viewer` | Read-only across the workspace. No writes, no comments. |
| `client` | Portal only, scoped to their one `clientId`: deliverables, validation, feedback, requests, calendar, their own documents. |

Visibility is enforced server-side by three allowlist functions: `memberView()` (`lib/flow.ts`), `portalView()` (`lib/flow.ts`), `printVisible()` (`lib/printing.ts`), dispatched from `visibleTo()` in the records route.

## 4. Data model

### Tables (`db/schema.ts`)
| Table | Purpose |
|---|---|
| `users` | id, name, avatar, email (unique), `password_hash` (scrypt), `must_change_password`, `failed_logins`, `locked_until`, `invited_at`, `last_login_at` |
| `sessions` | hashed token PK, `user_id`, `expires` (7 days) |
| `workspaces` | id, name, `created_by` |
| `workspace_members` | (`workspace_id`, `user_id`) PK, role, name, email, `client_id` (for the `client` role) |
| `records` | id, owner, `workspace_id`, **`kind`**, `data` jsonb, `revision`. Unique index on (workspace, docType, number) for documents. |
| `assets` | id, workspace, kind (`logo`/`banner`/`avatar`/`audio`), content type, size, `bytes` (bytea), `created_by` |

### Entities (`records.kind`, shaped by `RecordItem` in `lib/model.ts`)
`client`, `project`, `task`, `comment`, `event`, `library`, `document` (devis/facture/contrat), `print_order`, `print_transaction`, `editorial_post`, `platform` — plus `print_document`, which exists in `lib/printing.ts` and the database but **is missing from the `RecordItem['kind']` union** (source of 3 of the 10 TypeScript errors).

Optimistic concurrency everywhere: every write carries the client's `revision` and the UPDATE is `WHERE revision = $n`.

## 5. Feature inventory

| Feature | Where | Roles | Data touched |
|---|---|---|---|
| Sign-in / forced password change / lockout | `/login`, `app/login.tsx`, `/api/auth/password` | everyone | `users`, `sessions` |
| Session (7 days, HttpOnly, `__Host-` when secure) | `lib/auth.ts` | everyone | `sessions` |
| Home dashboard (KPIs, priorities, pending validation) | `HomePage()` | studio | tasks, events |
| Tasks + internal tasks (table, calendar, inline create) | `TaskDatabase()` | studio (create: manager) | task, client, project |
| Task detail (brief, deliverable, timeline, status, timer, comments + voice) | `TaskPage()` | studio | task, comment, event, assets |
| Clients list / client page (overview, sub-projects, tasks, editorial plan, documents) | `ClientsPage()`, `ClientPage()` | studio (create: owner) | client, project, task, document |
| Client images (logo/banner) | `app/client-images.tsx` | manager | assets |
| Editorial plan (calendar, multi-platform, format, duplicate, n8n publishing) | `renderCalendar()` | studio (create: manager) | editorial_post, platform |
| Platforms (editable list, seeded IG/FB/TikTok) | `PlatformPicker` | studio non-viewer | platform |
| Team (invite, roles, renew invitation, remove) | `app/team.tsx` | manager | `workspace_members`, `users` |
| Library (prompts, assets, plugins, presets, websites) | `app/library-page.tsx` | studio | library |
| Dashboard / flow (6 metrics, events, notifications) | `app/flow-page.tsx` | manager | event, task |
| Quotes / invoices / contracts (numbering, PDF, company billing) | `app/client-documents.tsx`, `lib/documents.ts` | **owner + that client** | document |
| Contract annex | `app/annex.tsx` | studio | — |
| Client portal (deliverables, approve, request changes + voice, requests, calendar, documents) | `app/portal.tsx` | client (+ studio preview) | task, comment, event, document |
| 48 h tacit validation, J−7 lock, reminders | `lib/flow.ts`, `/api/flow/sweep` | cron | task, event |
| The One Print (cash ledger, orders, invoices, team, timer) | `app/print-workspace.tsx` | owner/admin/print_operator | print_* |
| Notifications (bell, per-user read state) | `app/notification-bell.tsx` | studio | event |
| Profile & settings (name, avatar, language) | `app/settings-dialog.tsx` | everyone | `users`, assets |
| Workspace switching (Space ⇄ Print) | `app/workspace-switch.tsx` | owner/admin | workspaces |

## 6. Baseline health (measured, not changed)

| Gate | Result |
|---|---|
| `pnpm build` | ✅ passes — **but only because both error gates are disabled in `next.config.ts`** |
| `npx tsc --noEmit` | ❌ **10 errors** (`print-workspace.tsx` ×2, `tracker.tsx` ×2, `document-pdf-core.ts` ×2, `document-pdf.ts`, `printing-server.ts` ×2, `next.config.ts`) |
| `pnpm lint` | ❌ **7 errors, 47 warnings** (all errors are `no-explicit-any`) |
| `pnpm test` | ✅ 10 suites, ~601 assertions, all pass |
| Vercel production | ✅ latest deployment READY, no runtime errors reported |

## 7. Assumptions carried into later phases
1. **Single-tenant by design.** One owner (`OWNER_EMAIL`), one studio workspace, optional print workspace. Multi-studio is out of scope.
2. **No self sign-up is intentional** — accounts exist only by invitation.
3. The `records` jsonb table is deliberate; I will not propose normalising it.
4. French is the source language; EN/AR are translations that fall back to French.
5. Production data is not reachable from here, so every end-to-end check runs against the local PGlite database with local throwaway credentials.
