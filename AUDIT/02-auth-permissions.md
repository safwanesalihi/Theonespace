# Phase 2 — Sessions, auth & permissions

Every boundary below was **probed against the real route handlers**, not read off the source. The probes are now a permanent suite: `tests/security.mjs`, 35 checks, wired into `pnpm test`.

## What the architecture does right

Worth stating first, because it shapes the risk profile:

- **No client-side-only protection exists to bypass.** There is no `middleware.ts` and no protected page; the single page renders whatever `GET /api/records` returns, and that response is already filtered server-side per role by `memberView()` / `portalView()` / `printVisible()`. Hiding a button is never the control.
- **Passwords**: scrypt (N=16384, r=8, p=1), 64-byte key, 16-byte random salt, `timingSafeEqual` comparison. An unknown e-mail is still put through a dummy verify of equal cost, so sign-in timing does not reveal whether an account exists.
- **Sessions**: 32 random bytes, stored **SHA-256 hashed** (a database leak yields no usable tokens), `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production. `sessionTokenFrom` accepts the cookie only when **exactly one** copy is present, which defeats cookie shadowing.
- **Lockout**: 5 failed attempts → 15 minutes, counter cleared on success.
- **Password change** closes every other session; **re-inviting** an account closes all of them.
- **Optimistic concurrency** on every write (`WHERE revision = $n`), so a stale client cannot silently overwrite.
- **All SQL is parameterised.** The one dynamically-built statement (`set-member-role` / `remove-member`) interpolates a *static* condition string; all values are placeholders. That condition re-checks the actor's own authority **inside the write**, so a role change cannot race a demotion.
- **Body size capped** at 25 000 characters on `/api/records`, uploads at 1.5 MB (images) / 8 MB (audio), with content-type allowlists.
- **No secrets in the repo**: no `NEXT_PUBLIC_*` anywhere, `process.env` is read in exactly one module (`lib/env.ts`), `.env*` is gitignored and no env file appears in git history.

---

## Findings

### HIGH — H1: CSRF was not enforced when the browser omitted `Origin`
**Location** `app/api/records/route.ts`, `app/api/assets/route.ts`

Both routes used:

```ts
const origin = req.headers.get('origin');
if (origin && origin !== requestOrigin(req)) return 403;   // ← passes when the header is absent
```

The sign-in routes already used the strict `sameOrigin(req)`, which *requires* the header. So the two cookie-authenticated **data** routes were more permissive than the auth routes.

`/api/assets` is the sharper case: it takes `multipart/form-data`, which a plain cross-site `<form>` can submit — no fetch, no preflight. `/api/records` demands `application/json` (415 otherwise), which is harder to reach from a form, but the check was still weaker than it needed to be.

Proven before the fix:

```
POST with NO Origin header refused … FAIL (got 200)
asset upload with NO Origin refused … FAIL (got 200)
```

**Fix applied** Both routes now call `sameOrigin(req)`. Verified live in the browser afterwards: the app's own `fetch` calls still succeed, because browsers always send `Origin` on same-origin `fetch` and multipart POSTs.

### MEDIUM — H2: a client logo/banner was accepted from any workspace, and the avatar mirror copied its bytes
**Location** `app/api/records/route.ts`, `lib/validation.ts`

`logo` and `banner` were validated for **UUID shape only** — never that the asset exists in this workspace, or that it is of that kind. The `voiceMessage()` helper right above already does exactly this check (workspace + kind + uploader), so the client images were the inconsistent case.

It mattered because of what happens next: `syncClientAvatars` copies the logo into a per-member avatar with

```sql
INSERT INTO assets (…) SELECT $1, workspace_id, 'avatar', content_type, size, bytes, … FROM assets WHERE id = $2
```

— no workspace filter, and **avatars are readable by any signed-in user**. A manager who knew an asset id from another workspace could have had its bytes copied into a universally-readable avatar. Exploiting it requires guessing a UUIDv4, and the deployment is single-tenant today, so the practical risk was low — but the workspace model is real (the print workspace is a second one) and the fix is four lines.

**Fix applied** A logo or banner must now be an asset of that exact kind in this workspace. Two regression tests added in `tests/assets.mjs` (a well-formed foreign id is refused; a banner cannot be passed off as a logo).

### LOW — H3: the printed document number was interpolated unescaped
**Location** `lib/print-html.ts`

Every other value in the print template goes through `esc()`; `docNum` did not, and the template is written into an iframe with `document.write`. `number` is normally server-assigned, but `printSchemas.print_document` accepts a client-supplied `number` string, so an owner/admin could store markup and have it execute in their own print window. Self-inflicted and privileged-only, but escaping is free.

**Fix applied** `docNum` now goes through `esc()` like the rest.

---

## Boundaries verified (all passing)

**Horizontal — one client cannot reach another's data**
- Client A's payload never contains client B's client, tasks or records.
- A cannot approve, comment on, or request changes to B's task (the server resolves the task through `findTask`, which re-checks `task.clientId === workspace.clientId`).
- A **request forged with `clientId: <B>` is silently forced back onto A's own client** — the handler ignores the body's `clientId` for the client role.
- A cannot read another workspace by changing `X-Workspace-Id` (403).
- A cannot update or delete any record, cannot invite, and receives an **empty member roster**.

**Vertical — no role reaches above itself**
- `creative`: cannot create a client, create a task, delete, invite, change a role, remove a member, create the print workspace, or notify a client — and **never sees `document` records exist** at all.
- `viewer`: cannot comment, update, create a platform, or upload audio.
- Non-member: 403 on read and write. Anonymous: 401 on both.

**Asset reach**
- A workspace image is readable by its members, 404 to outsiders, 401 to anonymous.
- A profile picture is readable by **any signed-in user** — deliberate (a comment author's picture must render for everyone in the thread) and now documented as such in the test.

---

## Session behaviour

| Scenario | Behaviour | Verdict |
|---|---|---|
| Sign-in | Session row + cookie, `Max-Age` = the row's own 7-day lifetime | ✅ |
| Sign-out | Row deleted **then** cookie cleared; a failure keeps the cookie so "signed out" always means the session is really gone | ✅ |
| Expiry | `getAppUser` deletes the expired row and returns null | ✅ |
| Expiry mid-action | `mutate()` sees 401 → sign-in screen, and the error is thrown to the caller | ✅ (see U1) |
| Expiry during a background poll | `load({silent:true})` **returns without doing anything** on 401 | ⚠️ U2 |
| Multiple tabs | Cookie shared; the chosen workspace is per-tab `sessionStorage` — intentional | ✅ |
| Role change mid-session | Role is re-read from the database on every request; the UI catches up on the next 5-second poll, and the server rejects in the meantime | ✅ |
| Forced password change | Every route returns 403 `password-change-required` until it is done | ✅ |
| "Remember me" | Does not exist — every session lasts 7 days | ✅ by design |

**U1 (low, UX)** — when a session expires while a modal is open, the sign-in screen replaces the app and the unsent form content is lost.
**U2 (low)** — an expired session is not noticed by the background poll, so the screen keeps showing stale data until the next user action. A silent 401 could flip the app to the sign-in screen instead.

---

## Remaining risks — not fixed, listed for decision

| # | Risk | Assessment |
|---|---|---|
| **R1** | **No rate limiting beyond the sign-in lockout.** A signed-in user can call `/api/records` or upload 8 MB audio files without limit. | Real but bounded: every account is invited by the studio, so there are no anonymous attackers. Worth an upload quota before opening the portal widely. |
| **R2** | **Per-account lockout is a denial-of-service lever.** Five wrong passwords lock a known e-mail for 15 minutes. | Inherent to the design; the alternative (IP throttling) needs infrastructure this app does not have. |
| **R3** | **No session renewal.** The 7-day expiry is absolute, so an active user is signed out mid-work on day 7. | Deliberate simplicity; sliding renewal is a small change if you want it. |
| **R4** | **`scripts/check-google-config.mjs` (`pnpm auth:check`) validates `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`** — Google OAuth variables that **no longer exist** in this app (migration `0003_password_only_accounts.sql` removed that path). The script would tell an operator their configuration is broken over variables nothing reads. | Dead tooling that actively misleads. I have left it in place rather than delete it — **your call**. |
| **R5** | **Errors are reported with `console.error` only** (10 call sites), so a production failure exists solely in Vercel's log stream. | → Phase 4. |
| **R6** | **`/api/auth/status` is public** and reveals which pieces of configuration are present plus `AUTH_URL`. | Acceptable: no secret, and `AUTH_URL` is printed in every invitation e-mail already. |
