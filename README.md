# The One Core — Tracker

The One Tracker runs **The One Flow** for the studio and its clients, without ClickUp: the four-status workflow, the timed validation clock, the revision budget, the frozen calendar week, the evergreen reserve, a request form, a real client portal (FR / AR, RTL) and the six numbers that tell whether the system works.

## Impression workspace

The owner can create a separate **Impression** workspace from the workspace switcher. Its membership and records are independent from the studio; there is no Clients page or client portal.

- **Cash ledger:** income and expenses in MAD, transaction date, category, customer/supplier name, optional order link, monthly filters, search and CSV export. Corrections can void and restore transactions. Amounts are stored as integer centimes.
- **Orders:** quantities, delivery date, production status, task progress and payment progress. Customer refunds reduce received payments; supplier expenses do not. Cash totals count actual movements, not order values.
- **Team tasks:** standalone or order-linked work, stable user assignments, editable status, and per-person timers. Existing printing tasks remain available. Studio approval clocks never run in Impression.
- **Access:** owner/admin manage finances, orders, tasks and invitations. Printing operators see assigned/unassigned tasks and related orders without financial amounts; they update task status and track time. Studio access requires a separate invitation.
- **Dashboard:** income, expenses, net cash movement, outstanding order payments, six-month chart, production and team progress. Cash cards follow the selected month; outstanding payments and production span all orders.

Records use the existing workspace-scoped JSONB table; no new database migration is needed. Printing tests are included in `pnpm test`.

## The One Flow — what the app enforces

Every rule lives in one file, [lib/flow.ts](lib/flow.ts), as pure functions with the constants at the top. The API applies them; the Dashboard page and the contract annex read them. Change a number there and the app, the receipts and the annex agree.

| Rule | Where it bites |
|---|---|
| **48 h validation, silence is approval** | Sending a deliverable stores `approvalDueAt` (never recomputed). The sweep auto-validates at the deadline with a `silence` receipt, after reminders at 24 h and 6 h left. |
| **2 consolidated revision rounds** | Each client “request changes” increments `revisionRound`; round 3+ is flagged *hors forfait* on the task, the table and the Dashboard. Internal rejections are not counted. |
| **J−7 lock** | Creating or moving an item into the coming 7 days is refused for creatives and needs an explicit, logged override (`lockOverride`) from an admin. Past dates are backfills and stay free. |
| **Four backward gates** | From the publish date `due`: brief validé J−14 · envoi au client J−7 · validation J−5 · prêt à publier J−1. Shown on the task page with reached / late state. |
| **Court** (who must act) | Derived from status, never typed: Studio / Client / Terminé. Chip on every row, board card and in the Dashboard; filterable. |
| **Evergreen reserve** | Validated, undated, unpublished items count toward ≥ 3 per client. Dating one takes it out of the reserve. |
| **Request bank** | The portal form creates an `À faire` task with `source: Portail` and a `request` stamp; the studio sees it on the home page and in the Dashboard. |
| **J−1 sweep / J−7 alerts** | Studio-only events for items publishing tomorrow that aren’t validated, and items inside the lock window not yet sent. |
| **Sign-off receipt** | Every validation (explicit, silence or studio) writes `signOff` — who, e-mail, when, mode, rounds used — shown to both sides. |
| **Single channel** | Comments on the task. Client feedback is posted as `[Retours client — tour N]`. The app sends no e-mail, SMS or WhatsApp. |

### The six numbers (Dashboard page)

On-time publish rate (≥ 95 %), median client validation time (< 24 h, explicit decisions only), share validated by silence (watch > 30 %), revision rounds per item (≤ 1,4), delivered vs sold (100–105 %, from each client’s `quota`), evergreen reserve (≥ 3 per client). Computed by `computeMetrics` for this month, last month or 30 days.

### Clocks

- **Lazily**: every authenticated read or write runs the sweep for that workspace first, so the app is correct even with no scheduler.
- **Vercel Cron**: [vercel.json](vercel.json) calls `GET /api/flow/sweep` once a day at 06:00 UTC (the most the Hobby plan allows); Vercel sends `Authorization: Bearer $CRON_SECRET` automatically once `CRON_SECRET` is set in the project. On Pro, change the schedule to `*/15 * * * *`. The lazy sweep keeps the app correct in between; a daily cron only means reminders can wait until the next visit or the next morning.
- Any other scheduler can call the same route with the same bearer token.

### Roles and the client portal

