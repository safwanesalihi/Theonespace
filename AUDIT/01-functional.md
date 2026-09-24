# Phase 1 — Functional audit

Every issue below was found by reading the flow end to end (UI → handler → API → DB → response → UI), by running the build/type-check/linter/tests, or by driving the app in a browser against the local database.

## Gate results

| Gate | Before | After |
|---|---|---|
| `npx tsc --noEmit` | **10 errors** | **0** |
| `pnpm lint` | **7 errors**, 47 warnings | **0 errors**, 9 warnings |
| `pnpm build` | passes *(with both gates disabled)* | passes **with both gates enforced** |
| `pnpm test` | 601 assertions pass | 606 assertions pass (5 new) |
| Untranslated UI strings | 34 (EN) / 34 (AR) + 13 dynamic labels | 0 (AR), 21 (EN — all identical French/English words) |

---

## CRITICAL

### C1 — Archiving a print invoice renumbered it and erased its dates, tax rate, notes and company details
**Location** `lib/printing-server.ts` (`mutatePrinting`), `app/print-workspace.tsx` (Archiver button)

`printSchemas.print_document` is a `.strict()` schema full of `.default()`s, and the update merged `{...existing, ...parsed.data}`. Any payload that left a field out therefore **overwrote the stored value with the schema default**. The "Archiver" button sent only `docType`, `docStatus`, `counterparty`, `lineItems`, `archived` — so archiving a facture blanked `number` (which then triggered the numbering block and assigned a *new* invoice number), `taxRate` → 0, `issuedAt`/`dueAt`/`validUntil` → "", `notes` → "", and dropped the company block.

Reproduced against the real handler before the fix:

```
BEFORE: number FACTURE-2026-0001, taxRate 20, issuedAt 2026-09-01, dueAt 2026-09-30, notes "Merci", billing yes
AFTER : number FACTURE-2026-0002, taxRate  0, issuedAt "",         dueAt "",          notes "",      billing no
```

This is an accounting-integrity defect: a sent invoice silently changed its number and its total.

**Fix applied** On an update, only the fields actually present in the request body are applied — schema defaults can no longer blank an omitted field. Removing the company block is now explicit (`billing: null`) instead of implied by absence, and `app/print-workspace.tsx` sends `null` accordingly. Regression test added in `tests/roles.mjs` asserting that archiving preserves the number, dates, tax rate, notes and company details.

---

## HIGH

### H2 — The production build enforced neither type-checking nor linting
**Location** `next.config.ts`

```ts
typescript: { ignoreBuildErrors: true },
eslint: { ignoreDuringBuilds: true },
```

Ten type errors and seven lint errors were shipping to Vercel unchecked; a green build proved only that the bundler ran. (The `eslint` key is not even valid in Next 16 — it was itself one of the type errors.)

**Fix applied** Both overrides removed after fixing every error underneath. `pnpm build` now runs TypeScript as part of the build and fails on a regression.

### H3 — `print_document` was missing from the record type union
**Location** `lib/model.ts`

The kind exists in the database, in `lib/printing.ts` and in the print workspace UI, but not in `RecordItem['kind']` — the source of 3 of the 10 type errors and the reason the printing code needed `as unknown as RecordItem` casts. Related: a `print_document` has no free-text `name`, which `RecordItem` requires.

**Fix applied** `'print_document'` added to the union; the server now derives `name` from the document's own number (falling back to the client), so listings and search have something to show.

### H4 — Deleting a client left its posting calendar and images behind
**Location** `app/api/records/route.ts` (generic `delete`)

Deleting a client cascaded to projects, tasks, comments, events and voice messages — but not to `editorial_post` rows or the client's uploaded logo/banner. The orphaned posts kept rendering on the studio-wide **Tasks → Calendar** view (which filters on `clientId !== "internal"`, so a dead client's posts still match), under a client that no longer exists. The images stayed in the `assets` table forever.

**Fix applied** Both now go with the client, inside the same transaction. Quotes and invoices are deliberately **kept** (see D1 below). Regression test in `tests/assets.mjs`.

---

## MEDIUM

### M5 — Dead feature: table column resizing
**Location** `app/tracker.tsx`

`defaultColWidths`, `colWidths`, `setColWidths`, `MIN_COL_WIDTH` and a 26-line `startColResize` callback existed, read and wrote `localStorage["the-one.tableColWidths"]` on every mount — and the resulting widths were **never applied to any element**. No `.col-resize-handle` is rendered either. ~50 lines of code and a storage write for nothing.

**Fix applied** Removed.

### M6 — Dead component and dead props
**Location** `app/tracker.tsx`

- `LiveElapsed` (a per-second ticking timer display) was never rendered.
- `TimeTracker` took `busy`, `onStart` and `onStop` and computed `mine`/`myOpenEntry`, but renders no start/stop control — the clock is actually driven by the task's status (`patch` starts an entry on "En cours", stops it when the status leaves). The call site passed three live callbacks into nothing.

**Fix applied** `LiveElapsed` removed; `TimeTracker` reduced to `{ task }` with a comment recording how the timer is really driven.

