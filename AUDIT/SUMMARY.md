# Production-readiness audit — summary

**App** The One Tracker (`the-one-tracker`) · Next.js 16 + React 19 + Postgres · single-tenant, invitation-only
**Audited** 24–25 September 2026, from commit `73c7561`
**Result** 6 commits, 32 files, +1 366 / −206 lines
**Detail** [00-inventory](00-inventory.md) · [01-functional](01-functional.md) · [02-auth-permissions](02-auth-permissions.md) · [03-ux](03-ux.md) · [04-missing](04-missing.md) · [05-design-system](05-design-system.md)

---

## Health score per area

| Area | Before | After | Note |
|---|---|---|---|
| **Build integrity** | 2 / 10 | **9 / 10** | The build enforced *neither* type-checking nor linting — 10 type errors and 7 lint errors were shipping unchecked. Both gates are on, both counts are zero. |
| **Data integrity** | 4 / 10 | **9 / 10** | Archiving a print invoice renumbered it and erased its dates, tax rate, notes and company details. Fixed at the server, with a regression test. |
| **Auth & permissions** | 7 / 10 | **9 / 10** | The model was already sound — server-side filtering, no client-only gate to bypass. Two real holes closed (CSRF without `Origin`; cross-workspace asset ids). 35 boundary checks now run in CI. |
| **Accessibility** | 3 / 10 | **8 / 10** | 45 measured WCAG-AA failures → **0** across every page. Every form control already had an accessible name; keyboard focus already worked. |
| **i18n** | 5 / 10 | **9 / 10** | 47 strings fell back to French for English and Arabic users, including 13 hidden behind lookup tables. Arabic is now complete. RTL was already properly built, not just translated. |
| **UI consistency** | 2 / 10 | **5 / 10** | Tokens now exist and are authoritative, but six diverged copies of the same stylesheet remain — the real consolidation is a separate, reviewable change (C1). |
| **Feature completeness** | 7 / 10 | **8 / 10** | Nobody could change their own password after first login. Fixed. Export, pagination and bulk actions remain proposals. |
| **Scalability** | 4 / 10 | 4 / 10 | Unchanged by design: the whole workspace ships on a 5-second poll. Needs your decision (P1). |
| **Observability** | 2 / 10 | 2 / 10 | Unchanged: ten `console.error` calls are the entire production error story (M7). |

**Test coverage** 9 suites / 601 assertions → **11 suites / 641 assertions**, including a new `tests/security.mjs`.

---

## The three findings that mattered most

**1. Archiving a print invoice silently corrupted it.** `printSchemas.print_document` is a `.strict()` schema full of `.default()`s, and the update merged `{...existing, ...parsed.data}` — so any payload that omitted a field overwrote it with the default. The Archiver button sent five fields. Reproduced against the real handler:

```
BEFORE: FACTURE-2026-0001 · TVA 20 % · émise 2026-09-01 · notes "Merci" · société oui
AFTER : FACTURE-2026-0002 · TVA  0 % · émise ""          · notes ""      · société non
```

A sent invoice changed its number and its total. Now an update applies only the fields actually sent.

**2. The production build checked nothing.** `next.config.ts` carried `typescript.ignoreBuildErrors: true` *and* `eslint.ignoreDuringBuilds: true`. A green Vercel build meant only that the bundler ran. (One of the hidden errors was a broken import — `Tooltip` from `@/components/ui/table`, which does not export it.)

**3. Nobody could change their own password.** The endpoint existed and was tested, but the only route to it was the forced first-login screen. With no self sign-up and no reset flow, a member whose password leaked had no remedy at all.

---

## Everything fixed

**Phase 1 — functional**
- Print invoice archiving no longer renumbers or blanks the document *(critical)*
- Type-checking and linting re-enabled in the build; 10 type errors → 0, 7 lint errors → 0
- `print_document` added to the record type union (it existed in the DB, the server and the UI, but not the type)
- Deleting a client now takes its posting calendar and uploaded images with it — orphaned posts were still rendering on the studio-wide calendar under a client that no longer existed
- Dead code removed: a column-resize feature that wrote to `localStorage` and was never applied to any element, an unrendered `LiveElapsed`, three dead `TimeTracker` callbacks, unused imports and state across six files
- The tasks table's channel column was labelled "Camp" — the key for *court* — one row from the real court filter
- "Hello, **The**." fixed (the greeting split "The One Core" on whitespace)
- Seven `any` sites typed, including the entire invoice editor
- 47 untranslated strings added to English and Arabic

