# Refactoring plan: feature-oriented architecture

Branch `refactor/architecture` (built on `7f34837`). The refactor moved code into features one step at a time. Every step keeps the app's behavior, stored data, URLs and API contracts. Each step is a small commit that is checked before the next one starts. This file is the migration map and progress log. [architecture.md](architecture.md) describes the target layout and the rules that keep it in shape.

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

## 4. Structure reached

See [architecture.md](architecture.md) for the layout, the dependency rules, the request pipeline and the client lifecycle. In short:

```
app/                      routes only (pages, layouts, error pages, app/api/**) and app/styles.css
features/<26 areas>/      screens, hooks, models and server code of one product area each
components/               shared UI with no feature knowledge (+ components/ui, vendored shadcn)
lib/                      shared infrastructure and pure domain rules
styles/                   global foundation stylesheets
```

The largest files, before → after:

| Before | Lines | After | Lines |
|---|---|---|---|
| `app/tracker.tsx` | 5 088 | `features/studio/studio-app.tsx`, plus 25 modules in studio, tasks, clients, dashboard, workspace and components | 341 |
| `app/api/records/route.ts` | 2 275 | the route, plus `features/records/server` (6 modules + 14 action modules) | 14 |
| `app/print-workspace.tsx` | 1 877 | `features/printing/print-workspace.tsx`, plus a hook, 3 pages, a form and a model | 348 |
| `app/portal.tsx` | 960 | `features/portal/portal.tsx`, plus a hook and 7 screen modules | 171 |
| `lib/i18n/en.ts` + `ar.ts` | 2 × 2 553 | `lib/i18n/catalog/*.ts` (26 catalogs, French → [English, Arabic]) | — |

## 5. Migration map, as done

| From | To | Commit |
|------|----|--------|
| `app/api/records/route.ts` (helpers, GET, POST `if` chain) | `features/records/server/{http,workspace-access,payload,context,pipeline,store}.ts` + `actions/*.ts`. The route keeps `dynamic`, `maxDuration`, `GET`, `POST` | `4279db7` |
| `app/locale-provider.tsx` (imported by `components/ui`) | `lib/i18n/locale-provider.tsx`; new `scripts/check-architecture.mjs` | `1ecca63` |
| Tracker `load`/`mutate`/poll/switch/sign-out, `app/brand-store.ts` | `features/workspace/use-workspace-session.ts`, `features/workspace/brand-store.ts` | `c3c0d09` |
| 64 flat `app/*.tsx` and `*.module.css` files | `features/<feature>/` and `components/` (`git mv`, every import and test path rewritten) | `65d4e8d` |
| Tracker pure helpers, task controls, empty state, heading, sidebar pieces | `features/tasks/model.ts` (tested), `task-controls.tsx`, `components/{empty-state,page-heading}.tsx`, `features/workspace/sidebar-nav.tsx` | `34f1084` |
| Tracker task database (toolbar, chips, peek, table, board, calendar) and list state | `features/tasks/task-database.tsx`, `use-task-list-view.ts`, `task-conversation.tsx`, `features/workspace/screen-props.ts` | `7696050` |
| Tracker `HomePage`, `ClientsPage`, `ClientPage`, `TaskPage` | `features/dashboard/home-page.tsx`, `features/clients/{clients-page,client-page}.tsx`, `features/tasks/task-page.tsx` | `4c04e28` |
| The rest of the tracker (editor, dialogs, screens, navigation, page switch) | `features/studio/*`; `app/page.tsx` renders `StudioApp` | `c177dc4` |
| `app/print-workspace.tsx`, `app/FactureEditor.tsx` | `features/printing/*` | `81a43d1` |
| `app/portal.tsx` | `features/portal/*` | `04bd6d0` |
| Global and feature stylesheets in `app/` | `styles/*` and next to their feature; `app/styles.css` keeps the order | `c50e281` |
| `lib/i18n/en.ts`, `lib/i18n/ar.ts` | `lib/i18n/catalog/*` | `2cbd985` |
| Membership query written out in 11 routes | `lib/membership.ts` | `74cefe1` |

## 6. Progress checklist

