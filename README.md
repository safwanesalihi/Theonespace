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
| **Single channel** | The task's chat (text, voice notes, PDFs and photos), every message signed by its sender; the owner and admins can delete a message. Client feedback is posted as `[Retours client — tour N]`. |

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

`approve`, `request-changes`, `remind-assignee-whatsapp` (`taskId`, current `revision`; owner/admin only), `publish` (`day` optional), `request` (`clientId` for studio use, `data`), `invite-member`, `mark-read`; `set-member-role` accepts `clientId` for the client role; `create`/`update` accept `lockOverride` and return `code: "lock"` (409 admin / 403 creative) when the J−7 lock applies. `GET /api/records` also returns `workspaces` and `today` (Africa/Casablanca).

### Social — plan, approve and publish (Buffer/Metricool-style)

**Who**: the owner, administrators and the **Social media manager** role (Social for every client; on tasks, the same reach as a « Membre »). A « Membre » no longer creates or edits posts.

**Where**: *Social* in the sidebar (every client on one calendar) and the *Social* tab of each client.

- **Calendar** (month) and **list** by status: Brouillon, À valider (client), Modifications demandées, Programmé, Publication…, Échec, À publier à la main, Publié. Drag a post to another day to move it. Filters by client and network.
- **Media**: paste the **Google Drive link** of each photo or video (one file per link, shared as « Tous les utilisateurs disposant du lien »). The app checks the file is public and is media, turns the link into Drive's direct download address, and Meta fetches the file from Drive when the post goes out. Instagram only takes JPEG photos: a PNG from Drive is flagged before sending. Uploading from the computer is also offered once storage is set up (step 1 below, optional).
- **Composer**: one post, several networks, each with its own **format** — Instagram Post / Carrousel (2–10) / Reel / Story, Facebook Post (text, one video, or several photos), TikTok Vidéo / Photos, YouTube Short / Vidéo (with a title) — and optionally its own text. Photos and videos upload straight to storage and can be reordered. A preview per network. What a format can't take is shown before anything is sent (e.g. two photos on an Instagram Post).
- **« Programmer »** queues the post for its date and time (Casablanca); **« Publier maintenant »** sends it at once. Each network answers: *Publié · Voir*, or Meta's own reason; a failed network is retried with another click, or by the scheduler an hour later. A post can never go out twice (a run holds it while it talks to Meta).
- **« Répéter »** (in the composer, under the date and time): *Une seule fois*, *Tous les jours*, *Chaque semaine* (one weekday, e.g. every Monday — or several) or *Chaque mois*, with an optional *Jusqu'au* last day; the next dates are shown. A repeating post is a **series**: at its time on each of its days, the scheduled run makes that day's copy (an ordinary post, with its own results, statistics and link) and publishes it, then moves the series to its next day. The series shows on every coming day in the calendar (dashed, 🔁); editing it changes all the next ones, and copies already out are unaffected. A day missed by more than 6 hours (the scheduler was down) is skipped, not posted late in a burst; the series' history says so. One client approval covers the whole series (changing the rule asks again). « Publier maintenant » is off for a series — make a one-off post for that. Deleting a day's copy never deletes the series' photos and videos.
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

## AI with Groq and Gemini — writing help, media analysis and the assistant

Set `GROQ_API_KEY` (console.groq.com → API Keys) or `GEMINI_API_KEY` (Google AI Studio → API keys) in Vercel to enable writing help. Text uses Groq `openai/gpt-oss-120b` when configured, otherwise Gemini. Every attached photo is analysed first, including its visible text, and every video is read with its audio through Gemini. Gemini uses the same key as the assistant; **video analysis requires `GEMINI_API_KEY`**. Images use Groq `qwen/qwen3.8-27b` when Gemini is not configured (`GROQ_VISION_MODEL` overrides it). A failed or unreadable attachment stops caption generation: there is no fallback that ignores the media. Keep keys only in Vercel, never in code or screenshots.