**Phase 2 — auth & permissions**
- `/api/records` and `/api/assets` accepted requests with **no `Origin` header**, while the sign-in routes already required it; `/api/assets` takes multipart, which a cross-site form can post
- A client logo/banner was validated for UUID shape only — an id from another workspace was accepted, and the avatar mirror then copied that workspace's bytes into an asset any signed-in user can read
- The printed document number was interpolated into HTML unescaped
- `tests/security.mjs`: 35 checks over horizontal access, vertical access, CSRF and asset reach

**Phase 3 — client experience**
- The pinned actions column rendered transparent, drawing its icons over the client name
- A month calendar showed three days of seven on a phone
- Form labels (3.1:1), select placeholders (2.8:1), sidebar caption (2.1:1), search field (2.9:1) raised past AA

**Phase 4 — missing logic**
- Change your own password, from Settings
- Branded 404 and error screens instead of Next's default and a blank page

**Phase 5 — UI uniformity**
- `app/tokens.css`: colour, type, spacing, radius, shadow and breakpoint tokens, loaded last so it actually wins
- All 45 remaining contrast failures cleared, verified page by page in the browser

---

## Decisions I need from you

### Now — these block nothing but change behaviour

| # | Decision | Context |
|---|---|---|
| **D1** | **Should deleting a client delete its quotes and invoices?** Today they survive, deliberately (accounting records) — but become unresolvable: no client name, invisible to all but the owner. Keep / auto-archive / refuse the delete while documents exist? | [01](01-functional.md) |
| **P1** | **How should the app behave at scale?** The whole workspace ships on every 5-second poll: 20 KB today, 1–2 MB after two years, per tab. Cheapest fix is a hash-and-skip; the thorough one is pagination, which changes what the UI can show. | [03](03-ux.md) |
| **D2** | **Delete the 42 unused `components/ui/*` files** and the 12 dependencies that exist only for them (`embla-carousel-react`, `cmdk`, `input-otp`, `vaul`, `react-day-picker`, `sonner`, `react-resizable-panels`, `react-hook-form`, `@shadcn/react`, `next-themes`, `@hookform/resolvers`, `date-fns`)? | [03](03-ux.md) |
| **D3** | **Delete `scripts/check-google-config.mjs`** (`pnpm auth:check`)? It validates Google OAuth variables the app stopped reading three migrations ago, and would report a working setup as broken. | [02](02-auth-permissions.md) |
| **C4** | **Should the print workspace converge on the shared components,** or stay a deliberately separate surface? `print.css` is the largest stylesheet with its own focus rings, dialogs and tables. I assumed separate and left it alone. | [05](05-design-system.md) |

### Ranked backlog

**High — do before the client base grows**
1. **P1 / M4** payload growth and pagination *(1 day)* — the only finding that gets worse on its own
2. **M7** error reporting beyond `console.error` *(½ day)* — today the first report of any production failure comes from a human
3. **M6** a real password-reset flow *(1 day)* — the owner account is the only one that can create clients; losing it loses the workspace
4. **C1** collapse the six copies of the glassmorphism pass *(1–2 days)* — 1 003 `!important` declarations exist almost entirely to fight each other

**Medium**
5. **M3** CSV export on the studio side *(½ day)* — the print workspace already has it
6. **M5** bulk actions on the tasks table *(1 day)* — the month-two complaint
7. **M8 / M9** session renewal, and surfacing an expired session immediately *(3 hours)*
8. **C2** adopt the tokens in the existing stylesheets *(½ day)* — makes a rebrand one line
9. **R1** upload quotas *(½ day)* — no limit on 8 MB audio uploads per account

**Low**
10. **C3** normalise 24 breakpoints to three *(2 hours)*
11. **D4** two "Download" buttons with two different behaviours
12. **P4** desktop scroll affordance on the tasks table; skip-to-content link; input focus weight

---

## What I did not change

- **No feature or data was removed.** Everything on the deletion list above is waiting on you.
- **The `records` jsonb design, the single-tenant model and the no-self-signup rule** were treated as deliberate and left alone.
- **The print workspace's separate styling** was left alone pending C4.
- **Production was never touched.** Every check ran against the local PGlite database with throwaway credentials; production was only ever *read* (deployment status, runtime errors — both clean).

## Worth saying plainly

The parts of this codebase that are usually weak are strong here. Authorization is enforced server-side with allowlists per role, so there is no client-side gate to bypass. Passwords use scrypt with a timing-safe comparison and a dummy verify for unknown accounts; session tokens are stored hashed. Every write carries optimistic concurrency. All SQL is parameterised — the one dynamically-built statement re-checks the actor's own authority inside the write. There are no TODOs, no `@ts-ignore`, no stray `console.log`, and RTL is properly built rather than bolted on.

The weaknesses were concentrated in three places: a build that verified nothing, one update path that could silently corrupt an invoice, and a stylesheet layer that had been copy-pasted into six files until it fought itself. The first two are fixed. The third now has a foundation, and a plan.
