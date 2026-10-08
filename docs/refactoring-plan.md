# Refactoring plan: feature-oriented architecture

Branch `refactor/architecture`. The refactor moves code into features one step at a time. Every step keeps the app's behavior, stored data, URLs and API contracts. Each step is a small commit that is checked before the next one starts. This file is the migration map and progress log. [architecture.md](architecture.md) describes the target layout and the rules that keep it in shape.

## 1. Inventory (before)

| # | Area | Where it lived | Notes |
|---|------|----------------|-------|
| 1 | Entry points | `app/page.tsx` → `Landing` (signed out) or `Tracker` (signed in); `app/login/page.tsx`; `app/plan-editorial/print`; `app/admin/finance`; legal pages | Hash routing (`#home`, `#tasks`, `#client/…`) lives in `app/use-workspace-navigation.ts` + `lib/navigation.ts` |
| 2 | Features | One 5 088-line `app/tracker.tsx` component (tasks list/board/calendar/table, peek, task page, clients, client page, home dashboard, modals, search, lock prompt, workspace frame/nav), plus ~60 flat `app/*.tsx` feature components | `print-workspace.tsx` 1 877 lines, `portal.tsx` 960 lines |
| 3 | Auth / roles | `lib/auth.ts` (session cookie), `lib/password-auth.ts`, `lib/workspace.ts` (roles: owner, admin, creative, social, print_operator, viewer, client + predicates) | Platform owner = `OWNER_EMAIL` |
| 4 | Data lifecycle | Client: `Tracker.load()` / `mutate()` with `WorkspaceLoader`, sequence numbers, pending loads, ETag/304, `X-Server-Time`, 5 s polling, compact chat path. Server: `app/api/records/route.ts` (2 275 lines: identity, workspace resolution, payload, 40+ actions in one `if` chain) | Storage keys: `the-one.workspace` (session), `the-one.sidebarWidth`, `the-one.nav-layout`, `the-one.nav-groups`, theme key |
| 5 | Rules vs server | Pure rules in `lib/flow.ts`, `lib/printing.ts`, `lib/client-pipeline.ts`, `lib/documents.ts`, `lib/workflow-settings.ts`, `lib/task-mentions.ts`; server-only in `lib/*-server.ts`, `lib/mail.ts`, `lib/whatsapp.ts`, `lib/database.ts` | No import cycles; no client module reaches a server module (checked with `tools/import-graph.mjs`) |
| 6 | Integrations | Mail (nodemailer), WhatsApp Cloud API, Meta/TikTok/YouTube publish, Google Drive, Gemini/Groq, Daily, Apify, Supabase storage | All mocked in tests |
| 7 | Styles / i18n | `app/styles.css` imports 12 global sheets in a fixed order; `app/tokens.css` 2 106 lines; CSS modules for client brief/drive/pipeline. `lib/i18n/{en,ar}.ts` 2 553 lines each, French-keyed `t()` | RTL for Arabic |
| 8 | Tests | 45 `tests/*.mjs` suites bundling entry points with esbuild + `tests/helpers/pg.mjs` (`testRuntimePlugin` stubs `@/lib/database`, `@/lib/env`, `next/headers`, `next/server`, `@/lib/auth` **by exact specifier**); `tests/design-system.mjs` globs `app/**/*.tsx` and `app/*.css`; `scripts/check-theme.mjs` reads `app/design-tokens.css`, `app/theme.css`, `app/landing.css` | 28 references to `app/api/records/route.ts` as the entry point |
| 9 | Large files / duplication | `tracker.tsx`, `records/route.ts`, `print-workspace.tsx`, `portal.tsx`, `tokens.css`; membership lookup repeated in 7 routes; the same optimistic `UPDATE … revision = $4` written 20+ times; the comment/attachment asset cascade repeated in two delete paths | |
| 10 | Invariants | See §3 | |

## 2. Baseline (commit `7f34837`, before any refactor)

| Check | Result | Time |
|-------|--------|------|
| `pnpm exec tsc --noEmit` | pass | 5 s |
| `pnpm lint` | pass: 0 errors, 23 warnings | 19 s |
| `pnpm test` | pass: theme check + 45 suites | 141 s |
| `pnpm build` (+ postbuild compiled theme check) | pass: 199 contrast pairs, 27 CSS files | 7 s (cached) |
| Import graph | 250 modules, 0 cycles, 0 client→server imports | |
| Initial JS `/conditions` | 11 scripts, 1 044.3 KiB raw / 326.2 KiB gzip | |
| Initial JS `/plan-editorial/print` | 15 scripts, 1 153.1 KiB raw / 362.0 KiB gzip | |
| All client chunks | 49 files, 4 109 KiB raw / 1 390 KiB gzip | |

`/` and `/login` are dynamic (`force-dynamic`), so the route measurement script cannot measure them from prerendered HTML. Their JavaScript is measured from the build manifest instead (§6).

## 3. Invariants that every step must keep