- [x] Phase 1: inventory and baseline (`a553c5f`)
- [x] Phase 2: records server pipeline and domain action modules; architecture check
- [x] Phase 3: workspace session hook
- [x] Phase 4: feature folders for the flat `app/*.tsx` components (done before the tracker, so the tracker's pieces could land in `features/` without importing `app/`)
- [x] Phase 5: tracker decomposition (four commits)
- [x] Phase 6: print workspace and portal decomposition
- [x] Phase 7: styles and translations organization
- [x] Phase 8: duplication cleanup and measured optimizations
- [x] Phase 9: full verification, docs and final report

## 7. Verification

Each step ended with `tsc --noEmit`, lint, the suites the step touched, and a browser pass on a disposable local database. That database was a fresh `.data/`, with throwaway owner credentials in a git-ignored `.env.development.local` and no mail, WhatsApp, Meta, Drive or AI keys, so nothing could reach a real person.

The browser checks covered:

- Sign-in and polling with 304s.
- Client and task creation, chat (the compact path) and workspace switching.
- Grouping, quick chips, board, calendar and the side panel with j/k.
- Back restoring the list view, inline creation, multi-select.
- Every client tab, the notify dialog, a status change that starts the timer.
- ⌘K search, the J−7 lock prompt, edit/archive/restore/delete.
- Portal preview: all eleven tabs, a request, an approval with its receipt.
- Print workspace: an order, an income entry and its deletion, the invoice editor, team and activity.
- Arabic (right-to-left).
- As a creative member: member home, own and unassigned tasks only, no dashboard or task creation, `#flow` sent home.
- As a client: the portal only, their client's tasks only, studio routes sent back to the portal, receipts on Casablanca's clock.

New regression tests:

| Suite | What it pins |
|---|---|
| `tests/records-pipeline.mjs` | The order of the boundary checks and the action chain's precedence and fall-through (98 assertions, passing on the code before and after the split) |
| `tests/task-model.mjs` | The task list's rules against the tracker's former inline versions on a generated workspace (207 assertions) |
| `tests/print-model.mjs` | The print CSV export: quoting, the spreadsheet formula guard, the layout |
| `tests/i18n.mjs` | One catalog per key, English/Arabic parity, no empty translation, placeholders kept, French fallback |
| `scripts/check-architecture.mjs` | No cycles; no browser module reaching server-only code; lib/ and components/ never import features/ or app/; features/ never imports app/ |

## 8. Before and after

| Measure | Before (`a553c5f`) | After |
|---|---|---|
| `pnpm exec tsc --noEmit` | pass | pass |
| `pnpm lint` | 0 errors, 23 warnings | 0 errors, 20 warnings (the 3 removed were dead code in the portal) |
| `pnpm test` | theme check + 45 suites | theme check + architecture check + 48 suites |
| Compiled theme check | 199 contrast pairs, 27 CSS files | 199 contrast pairs, 27 CSS files |
| Compiled CSS | 6 chunks | byte-identical (same chunk names, sizes and SHA-1) |
| Client JS for `/` (studio) | 2 052.0 KiB raw / 611.9 KiB gzip | 1 972.7 KiB / 594.4 KiB |
| Client JS for `/login` | 910.0 KiB / 277.2 KiB | 820.1 KiB / 254.2 KiB |
| All client chunks | 49 files, 4 109.3 KiB / 1 389.6 KiB | 49 files, 4 033.6 KiB / 1 374.5 KiB |
| Task board derivations, 500 / 2 000 / 5 000 tasks | 10.6 / 67.2 / 221.6 ms | 0.6 / 1.8 / 4.9 ms |
| Largest source file | 5 088 lines (`app/tracker.tsx`) | 860 lines (`features/studio/record-editor.tsx`, mostly the editor's form) |

The JavaScript sizes come from `node scripts/bench/bundle.mjs` and the derivation timings from `node scripts/bench/task-list.mjs` (median of several runs, Node 24).

## 9. Exceptions and decisions

- **One behavior fix, kept separate (`7ef0d11`).** Checking the portal as a real client found that a device in Morocco (`Africa/Casablanca`) read times through the browser's time zone data. Older browsers still put Morocco on UTC+1, so a client saw 13:27 for an approval the studio shows at 12:27. Morocco's zones now read the app's own Casablanca table. It is its own commit so it can be reviewed or cherry-picked apart from the refactor.
- **Order of phases.** The flat components moved to `features/` before the tracker was split, so the new modules never had to import `app/`. The architecture check forbids that.
- **Behavior preserved on purpose, though questionable.** Each of these is noted for a separate decision:
  - Switching workspace re-toasts unread studio alerts, because the set of seen alerts is per session, not per workspace.
  - Inline task creation shows the server's French error untranslated.
  - The printing dictionary's translations of « Terminée », « Voir tout » and one delete message override the app-wide ones on every page.
  - The `route.id` missing-dependency warning on the role redirect effect (`features/studio/use-route-guard.ts`).
- **Dead code.** The portal's never-rendered `Card`, an unused status map and an unused icon import were removed. The design-system count went from 108 to 107 surfaces, because that `Card` held one; its threshold (105) is unchanged.
- **`styles/invoice.css`.** Nothing imports this 450-line sheet. It was moved with the other global sheets, so the checks keep scanning it, rather than deleted. It is a candidate for removal by its owner.
- **Coverage scans widened, never narrowed.** `tests/design-system.mjs` scans `{app,features,components}/**/*.tsx` and every stylesheet. `scripts/check-theme.mjs` also scans `styles/`, `features/` and `components/`. All their thresholds are unchanged.
- **Translation formats.** The new catalogs use `French → [English, Arabic]`. `printing.ts`, `pipeline.ts` and `drive.ts` keep their formats and their precedence: they override a catalog for the 25 keys they share. Converting them would have changed which translation wins for 4 keys.
- **Not done, with reasons.**
  - **POST loads the workspace twice:** once for the checks, once for the answer. Removing a load would change what an answer reflects (sweeps after the write).
  - **A poll that returns 304 still builds the full payload** to hash it. Avoiding that needs a workspace version, which needs a schema change, and the brief excludes migrations for organizational work.
  - **`docs/SAAS-AUDIT.md` and `docs/SAAS-HANDOFF.md`** describe the code as it was and still use the old paths.
- **Development cache.** After pulling this branch, a dev server that reports `Can't resolve '../features/…'` from `app/styles.css` is reading Turbopack's cache from before the moves. Stop it, delete `.next/dev`, and start it again. Production builds are unaffected.