Roles: **owner** (unique — the `OWNER_EMAIL` account), **admin** (optional delegated manager: everything but the owner role and client creation), **member** (`creative`: moves forward the tasks assigned to them or not yet assigned — enforced server-side by `memberView` — comments and manages sub-projects, sees the team read-only; does not create or edit clients, does not create tasks, has no Dashboard, cannot archive or act as the client in the portal preview), **viewer** (read-only, legacy), and **client**. `owner · admin · viewer` see the whole studio. A **`client`** member is scoped to one client (`workspace_members.client_id`) and only ever sees the portal: home, à valider, calendrier, livrables, demande and the review page with the countdown. Internal fields (assignee, source, reminders, studio links) are stripped server-side (`portalView`). Clients can approve, request changes, comment and submit requests — nothing else.

**Languages**: the whole app — studio, client portal, sign-in and the contract annex — is available in French, English and Arabic (RTL). The FR / EN / AR toggle lives in each person’s settings (click your picture in the sidebar) and on the sign-in screen; the choice is remembered per browser (`the-one.locale`). A client who never chose a language starts in the language recorded on their client file. French is the source language: UI strings are translated through `lib/i18n` (English and Arabic dictionaries keyed by the French text, so an untranslated string falls back to French rather than breaking); the portal keeps its structured copy in `lib/portal-i18n.ts`. Data (task names, briefs, comments) is shown as typed. Invitation e-mails are still sent in French.

**Client creation**: only the owner can add clients or load demo clients. Admins, creatives, viewers and clients cannot create clients.

**Accounts and invitations**: there is no sign-up page. The owner (`OWNER_EMAIL`) signs in with `OWNER_PASSWORD` the first time and should change it in the app. Owners/admins invite people from Équipe → *Inviter une personne* (name, e-mail, role, and the client for portal access): the account is created immediately with a **temporary password**, e-mailed from the studio's Gmail (`GMAIL_USER` + `GMAIL_APP_PASSWORD`) — or shown once on the Team page when mail isn't configured. At first login the person must choose their own password; until then the app refuses every request (`password-change-required`). *Renvoyer / Réinitialiser* on a member issues a new temporary password and closes their sessions — that is the "forgot my password" path. Clicking your picture at the bottom of the sidebar opens **Paramètres** (studio and portal alike): profile picture (uploaded as an `avatar` asset, squared and resized in the browser), display name, the FR / EN / AR language toggle and sign-out. The greeting, roster, comments and validation receipts use that name and picture — the seeded owner starts as the studio name, so set yours once.

The portal follows the client record’s `language`: `العربية` renders right-to-left with Arabic copy ([lib/portal-i18n.ts](lib/portal-i18n.ts)).

### Contract annex

`#annex` (or *Annexe contractuelle* on a client page) prints the Phase 0 annex with the live numbers from `lib/flow.ts`.

### API actions added

`approve`, `request-changes`, `publish` (`day` optional), `request` (`clientId` for studio use, `data`), `invite-member`, `mark-read`; `set-member-role` accepts `clientId` for the client role; `create`/`update` accept `lockOverride` and return `code: "lock"` (409 admin / 403 creative) when the J−7 lock applies. `GET /api/records` also returns `workspaces` and `today` (Africa/Casablanca).

### Social — plan, approve and publish (Buffer/Metricool-style)

**Who**: the owner, administrators and the **Social media manager** role (Social for every client; on tasks, the same reach as a « Membre »). A « Membre » no longer creates or edits posts.

**Where**: *Social* in the sidebar (every client on one calendar) and the *Social* tab of each client.

- **Calendar** (month) and **list** by status: Brouillon, À valider (client), Modifications demandées, Programmé, Publication…, Échec, À publier à la main, Publié. Drag a post to another day to move it. Filters by client and network.
- **Media**: paste the **Google Drive link** of each photo or video (one file per link, shared as « Tous les utilisateurs disposant du lien »). The app checks the file is public and is media, turns the link into Drive's direct download address, and Meta fetches the file from Drive when the post goes out. Instagram only takes JPEG photos: a PNG from Drive is flagged before sending. Uploading from the computer is also offered once storage is set up (step 1 below, optional).
- **Composer**: one post, several networks, each with its own **format** — Instagram Post / Carrousel (2–10) / Reel / Story, Facebook Post (text, one video, or several photos), TikTok Vidéo / Photos, YouTube Short / Vidéo (with a title) — and optionally its own text. Photos and videos upload straight to storage and can be reordered. A preview per network. What a format can't take is shown before anything is sent (e.g. two photos on an Instagram Post).
- **« Programmer »** queues the post for its date and time (Casablanca); **« Publier maintenant »** sends it at once. Each network answers: *Publié · Voir*, or Meta's own reason; a failed network is retried with another click, or by the scheduler an hour later. A post can never go out twice (a run holds it while it talks to Meta).
- **Client approval** (switch on the client file, « Le client valide ses publications »): a scheduled post waits in the client's portal (À valider, phone-friendly: *Valider* or *Demander une modification*). Changing what goes out asks again. The studio can record an approval given elsewhere (WhatsApp…). Nothing goes out before.
- **Networks the app doesn't post to yet** (TikTok, YouTube — Phase 2): planned and approved here; when their time comes the post shows *À publier à la main*, and « Marquer comme publié » (with the link) closes it.
- Posts made before the hub (platform ids, one media) keep working.

