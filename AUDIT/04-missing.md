# Phase 4 — Missing logic

What a real user would expect to find and doesn't. Ordered: implemented first, then proposed.

## Already present — checked, not missing

Worth recording so the proposals below are not mistaken for gaps that already have answers:

| Expected | Status |
|---|---|
| Confirmation before delete | ✅ everywhere — the tracker's delete modal, the print workspace's `AlertDialog`s, library, documents, team |
| Soft delete | ✅ `archived` on clients, projects, tasks, transactions and documents, with a restore path |
| Audit trail / status history | ✅ every record carries `history[]`, plus `event` records and an immutable `signOff` receipt |
| Search | ✅ global ⌘K search across clients, tasks and projects |
| Filter + sort | ✅ tasks filter by status, assignee and court; sort by name, status or due date |
| Empty states / onboarding | ✅ `Empty` components and a three-step setup card on an empty workspace |
| Notifications | ✅ per-user read state, bell, toasts, e-mail to clients |
| Input limits | ✅ zod on every write; 25 KB body cap; upload size and type allowlists |
| Export | ⚠️ partial — CSV exists in the print workspace only (see M3) |
| Pagination | ❌ none anywhere (see M4) |

---

## Implemented in this phase

### ✅ M1 — Change your own password (essential, was impossible)
**Location** `app/settings-dialog.tsx`

`changePassword` existed in the API, was tested, and closed every other session — but the **only** way to reach it was the forced first-login screen. After that first sign-in, a user could never change their password again. Combined with "no self sign-up" and a sign-in screen that says *"Forgot your password? Ask the studio to resend an invitation"*, a member whose password leaked had no self-service remedy at all.

Added a password section to Settings: current password, new password, confirmation, with the existing server rules. Verified live — wrong current password → 401, identical password → 400, under 10 characters → 400, valid change → 200, and the other sessions are closed by the endpoint as before.

### ✅ M2 — Branded 404 and error screens
**Location** `app/not-found.tsx`, `app/error.tsx`

Any address other than `/` and `/login` produced Next's unstyled default 404, and a render exception produced a blank page. Both now use the app's own boot screen with a way back; the error screen also offers `reset()` and shows the Next `digest` so a report can be matched to a server log. Verified live at `/does-not-exist`.

---

## Proposed — need your decision

Effort is rough implementation time, excluding review.

### M3 — Export the studio's data (½ day)
The print workspace exports its ledger to CSV; the studio side exports nothing. An agency will eventually need the task list or the client list out of the app — for a report, an accountant, or simply to feel the data is theirs. Suggest CSV export on the tasks table and the clients list, reusing the print workspace's existing helper.
**Why it matters:** data portability is also what makes a tool feel safe to commit to.

### M4 — Pagination or a cap on the tasks table (1 day, but see Phase 3 P1)
Every table renders every row, and `GET /api/records` returns the whole workspace on a 5-second poll. At today's 43 records that is 20 KB; after two years of real use it is megabytes per poll per tab. This is the single change most likely to be needed before the app is comfortable at scale.
**Depends on your call** because capping what the API returns changes what the UI can show without a second request.

### M5 — Bulk actions on the tasks table (1 day)
No multi-select anywhere. Reassigning ten tasks after someone leaves, or archiving a finished campaign, is ten separate round trips through a modal. Suggest checkboxes with bulk archive, bulk assignee and bulk status.
**Why it matters:** this is the daily-grind complaint an agency notices in month two, not week one.

### M6 — A real "forgot password" flow (1 day)
Today: the studio re-invites, which generates a new temporary password. That works because there is one small team, but it means an owner locked out at 23:00 has no path back in unless they can reach the server. A mail-based reset link would fix it — the mailer already exists.
**Why it matters:** the owner account is the only account that can create clients. Losing it is losing the workspace.

### M7 — Error reporting beyond `console.error` (½ day)
Ten `console.error` calls are the entire server-side error story; in production they exist only in Vercel's log stream, unaggregated and unalerted. A failing invoice PDF or a broken n8n publish would be invisible until a client complained. Suggest Sentry or Vercel's own error tracking.
**Why it matters:** right now the first report of any production failure comes from a human.

### M8 — Session renewal (2 hours)
The 7-day expiry is absolute: an active user is signed out mid-work on day 7, with unsent form content lost (Phase 2, U1). Sliding renewal on activity is a small change to `getAppUser`.

### M9 — Surface an expired session immediately (1 hour)
`load({silent:true})` ignores a 401, so after the session expires the screen keeps showing stale data until the next click. Have the silent poll flip to the sign-in screen like a normal load.

---

## Cleanup awaiting your go-ahead (deletions, so not done unilaterally)

### D1 — Quotes and invoices survive their client's deletion (from Phase 1)
Deleting a client cascades to projects, tasks, comments, events, voice messages, the editorial calendar and images — but keeps `document` records, deliberately, since they are accounting records. The consequence is orphans: no client name to resolve, invisible to everyone but the owner. Options: keep as-is, auto-archive them on client delete, or refuse to delete a client that still has documents.

### D2 — 42 of 61 `components/ui/*` files are unused (from Phase 3)
Ten dependencies exist only to serve them (`embla-carousel-react`, `cmdk`, `input-otp`, `vaul`, `react-day-picker`, `sonner`, `react-resizable-panels`, `react-hook-form`, `@shadcn/react`, `next-themes`), and two more (`@hookform/resolvers`, `date-fns`) are imported by nothing at all. Removing them shrinks install size and the surface to audit; unimported files were already being tree-shaken out of the bundle, so the runtime win is small.

### D3 — `scripts/check-google-config.mjs` validates variables the app no longer reads (from Phase 2)
`pnpm auth:check` still checks `AUTH_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, left over from the Google OAuth path removed in migration `0003_password_only_accounts.sql`. It would tell an operator their setup is broken over variables nothing uses.

### D4 — Two "Download" buttons, two behaviours (from Phase 3)
Studio documents produce a real PDF; print invoices open a print dialog. `lib/document-pdf.ts` is imported by the print workspace and never called. Pick one behaviour for both, or label them differently.