The floating assistant « One » runs on Google Gemini when `GEMINI_API_KEY` is set (Google AI Studio → API keys; `GEMINI_MODEL` optionally picks the model, default `gemini-flash-latest`, then `gemini-3.8-flash` and `gemini-flash-lite-latest`; it thinks lightly before answering (`GEMINI_THINKING`: minimal, low — the default —, medium or high), an overloaded model is retried once, and if Gemini is down Groq answers without actions). Its answers stream in as they are written, with no per-minute limit (only the plan's monthly AI quota). In the studio it acts: it finds, creates and updates tasks and posts comments. Every change goes through `/api/records` on the person's own session, with the same rules as their clicks (a creative only moves their own tasks), and it asks before lifting the J-7 lock. It also remembers what the owner or admins teach it (« Retiens que… », or the brain icon's « Mémoire » panel). Clients only get answers. Without the Gemini key, the assistant answers through Groq, without actions.

- **Post composer** — paste a Google Drive link: the file is added at once and, when the post has no text yet, the AI reads its actual content, fills in the caption and an empty internal title, and offers two other versions. « Rédiger avec l’IA » works with both Drive files and computer uploads. Every carousel image is read in order (up to the composer's 35 attachments), not just the first three; video scenes and spoken content are analysed rather than a thumbnail. Captions prioritise observed content over unrelated titles or old drafts and preserve visible dates, prices and offers without inventing them. Unreadable files are reported, and suggestions are hidden when their media or client changes. Images are limited to 8 MB, videos to 100 MB. Larger videos use Google's Files API and their temporary copy is deleted after analysis, including failures. Only approved media origins and the workspace's own storage paths may be fetched; source redirects and actual byte limits are checked. « Suggérer » proposes YouTube titles from notes; « Corriger » proofreads existing text. Captions follow the first selected network and format and the client's language.
- **Tasks** — « Corriger » on a task's name, the description or brief, and the requested changes.
- **Assistant « One »** — a round button in the corner of every screen (studio, client portal, print) opens a chat that knows The One Core, The One Flow and how to use the app for the person's role (OWNER, MANAGER, PRODUCER or CLIENT). With each question it gets a compact snapshot of the workspace *as that person sees it* — the same filters as the app (a client: their own items, comments and documents; a creative: their tasks; the owner: everything, with client health and quotes) — so it can triage what is late, say when an item auto-approves, count revision rounds, and draft briefs, consolidated change requests and client messages. It answers in French, Darija, Arabic or English, prepares but never acts, and never bends the Flow. Teach it more about the agency in `lib/assistant.ts` (`AGENCY`).

Captions and titles: owner, admins and social media managers. Corrections: every studio role except viewers. The assistant: everyone signed in. Only pictures from Google Drive or the app's storage are sent to Groq (three at most, 4 MB each). Limits per person: 20 AI calls and 15 assistant questions a minute.

## Meetings — video and audio calls with clients

**Réunions** (studio sidebar) and the portal's **Réunions** tab. The owner, admins and social media managers plan a call with a client — video, or audio only — pick the team members to bring, a date, a time (Morocco time) and an agenda; **Appel instantané** starts one now. The client's portal contacts and the invited members are told in the app (and the client by e-mail when Gmail is set up), and everyone joins with **Rejoindre**: the call opens inside the app, with camera, microphone, screen sharing and chat, nothing to install. A meeting opens 30 minutes before its time; whoever plans it can open the room earlier to test.

Calls run on [Daily](https://www.daily.co) (free up to 10,000 participant-minutes a month): set `DAILY_API_KEY` (dashboard.daily.co → Developers) in Vercel. Each meeting gets its own private room and each person a personal, short-lived link, so only those invited get in. Without the key — or for a client who prefers their own tool — paste a Google Meet or Zoom link in the meeting and **Rejoindre** opens it instead.

## Instagram analysis — owner and admins

**Analyse Instagram** (studio sidebar, owner and admins only). Paste any public Instagram account — a client's, your own, a competitor's — as `@name` or a profile link. The app reads its profile and its last 50 posts and reels and shows:

- **Vue d'ensemble**: followers and their growth, engagement rate, posts per week, typical reel views, reel views ÷ followers, viral posts, and plain-language recommendations (which format to post more, the best day and time, hashtags, reel and caption length, how often and how many reels the other accounts post).
- **Ce qui fonctionne**: performance by format, reel length and caption length, a day × time heat map (in the viewer's time zone), hashtags, and a sortable table of every post.
- **Publications virales**: the posts that did 2× or more than the account's typical post.
- **Comparer**: every account followed side by side, follower growth indexed to 100, and the other accounts' best posts.

"1.0×" is a typical post for *that* account (engagement ÷ its median post), so small and large accounts compare fairly. Mark one account **C'est mon compte** to get recommendations written for it. **Exporter en PDF** (on the account card) lays the whole audit out on A4 — overview and recommendations, what works, viral posts and the comparison — and opens the browser's print dialog: choose « Enregistrer au format PDF » to hand it to a client. Each reading keeps that day's follower count, so growth appears once an account has been read on two different days.

Readings run on [Apify](https://apify.com)'s official Instagram actors (pay per use, about 30–90 seconds per account): set `APIFY_TOKEN` (apify.com → Settings → API & Integrations) in Vercel; `IG_POSTS_LIMIT` (12–200) changes how many posts are read. A reading is kept, and **Relire** reads again only if the last one is more than 10 minutes old, to spare credits. Private accounts can't be read. Pictures are shown through the app (`/api/ig/img`, Instagram's own image hosts only).

To save space, analyses are not kept for long. After the print dialog closes, the page asks « Le PDF est-il enregistré ? », and **Oui** deletes that account's analysis (its reading and follower history). An analysis nobody exported is deleted **two days after its last reading**, whenever the page lists the accounts and in the daily sweep (`/api/flow/sweep`). Each account card shows when it will go.

## Bibliothèque — the team's prompts, plugins and useful links

**Ajouter**: paste anything. A link becomes a site, a plugin (known stores) or an asset (Drive, Dropbox…), and its title, icon and description are read from the page (`/api/library/preview`: public web pages only — private, loopback and cloud-metadata addresses are refused, redirects re-checked). A text becomes a prompt. Nothing is saved until **Enregistrer**. Prompts can hold blanks such as `{client}` or `{produit}`, filled in when copying, plus the AI tool they are for and an example result. Every entry can have tags.

Browsing: tabs with counts (Favoris, Prompts, Plugins…), instant search, tag chips and a sort by newest, most used or A→Z. Your own ★ favourites come first. A card opens a side panel with the full text, **Copier**, **Dupliquer**, **Modifier**, **Supprimer** and its history. Copies and openings are counted. The same link twice is flagged (it can still be added on purpose).

Everyone in the studio adds. Only the author, the owner and admins edit or delete; others duplicate to make their own version. Viewers read, and clients never see the library. The assistant can search it and save a prompt or link to it on request.

## Public sign-up — off until you switch it on

With `PUBLIC_SIGNUP=on` in Vercel, the sign-in page shows **« Créer le compte de votre entreprise »**: a company gives its name, the person's name, e-mail and a password, receives a **6-digit code by e-mail** (valid 30 minutes, 5 tries), and on entering it gets its **own workspace** under its own name, as its owner. From there it runs like the studio: clients, tasks, invitations, portal, social, meetings.

- **The code is required** so nobody can claim an address that isn't theirs — otherwise someone could register a future team member's or client's e-mail and walk in the day they're invited. Until the code is entered, no account exists (the request waits in a `signup_requests` table that creates itself; password hashed, code stored as a keyed hash).
- **No leaks**: an address that already has an account gets exactly the same answer (and an e-mail telling its owner to sign in); nothing is ever taken over.
- **Sealed off**: each company only ever reaches its own workspace (`ws:org:…`); the studio's own workspace, the print workspace and `/admin/finance` stay yours (`OWNER_EMAIL`).
- **Throttled**: 3 requests per e-mail and 10 per network address per hour; 30 code checks per address per hour.
- Needs Gmail (`GMAIL_USER`, `GMAIL_APP_PASSWORD`) in production. Locally without e-mail, the code is shown on screen instead.

Not yet: each company still sees The One Core's logo, and uses the studio's keys (Groq, Apify, Daily, WhatsApp) — branding per company and plans with usage limits come next, which is why sign-up stays **off** by default. Remove `PUBLIC_SIGNUP` (or set it to anything else) to close it again: companies already created keep working.

## Your brand — per workspace

**Équipe → Votre marque** (owner and administrators): a logo, a main colour and — in a company's own workspace — its name. They replace The One Core's everywhere that workspace's people and clients look: the sidebar, the client portal, the call window, the colour of buttons and highlights, the invitation PDF and e-mails, quotes and invoices in the portal, the Instagram audit PDF, and the assistant (« Assistant Studio Nour », which then knows nothing about The One Core's agency and says so rather than inventing). A company without a logo shows its name as a wordmark. The studio keeps « The One Space » as its name and can still pick a logo and colour; the print workspace keeps The One Print. Stored per workspace (`brand:<workspace>` meta row); logos are the workspace's own uploads (PNG).

## Forgotten password

« Mot de passe oublié ? » under the sign-in form e-mails a one-time link (`/login?reset=…`, 30 minutes; a new request voids the previous link). Setting the new password signs out every other device. Same answer whether or not the address has an account; throttled. Needs Gmail (`GMAIL_*`).

## Social statistics and reports

**Social → Statistiques** (and each client's Social tab; clients see theirs in the portal under *Statistiques*): for the last 30 or 90 days, this month or last month, and one client or all of them —

- **Publications, reach and views, interactions** (likes, comments, shares, saves), **engagement rate** (interactions ÷ reach, or ÷ views where a network has no reach) and **followers** with their growth over the period;
- **interactions week by week**, a table **per network**, and the **top 10 posts**;
- **Exporter CSV** (one line per post and network) and **Imprimer / PDF** — the page prints as a clean, client-ready report.

The numbers come from the platforms, for posts the app published (`lib/social-insights.ts`): Instagram (likes, comments, reach, saves, shares, views), Facebook (reactions, comments, shares, reach or video views), TikTok (views, likes, comments, shares) and YouTube (views, likes, comments), plus each account's followers once a day. They refresh on their own with the publishing scheduler (at most every 6 hours per workspace, posts of the last 90 days), and on demand with **Actualiser les statistiques**. No new setting: the Meta and Google permissions were already requested; **TikTok accounts connected before this change must be reconnected once** (Social → Comptes) to grant `video.list` and `user.info.stats`, and those two scopes must be added to the TikTok app.

## WhatsApp — "ready to approve" messages

When a task moves to **À valider**, a client whose file has a **WhatsApp** number gets a message on their phone. It is sent straight from the app through Meta's WhatsApp Cloud API (`lib/whatsapp.ts`). A missing number or missing server configuration is reported to the studio; the task save still succeeds. Meta acceptance is shown separately from delivery: the activity feed records the message ID, but acceptance does not prove it reached the recipient.

A failed message never undoes the save: the task still goes for approval, the studio sees a toast with Meta's reason, and the outcome is written to the activity feed (*« WhatsApp envoyé à … »* or *« WhatsApp non envoyé … — raison »*). Editing a task that is already waiting does not message the client again; sending it back for a new round does. Managers can use **Renvoyer WhatsApp** on the waiting task after fixing configuration. Retries are limited to one per task per minute, including concurrent requests.

### 1. Meta setup (once)

1. In **Meta Business Suite**, create a WhatsApp Business account and add the sending number — The One Core's: **+212 6 07 48 48 22** (`0607484822`). Clients receive the messages from it and can reply to it.
   **A number can live either on the phone app or on the API, not both.** Using the app and the API on one number (Meta's *coexistence*) is only offered through a Meta Solution Partner or Tech Provider, not to a business connecting its own app. So either use a second number for the API, or delete the WhatsApp account on the phone first (WhatsApp → Settings → Account → Delete account) and move the number over — the phone app then stops working for it.
2. **WhatsApp Manager → Message templates → Create template**, category **Utility**. Meta only allows a business to start a conversation with an approved template, so the wording lives there, not in the code. Suggested text — the three variables must stay in this order:

   Language **French** (`fr`) — the only one: every client gets the message in French, whatever the language on their file. (If the template was filed under another language code — WhatsApp Manager often preselects English `en_US` — the app finds it anyway by trying the usual codes, and remembers the one that works.)
   > Bonjour {{1}}, le livrable « {{2}} » de votre projet est en attente de votre validation. Consultez-le et validez-le ou demandez une modification sur votre espace client : {{3}} . Sans réponse de votre part sous 48 heures, il sera validé automatiquement.

   Samples for Meta's review: `Kojo Bakery` · `Reel de lancement` · `https://space.the1core.com`. Keep the wording factual (a specific item, its status, what happens next): promotional words (« nouveau contenu », « Merci ! », emojis) make Meta classify it as **Marketing** and reject it as Utility.

   `{{1}}` client name · `{{2}}` deliverable name · `{{3}}` portal address. `WHATSAPP_TEMPLATE` is the template's **name** (e.g. `pret_a_valider`), not its numeric id — and the template must be on the **same WhatsApp Business account** as the sending number (`WHATSAPP_PHONE_NUMBER_ID`), or Meta answers *(#132001) Template name does not exist in the translation* in every language. Approval usually takes minutes to a few hours; until the template is **Active**, Meta answers *(#132001) Template name does not exist in the translation*. Meta rejects a template whose text starts or ends with a variable — hence the sentence after the link.
   **Optional second template — « new message »**: when someone at the studio writes in a task's chat (text, voice note or file), the client gets a WhatsApp too — at most once per task every 2 hours. Name it e.g. `nouveau_message`, category **Utility**, language **French**:
   > Bonjour {{1}}, {{2}} a répondu dans le suivi de votre projet « {{3}} ». Consultez la conversation et répondez depuis votre espace client : {{4}} . Ce message concerne un projet en cours avec The One Core.

   `{{1}}` client name · `{{2}}` who wrote · `{{3}}` task name · `{{4}}` portal address. Leave `WHATSAPP_COMMENT_TEMPLATE` empty to keep only the « ready to approve » message.
   **Assignment template — `tache_assignee`** (Utility, French, four positional body variables):
   > Bonjour {{1}}, la tâche « {{2}} » vous a été assignée par {{3}}. Consultez les instructions dans votre espace : {{4}} . Ce message concerne le suivi de votre travail.

   `{{1}}` member name · `{{2}}` task name · `{{3}}` assigner name · `{{4}}` sign-in URL. It must be approved on the same WhatsApp Business account as the sending number. The assignment and comment templates work independently of the approval template. Use positional **body** parameters; this implementation does not fill dynamic headers, named parameters or URL button parameters.
3. **Business settings → System users**: create a system user, assign it the app and the WhatsApp account with full control, and generate a **permanent token** (expiration: *Never*) with `whatsapp_business_messaging`, `whatsapp_business_management` and `business_management`.
4. Note the **Phone number ID** shown in WhatsApp Manager → API setup (a long number — not the phone number itself).

### 2. Vercel environment

| Variable | Value |
|---|---|
| `WHATSAPP_TOKEN` | the system user's permanent token |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID |
| `WHATSAPP_TEMPLATE` | the template's name, e.g. `pret_a_valider` |
| `WHATSAPP_ASSIGNMENT_TEMPLATE` | the approved assignment template name, e.g. `tache_assignee` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | recommended: exact approval template language code, e.g. `fr`; auto-detected if empty |
| `WHATSAPP_ASSIGNMENT_LANGUAGE` | exact assignment language code; falls back to `WHATSAPP_TEMPLATE_LANGUAGE` |
| `WHATSAPP_COMMENT_LANGUAGE` | exact comment language code; falls back to `WHATSAPP_TEMPLATE_LANGUAGE` |
| `WHATSAPP_COMMENT_TEMPLATE` | optional: the « new message » template's name, e.g. `nouveau_message` |
| `WHATSAPP_CHANGES_TEMPLATE` | client modification alert to the assignee, e.g. `retours_client` |
| `WHATSAPP_CHANGES_LANGUAGE` | exact changes template language code, e.g. `fr` |
| `WHATSAPP_REMINDER_TEMPLATE` | manual task reminder to the assignee, e.g. `rappel_tache` |
| `WHATSAPP_REMINDER_LANGUAGE` | exact reminder template language code, e.g. `fr` |

Redeploy.

### 3. Per client

Client file → **Modifier la fiche → WhatsApp**. Enter a Moroccan local number such as `0612345678`, or an international number such as `+212 6 12 34 56 78`. Spaces, parentheses, dots and dashes are accepted; `00212…`, `212…` and Arabic digits are also supported. Contacts are saved in international format (`+212612345678`). Other countries require their country code (`+33…`, `0044…`, etc.). Moroccan numbers must have 10 domestic digits including the initial `0`, or 9 digits after `+212`; extra subscriber digits are rejected with an explanation.

### 4. Per member

**Équipe → WhatsApp → Ajouter un numéro**, or the optional WhatsApp field on the invitation. Managers can edit any studio member's number, including their own; members can edit their own number. Other members and client portals cannot read these contacts. Clear the field to stop sending task WhatsApp notifications to that member.

Member contacts accept the same local and international formats as client contacts. Approval, assignment and comment notifications also normalize older stored contacts before sending them to Meta.

A new assignment sends one template message to the new member, after the task save succeeds. Self-assignment, clearing an assignment, editing unrelated task fields and rejected concurrent writes do not send. This covers normal tasks, accepted client requests, content-plan assignments and print tasks. Outcomes appear in Activity; missing configuration and Meta errors never undo task saves.

### 5. Client modifications and task reminders

Use your **existing** WhatsApp Business account and sending number. In **Meta Business Suite → WhatsApp Manager → Message templates → Create template**, create these two additional templates. Choose **Utility** (Meta reviews the category), **French (`fr`)**, and **positional/numeric variables**. Use a text body, without a header or buttons. Submit each template and wait until it is approved/Active. [Meta's template sending documentation](https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive) explains the creation and approval requirement.

**Template name: `retours_client`**

```text
Bonjour {{1}}, des modifications ont été demandées sur la tâche « {{2}} » par le client {{3}}. Consultez ses retours et le statut de la tâche dans votre espace : {{4}} . Ce message concerne le suivi de votre travail en cours.
```

Samples, in order: `Salma` · `Poster de lancement` · `Centre Al-khaouarizmi` · `https://space.the1core.com/login`.

**Template name: `rappel_tache`**

```text
Bonjour {{1}}, ceci est un rappel concernant la tâche « {{2}} » qui vous est assignée. {{3}} vous invite à consulter les instructions et à mettre à jour son avancement dans votre espace : {{4}} . Ce message concerne le suivi de votre travail en cours.
```

Samples, in order: `Salma` · `Poster de lancement` · `Safwane` · `https://space.the1core.com/login`.

Then in **Vercel → the-one-tracker-app → Settings → Environment Variables**, add these values to **Production** (and Preview if used), and redeploy:

```dotenv
WHATSAPP_CHANGES_TEMPLATE=retours_client
WHATSAPP_CHANGES_LANGUAGE=fr
WHATSAPP_REMINDER_TEMPLATE=rappel_tache
WHATSAPP_REMINDER_LANGUAGE=fr
```

Keep the existing `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. Both templates must belong to that sending number's WhatsApp Business account. Their four body variables must stay in the order above.

When the client submits **Demander des modifications**, the task, feedback comment and decision event save together. One WhatsApp alert is queued for the assigned team member after the response, so Meta does not slow down the client's submission. Studio-recorded client feedback follows the same path; an extra revision round still alerts the assignee while keeping the task paused pending an accepted extra quote. Feedback text/voice remains in the task chat.

Owners/admins can open an unfinished task and use **Rappeler l’assigné**. This sends `rappel_tache` to its assignee without changing task status or revision. The reminder is limited to one attempt per task per minute, including simultaneous requests. Archived, completed and unassigned tasks cannot be reminded. Missing member numbers, missing templates and Meta errors are recorded in **Activity**; a successful send means Meta accepted the message, not a confirmed delivery receipt.

Studio and client task lists, status groups and board columns default to **À valider → À faire → En cours → En pause → Validé**, then earliest due date within each status. Studio users can still choose name/date sorting; returning from a task preserves that chosen view.

### Troubleshooting delivery

1. Check the studio's Activity outcome and the app's error toast. Missing environment variables are listed by name; tokens are never returned.
2. Use a registered production sending number, not an unregistered test number. Meta's test numbers can message only recipients added in API Setup.
3. Check the token has not expired and has access to this Phone Number ID. For `132001`, check the exact template name, approved language and Business account. For `132000`, match the number and order of body variables above.
4. HTTP acceptance plus a `wamid` is not delivery confirmation. Inspect delivery errors in Meta's WhatsApp Manager/webhooks if the recipient still receives nothing. No webhook delivery state is configured by this patch.

Provider reference: [Meta's WhatsApp Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

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
| Auth | **E-mail + password only** ([lib/password-auth.ts](lib/password-auth.ts): scrypt hashes, hashed session tokens). Failed sign-ins are throttled per network address + e-mail (5 → 15 min) and per address (20 → 15 min), never per account alone, so a stranger can't lock anyone out and the answers never reveal whether an account exists ([lib/login-throttle.ts](lib/login-throttle.ts); its `login_throttle` table creates itself, keys hashed). No self sign-up: the owner is seeded from `OWNER_EMAIL`/`OWNER_PASSWORD`, everyone else is invited with a temporary password. Renewing an administrator's access is the owner's alone, and a temporary password is only ever shown to the owner |

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

## Agency Google Drive

The owner connects the agency account in **Settings → Google Drive** and chooses its root folder. **Client → Files** generates an editable folder plan from the saved brief and production scope; confirmation creates it in Drive. Owners and administrators can upload, rename, move, download and restore client files. The assistant can prepare a draft for review.

Enable Google Drive API and Google Picker API, configure a dedicated OAuth client or reuse the existing web Google client, add the Picker key and matching project number, then redeploy. Follow [the complete setup guide](docs/GOOGLE-DRIVE-SETUP.md) for URLs, permissions, account connection and the first real verification. Run `pnpm test:drive` for the integration checks against simulated Google responses.

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