### M7 — The tasks table column header read "Camp" instead of "Canal"
**Location** `app/tracker.tsx`

The channel column (Instagram/Facebook/TikTok) was labelled `"Camp"` — the key for *court* (the studio/client turn-taking concept), which translates to "Court"/"الجهة". The column shows `task.channel`. The adjacent filter that genuinely *is* the court filter also uses `"Camp"`, so the same word meant two different things one row apart.

**Fix applied** The column header is now `"Canal"`; the court filter keeps `"Camp"`.

### M8 — The home greeting truncated the account name
**Location** `app/tracker.tsx`

`user.name.split(" ")[0]` produced **"Hello, The."** for the owner account named "The One Core". The existing guard only covered the case where the account name exactly equals the workspace name.

**Fix applied** The greeting uses the whole name ("Hello, The One Core.") — never wrong, whatever the account is called. Verified live.

### M9 — 47 untranslated strings in English and Arabic
**Location** `lib/i18n/en.ts`, `lib/i18n/ar.ts`

The gettext-style fallback returns the French source, so an English or Arabic user saw French mixed into the UI. Missing: 34 literal `tr()` keys (whole flows: the invoice editor, the library page, the team invitation confirmation, the "notify the client" dialog, the sidebar's "Tâches internes", the timer strings) plus 13 labels translated *indirectly* through lookup tables and therefore invisible to a naive grep — `docLabels` (Devis/Facture), all five `docStatusLabels` (Brouillon/Envoyé/Accepté/Refusé/Payé), the `Temps` column header, and the `Opérateur impression` role.

**Fix applied** All added to both dictionaries. Arabic is now complete (0 missing); the 21 keys still absent from English are words spelled identically in both languages (Type, Client, Notes, Total, Format…), which the dictionary correctly omits.

### M10 — Dead imports, unused state and an unused helper across six files
**Location** `app/tracker.tsx`, `app/print-workspace.tsx`, `app/library-page.tsx`, `app/portal.tsx`, `app/FactureEditor.tsx`, `lib/document-pdf-core.ts`, `lib/print-html.ts`, `tests/flow-api.mjs`

Included a **broken import** — `Tooltip` imported from `@/components/ui/table`, which does not export it (a type error that a disabled gate hid); an unused `inlineOrder` state pair; `emptyDraft` (dead while the "New invoice" button inlined the same object literal); `buildDocumentPdf`/`downloadPdf` imported into the print workspace but never called; and an unused `_logoBase64` parameter on `printDocumentHtml`.

**Fix applied** All removed; the "New invoice" button now uses `emptyDraft`.

### M11 — `any` types at seven call sites
**Location** `app/tracker.tsx`, `app/print-workspace.tsx`, `app/FactureEditor.tsx`

`FactureEditor` took `draft: any` and `onSave: (doc: any) => void` — the entire invoice editor was unchecked. Three `as any` casts in `app/tracker.tsx` worked around `StatusPick` demanding a full `RecordItem` when the inline "new task" row only has a partial one.

**Fix applied** `Draft` is exported from `app/print-workspace.tsx` and used by the editor; `StatusPick` now declares the two fields it actually reads; the casts and the `catch (e: any)` are gone.

### M12 — Loose PDF option types
**Location** `lib/document-pdf-core.ts`, `lib/document-pdf.ts`

`taxRate?: string | number` was passed straight into `computeTotals(…, taxRate)` (which expects a number) and compared with `> 0`; `logoPngBytes` was declared `Uint8Array` while the browser wrapper passes an `ArrayBuffer | null`. Both worked by luck at runtime.

**Fix applied** `taxRate` narrowed to `number`; `logoPngBytes` widened to `Uint8Array | ArrayBuffer | null`, matching the sibling `lib/invite-pdf-core.ts`.

---

## LOW / observations (no change made)

- **L13 — The tasks table is 1 295 px wide in a 694 px column.** It *is* scrollable (the shadcn `Table` wrapper handles it), but there is no visible affordance, so Assignee → Time look absent at common widths. → Phase 3.
- **L14 — Print invoices download as a browser print dialog, studio documents as a real PDF.** `lib/document-pdf.ts` exists and is imported by the print workspace but never called; the print side opens an iframe and calls `print()` instead. Two different behaviours behind the same "Download" affordance. → Phase 3/4.
- **L15 — `console.error` is the only server-side error reporting** (10 call sites). No error tracking service. → Phase 4.
- **L16 — The 401 in the browser console on first load is expected** (the app probes `/api/records` before knowing whether a session exists) but it is indistinguishable from a real failure when debugging.
- **L17 — No TODO/FIXME/HACK, no `@ts-ignore`, no stray `console.log` anywhere in the codebase.** Worth recording as a positive: the code carries no debt markers.

---

## Decision needed

**D1 — Should deleting a client also delete its quotes and invoices?** Today they are kept (deliberately — they are accounting records), but they become invisible to everyone except the owner, and their client name can no longer be resolved. Options: keep as-is, archive them automatically, or block the client delete while documents exist. I have left the behaviour unchanged pending your call.