- **API:** the request and response shapes of every route, including field names, status codes, French error strings and the `code` values (`lock`, `no-workspace`, `password-change-required`, `duplicate`, plan codes).
- **Records pipeline order:**
  1. Authentication.
  2. Must-change-password check.
  3. Same origin.
  4. JSON content type.
  5. Size cap of 300 000 characters (25 000 except for briefs and service scopes).
  6. Parse into an object.
  7. Workspace resolution.
  8. Row load: the compact thread for chat actions, the full workspace otherwise.
  9. Client context check.
  10. Plan refusal, with its exemptions.
  11. `request-plan`.
  12. The print workspace gate.
  13. Actions, in their original order (including the `library-favorite`/`library-used` fall-through for non-studio roles).
  14. Generic create/update, otherwise `Action invalide.`
- **Data:** the JSONB `records.data` shape and the `meta` row ids (`titles:…`, `whatsapp:…`, `brand…`, workflow settings key, `whatsapp-retry:…` leases) stay unchanged. No migration.
- **Client lifecycle:** these must all be kept:
  - `WorkspaceLoader` cancellation.
  - The `loadSeq` stale-response guard.
  - The pending-load counter, so polling skips while a save is in flight.
  - Switch state.
  - ETag / 304.
  - `X-Server-Time` clock sync.
  - The compact chat merge (`data.message`).
  - The 5 s polling, only while the page is visible, a workspace exists and no switch is in progress.
  - The storage keys.
  - Hydration safety: the first render matches the server, and storage is read in effects.
- **Permissions:** the server views stay unchanged (`portalView`, `memberView`, `printVisible`, document stripping for non-owners), and so do the client-side role gates.
- **Time:** the Casablanca utilities (`lib/time.ts`, `lib/casablanca-offsets.ts`, `lib/app-clock.ts`).
- **Chat:** chat behaviors stay the same: delivery and seen receipts, reply, owner/admin delete, voice and files, mentions and the WhatsApp cooldown.
- **Tests:** the harness assumptions hold:
  - Server code reaches the database, env, auth and `next/*` only through the stubbed specifiers.
  - No assertion is removed.
  - Coverage thresholds are not lowered.

## 4. Target structure

```
app/                      Next.js routes only: page/layout/route/error files and the global CSS entry
  api/records/route.ts    thin: segment config + GET/POST delegating to features/records/server
features/
  records/server/         /api/records: request pipeline, typed action context, ordered action steps
    http.ts               JSON/ETag responses, typed errors
    workspace-access.ts   identity → workspace resolution, membership, roster, brand
    payload.ts            row loading, per-role views, transport trimming, the page payload
    context.ts            ActionContext (user, workspace, rows, shared helpers)
    pipeline.ts           GET / POST: the ordered boundary checks, then the action chain
    actions/*.ts          one module per domain (members, chat, approval, meetings, requests, …)
  workspace/              session lifecycle hook, frame, navigation, switcher
  tasks/                  task model (pure), list/board/calendar/table views, peek, task page, chat, timers
  clients/                clients list, client page, brief, drive, documents, pipeline
  dashboard/              home page metrics and charts
  printing/               print workspace (split into views + model)
  portal/                 client portal (split into views)
  social/ library/ flow/ activity/ meetings/ assistant/ team/ requests/ platform/ ig-analyzer/ landing/ auth/
lib/                      shared infrastructure and pure domain rules (unchanged public API)
components/ui/            shadcn primitives (vendored, untouched)
```

Dependencies point one way: `app → features → lib → (nothing app-specific)`. A feature may import another feature's public module. `lib` never imports from `features` or `app`. Client modules never import server modules. `scripts/check-architecture.mjs` enforces these rules in `pnpm test`.

## 5. Migration map

| From | To | Phase |
|------|----|-------|
| `app/api/records/route.ts` (helpers, GET, POST if-chain) | `features/records/server/{http,workspace-access,payload,context,pipeline}.ts` + `actions/*.ts`; route keeps `dynamic`, `maxDuration`, `GET`, `POST` | 2 |
| `Tracker.load/mutate/poll/switch` | `features/workspace/use-workspace-session.ts` | 3 |
| Tracker pure helpers (`timerTotals`, filters, quick tests, due info, grouping) | `features/tasks/model.ts` (unit tested) | 4 |
| Tracker render helpers (`TaskTable`, `Board`, `renderCalendar`, `PeekPanel`, `Toolbar`, `HomePage`, `ClientsPage`, `ClientPage`, `TaskPage`, modals, nav) | `features/{tasks,clients,dashboard,workspace}/…` components with typed props | 4 |
| `app/*.tsx` feature components | `features/<feature>/` (`git mv`, imports updated) | 5 |
| `app/print-workspace.tsx`, `app/portal.tsx` | `features/printing/*`, `features/portal/*` | 6 |
| Feature CSS | next to its feature, imported from `app/styles.css` in the same cascade order | 7 |
| i18n dictionaries | `lib/i18n/` kept as the single source; any per-feature split is documented in §7 | 7 |

## 6. Progress checklist

- [x] Phase 1: inventory and baseline
- [ ] Phase 2: records server pipeline and domain action modules
- [ ] Phase 3: workspace session hook
- [ ] Phase 4: tracker decomposition
- [ ] Phase 5: feature folders for the flat `app/*.tsx` components
- [ ] Phase 6: print workspace and portal decomposition
- [ ] Phase 7: styles and translations organization
- [ ] Phase 8: duplication cleanup and measured optimizations
- [ ] Phase 9: full verification, docs and final report

## 7. Exceptions and decisions

Each one is recorded with its reason when it is made.