**Connecting a client's accounts** — *Social → Comptes* (or the client's Social tab): **Connecter** opens the platform's own login; the person logs into the client's Facebook, TikTok or YouTube account (or an account that manages the client's Page) and allows The One Core to post. Nothing to copy — no id, no token. A Facebook login that manages several Pages asks which one is this client's; its professional Instagram is linked with it. Tokens are stored encrypted (`AUTH_SECRET`), never sent to the browser, renewed on their own (TikTok, YouTube), and removed with **Déconnecter** or when the client is deleted.

**Setup — once per platform** (the platforms only allow « log in and allow » through an app registered by the studio — exactly what Metricool did for its own users):

1. **Meta (Facebook + Instagram)** — [developers.facebook.com](https://developers.facebook.com) → *Create app* → type **Business**, linked to The One Core's business portfolio → add **Facebook Login for Business** → *Settings*: Valid OAuth Redirect URI `https://space.the1core.com/api/social/callback/meta` → *Configurations*: create one (User access token; assets Pages + Instagram accounts; the permissions below). In Vercel: `META_APP_ID`, `META_APP_SECRET` (*App settings → Basic*), `META_LOGIN_CONFIG_ID` (the configuration's id).
   - Right away (the app in *Development* mode), whoever has a role on the app (you, your team) can connect every Page they manage — the usual agency setup: your Facebook account manages your clients' Pages through Business Manager.
   - For a client to log in with their own account, Meta must approve the app: **Business verification** + **App Review** for `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `business_management`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`.
2. **TikTok** — [developers.tiktok.com](https://developers.tiktok.com) → *Manage apps* → create an app → add **Login Kit** and **Content Posting API** (Direct Post on), scopes `user.info.basic`, `video.upload`, `video.publish`; Redirect URI `https://space.the1core.com/api/social/callback/tiktok`. For TikTok Photos, verify the URL prefix `https://space.the1core.com/api/social/file/` (photos are served from there). In Vercel: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`. Until TikTok audits the app, posts go out **private** (visible only to the account) — that is TikTok's rule for every unaudited app; submit for audit once it works.
3. **YouTube** — the Google OAuth client already used for Google sign-in (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`) does it: in [Google Cloud](https://console.cloud.google.com) enable **YouTube Data API v3**, add the redirect URI `https://space.the1core.com/api/social/callback/google` to that client, and add the scopes `youtube.upload` and `youtube.readonly` to the consent screen. Set the consent screen to **In production** (in *Testing*, Google ends the connection after 7 days). Until Google verifies the app, uploads may be kept **private** by YouTube. (A separate client can be given as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.)
4. **Posting at the planned time** — every 5 minutes, an external scheduler (e.g. cron-job.org, free) calls `GET https://space.the1core.com/api/editorial/publish-due` with the header `Authorization: Bearer <CRON_SECRET>` (only *scheduled* posts go out, never a draft). `CRON_SECRET` is 32+ random characters (`openssl rand -hex 32`), set in Vercel. On Vercel Pro, a cron in `vercel.json` can do it instead (Hobby allows only one run a day, and a more frequent cron fails the deployment).
5. **Optional — uploading from the computer**: a public Supabase Storage bucket `editorial-media` and `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in Vercel. Google Drive links need nothing.

Limits: Vercel ends a request after 60 s, so a very large video (TikTok, YouTube, 250 MB at most) may not finish uploading in one run.

### Not done, on purpose

- No e-mail/WhatsApp delivery of reminders or invitations — reminders are in-app events and the portal countdown; pick a provider (Resend, Brevo…) to add delivery on top of the existing events.
- Reminders are not e-mailed (only invitations are). The same Gmail sender could carry them; it is a small addition on top of the existing events.
- Working-day calendars and holidays are not modelled: 48 h is 48 calendar hours, as the costs doc specifies.

## Writing help with Claude

Set `ANTHROPIC_API_KEY` (an API key from console.anthropic.com) in Vercel to switch it on; without it the buttons stay hidden.

- **Post composer** — « Rédiger avec l’IA » proposes three captions for the first selected network and format, in the client's language (from the client file), from the internal title, notes or a first draft; picking one also fills an empty internal title. « Suggérer » proposes YouTube titles. « Corriger » fixes spelling and wording of the text, a network's own text and the title.
- **Tasks** — « Corriger » on a task's name, the description or brief, and the requested changes.

Captions and titles are for owner, admins and social media managers; corrections for every studio role except viewers. Clients never see the buttons. Each person gets 20 calls a minute. Calls go to Claude Opus 5 (`lib/ai.ts`); a request Claude declines is retried server-side on Anthropic's recommended fallback model.

## WhatsApp — "ready to approve" messages

When a task moves to **À valider**, a client whose file has a **WhatsApp** number gets a message on their phone. It is sent straight from the app through Meta's WhatsApp Cloud API (`lib/whatsapp.ts`). No number on the file, or no configuration → nothing is sent and nothing breaks.

A failed message never undoes the save: the task still goes for approval, the studio sees a toast with Meta's reason, and the outcome is written to the activity feed (*« WhatsApp envoyé à … »* or *« WhatsApp non envoyé … — raison »*). Editing a task that is already waiting does not message the client again; sending it back for a new round does.

### 1. Meta setup (once)

1. In **Meta Business Suite**, create a WhatsApp Business account and add the sending number — The One Core's: **+212 6 07 48 48 22** (`0607484822`). Clients receive the messages from it and can reply to it.
   **A number can live either on the phone app or on the API, not both.** Using the app and the API on one number (Meta's *coexistence*) is only offered through a Meta Solution Partner or Tech Provider, not to a business connecting its own app. So either use a second number for the API, or delete the WhatsApp account on the phone first (WhatsApp → Settings → Account → Delete account) and move the number over — the phone app then stops working for it.
2. **WhatsApp Manager → Message templates → Create template**, category **Utility**. Meta only allows a business to start a conversation with an approved template, so the wording lives there, not in the code. Suggested text — the three variables must stay in this order:

   Language **French** (`fr`) — the only one: every client gets the message in French, whatever the language on their file.
   > Bonjour {{1}}, un nouveau contenu est prêt à valider : « {{2}} ». Consultez-le et donnez votre accord sur votre espace : {{3}} — Merci !

   `{{1}}` client name · `{{2}}` deliverable name · `{{3}}` portal address. Approval usually takes minutes to a few hours; until the template is **Active**, Meta answers *(#132001) Template name does not exist in the translation*. Meta rejects a template whose text starts or ends with a variable — hence the closing « Merci ! ».
3. **Business settings → System users**: create a system user, assign it the app and the WhatsApp account with full control, and generate a **permanent token** (expiration: *Never*) with `whatsapp_business_messaging`, `whatsapp_business_management` and `business_management`.
4. Note the **Phone number ID** shown in WhatsApp Manager → API setup (a long number — not the phone number itself).

### 2. Vercel environment

| Variable | Value |
|---|---|
| `WHATSAPP_TOKEN` | the system user's permanent token |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID |
| `WHATSAPP_TEMPLATE` | the template's name, e.g. `pret_a_valider` |

Redeploy.

### 3. Per client

Client file → **Modifier la fiche → WhatsApp**, in international format: `+212 6 12 34 56 78` (spaces, dots and dashes are accepted and dropped).

## Finance dashboard — owner only

`/admin/finance` shows the finance dashboard (the HTML export of `TheOneCore_Finance_2026.xlsx`,
e.g. `TheOneCore_Dashboard_2026.html`) to the owner — the account whose e-mail is `OWNER_EMAIL` —
and to nobody else. It isn't linked from anywhere.

- **Everyone else gets the site's ordinary 404**, byte for byte the same as a missing address: signed
  out, another account, a client. `proxy.ts` rewrites their request to a path no route matches; the
  page and `/admin/finance/data` then check again on their own (`lib/finance-dashboard.ts`).
- **The file is not in git** — this repository is public — and not under `/public`, which anyone can
  fetch. It is stored in the database (a `meta` row of the owner's workspace, never sent with the
  app's records) and served only by `/admin/finance/data`, behind the same owner check, with a
  sandboxing CSP, `no-store` and `noindex`.
- **Updating the numbers:** regenerate the HTML from the workbook, open `/admin/finance` and click
  **Remplacer le fichier**. The page computes nothing; the figures are the ones baked into the export.
- Not listed in any `robots.txt` on purpose: a `Disallow` line would name the path. The page carries
  `noindex`, the file an `X-Robots-Tag: noindex`.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router) on **Vercel** |
| Database | **Supabase Postgres** through `postgres.js` — one small `Db` interface in [lib/database.ts](lib/database.ts) |
| Local dev / tests | **PGlite** (embedded Postgres) in `.data/pglite` when `DATABASE_URL` is empty; tests run on a fresh in-memory PGlite |
| Schema | Drizzle `pg-core` ([db/schema.ts](db/schema.ts)); migrations in `drizzle/`, applied with `pnpm db:migrate` |
| Auth | **E-mail + password only** ([lib/password-auth.ts](lib/password-auth.ts): scrypt hashes, 5-attempt lockout, hashed session tokens). No self sign-up: the owner is seeded from `OWNER_EMAIL`/`OWNER_PASSWORD`, everyone else is invited with a temporary password |

`records.data` is `jsonb`; clients, projects, tasks, comments and events share that table with a `kind`.

## Local development

```sh
pnpm install
cp .env.example .env      # set OWNER_EMAIL / OWNER_PASSWORD
pnpm dev                  # http://127.0.0.1:5173 — embedded Postgres, no Supabase needed
pnpm test                 # 6 suites on in-memory Postgres
```

Delete `.data/` to start from an empty local database.

## Supabase

1. Create the project (business Google account). In **Project settings → Database**, copy two URIs:
   - **Transaction pooler** (port `6543`) → `DATABASE_URL` — used by the app at runtime.
   - **Direct / session** (port `5432`) → `DIRECT_URL` — used by migrations only.
2. Apply the schema:
   ```sh
   pnpm db:migrate
   ```
   Drizzle records applied migrations in the `drizzle.__drizzle_migrations` table; re-running is safe.
3. After a schema change in `db/schema.ts`: `pnpm db:generate` then `pnpm db:migrate`.

Security: migration `0002_lock_down_postgrest` enables RLS on every table (no policies) and revokes all grants from the `anon`/`authenticated` API roles — the app only ever connects as the owner role and never uses the Supabase REST API, so the public anon key gives access to nothing. Re-run `pnpm db:migrate` after adding tables; the default privileges are altered so new tables stay closed.

Backups: Supabase Pro takes daily backups; `pg_dump "$DIRECT_URL" > backup.sql` works from any machine.

## Vercel

1. Import the repository; framework preset **Next.js**, build `pnpm build`.
2. Environment variables (Production): `AUTH_URL=https://<your-domain>`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET` (32+ random chars).
3. The cron in [vercel.json](vercel.json) is picked up on deploy.

Sign-in works on every https address the app is served from (the custom domain and the `*.vercel.app` address alike): the guard is a same-origin check. `AUTH_URL` is the canonical public address — it sets the cookie's Secure flag and the links in invitation e-mails — so set it to the domain you give people.

## Team backend

The Team page reads workspace memberships from Postgres. Owners and administrators can invite people, change another existing member’s role or remove access. The owner is protected, self-modification is blocked, and creative/viewer/client roles cannot manage membership. Removing access preserves records and contributions.

- `GET /api/records` returns `records`, the current `user` (including `id`), `workspace`, `members`, `workspaces` and `today`. Names and emails are synced from authenticated identity on access.
- Once an active workspace is loaded, the frontend sends `X-Workspace-Id` on reads and writes. The server verifies membership and rejects a revoked or unauthorized workspace rather than silently writing to another one.
- Membership mutations use `action: "set-member-role"` (with `role`, and `clientId` for the client role), `action: "remove-member"`, or `action: "invite-member"`. A conflicting role returns 409; refresh before retrying.
- Run `pnpm test` for the API checks (records, auth, team, images) plus the flow rules ([tests/flow.mjs](tests/flow.mjs)) and the flow API ([tests/flow-api.mjs](tests/flow-api.mjs)). Tests never touch `.data/` or Supabase.

## Scripts

- `pnpm dev` — Next.js dev server on `127.0.0.1:5173`
- `pnpm build` / `pnpm start` — production build and server
- `pnpm test` — all suites
- `pnpm lint`
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations
- `pnpm auth:check` — validates the `.env` auth values without printing secrets
