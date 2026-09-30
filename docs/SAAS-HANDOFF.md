# The One Space — SaaS handoff: APIs and social connections

> Written on 2026-09-30 from the code on `main` (commit `95f9423`), for whoever continues this work (a person or another LLM).
> Goal: turn The One Space from "The One Core's own tool, plus companies that sign up" into a real multi-tenant SaaS, the way Metricool (social) or Notion (workspaces) work. This covers every external API and the social media connections.
> **Rule for the reader:** check anything about Meta, TikTok or Google against their current docs before acting. Their app review rules, API versions and permission names change often. Section 12 lists what to verify.

---

## 0. TL;DR

1. **The social connection design is already the right SaaS model.** Metricool does it the same way:
   - one platform app per network, owned by The One Core (Meta, TikTok, Google);
   - every customer workspace logs into its own accounts with OAuth ("Connecter");
   - tokens are stored per workspace and per client, encrypted.

   Nobody copies ids or tokens. What's missing is mostly **platform approval** (app review, business verification, audits), **legal pages**, **per-tenant limits and billing**, and **scale plumbing** (a queue and webhooks). Very little is missing in the architecture itself.
2. **Fix first (P0), before any outside company uses social features:**
   - a legacy fallback lets any workspace publish or read through The One Core's own Meta system token. It must be restricted to The One Core's own workspaces (§9.4);
   - Instagram analysis (Apify) and meetings (Daily) run on The One Core's paid keys with no plan limit for companies.
3. **Then:**
   - submit the Meta app for App Review with Business Verification;
   - get the TikTok app audited;
   - get the Google OAuth consent screen verified;
   - rewrite the existing legal pages for a SaaS (they're written for the agency today) and add Meta's data-deletion callback;
   - move publishing to a proper queue;
   - automate billing.
4. **Per-tenant WhatsApp** (each company sends from its own number) needs Meta's *Embedded Signup* as a Tech Provider. Today every company's messages would go out from The One Core's number and template.

---

## 1. The product

- **The One Space** (also called "The One Tracker"), at `https://space.the1core.com`, made by **The One Core**, a creative agency in Berrechid, Morocco.
- **What it does:** production tracking and client approval for content studios.
  - Tasks go through a status flow: À faire → En cours → À valider → Validé.
  - Approval runs on a 48-hour clock: silence counts as approval.
  - A 7-day lock before each publishing date; 2 revision rounds.
  - A client portal, and a social calendar with a composer and publishing (Facebook, Instagram, TikTok, YouTube) plus statistics.
  - Also: quotes, invoices and contracts; meetings (video calls); an Instagram competitor analysis; a monthly editorial plan (mind map); a shared library; and a Gemini-based assistant « One » that can act (create or update tasks, comment, save to the library, remember facts).
- **Languages:** French UI with English and Arabic translations. The assistant also speaks Darija.
- **Who uses it today:**
  - The One Core's studio (owner, admins, creatives, social media manager, viewers) and its clients (portal);
  - a separate print workspace;
  - companies that sign up publicly (`PUBLIC_SIGNUP=on`) and get their own workspace with a trial and a plan.

## 2. Stack and infrastructure

| Piece | What |
|---|---|
| Framework | **Next.js 16.3** (App Router, route handlers in `app/api/**/route.ts`), React 19, TypeScript 5.9. ⚠️ This Next version has breaking changes compared with older docs: read `node_modules/next/dist/docs/` before writing Next code (see `AGENTS.md`). |
| Hosting | **Vercel**. Project `prj_cM6K3piMKt1oyrlcv6qCkQW8Zy4N`, team `team_IcaZAcLn4oi3m4GNZba7nSKy`. Production = branch `main`. Previews come from other branches and use the **same production database**, so be careful. |
| Database | **Postgres (Supabase)**, accessed with the `postgres` driver and SQL (drizzle only for migrations in `drizzle/`). Locally: PGlite in `.data/pglite`. |
| Storage | Supabase Storage bucket (`SUPABASE_MEDIA_BUCKET`, default `editorial-media`) for social post media. Small images (logos, avatars, voice notes) live in the `assets` table. |
| Mail | Gmail SMTP (nodemailer) with `GMAIL_USER` / `GMAIL_APP_PASSWORD`: invitations, sign-up codes, password reset. |
| Cron | `vercel.json`: `/api/flow/sweep` daily at 06:00 UTC (approval clocks, Instagram-analysis cleanup). Publishing needs `/api/editorial/publish-due` **every 5 minutes**, called by an external scheduler (cron-job.org) with `Authorization: Bearer $CRON_SECRET`; Vercel Hobby allows only daily crons. |
| UI | Tailwind 4, Radix UI, lucide icons, recharts. Colour tokens are in `app/tokens.css` (use existing tokens only). |
| Tests | `npm test` runs **28 suites** (esbuild bundles plus an in-memory PGlite, with every external API stubbed). `npm run lint` has one old error, in `app/login.tsx`. |

### Repo conventions (keep them)
- **Branches:** develop on a feature branch and push to `main` only when the owner says "push". Command: `git fetch origin main -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main`.
- **Translations:** every UI string is French and passes through `t("…")`. Add its English and Arabic in `lib/i18n/en.ts` and `lib/i18n/ar.ts`, after the line `"Couleur par défaut rétablie.":`, and check both quote styles for an existing key first.
- **Security rules from the owner:**
  - never put API keys in code, chat or screenshots; keys live only in Vercel env vars;
  - never decrypt Vercel env values;
  - the owner never pastes passwords into chat.

## 3. Multi-tenancy model today

- **Workspace ids** (`lib/workspace.ts`):
  - `ws:<ownerUserId>`: The One Core's studio;
  - `ws:<ownerUserId>:print`: the print workspace (`isPrintWorkspaceId`);
  - `ws:org:<uuid>`: a **company** created by public sign-up (`isCompanyWorkspaceId`).
- **Tables:**
  - `users`, `sessions` (cookie sessions, hashed tokens);
  - `workspaces`, and `workspace_members` (user × workspace × role, plus `client_id` for client contacts);
  - **`records`**: one table for all business data: `id, owner, workspace_id, kind, data jsonb, revision`. `kind` includes client, project, task, comment, event, library, document, editorial_post, platform, meeting, request, plan_item, print_*. Kind **`meta`** holds private per-workspace blobs that are never sent to the browser. Examples:
    - `social-account:<ws>:<clientId>:<network>`: connected accounts with **AES-256-GCM encrypted tokens** (`lib/secret-box.ts`, key derived from `AUTH_SECRET`);
    - `assistant-memory:<ws>`;
    - `ig-*`: Instagram analyses;
    - `titles:*`;
    - branding.
  - `subscriptions` and `ai_usage` (created on first use, `lib/subscription.ts`);
  - `signup_requests`, `assets`.
- **Isolation:** every query filters by `workspace_id`, and the records API checks membership (`workspaceFor`). Optimistic concurrency uses `revision`.
- **Roles** (`lib/workspace.ts`): `owner`, `admin`, `creative`, `social`, `print_operator`, `viewer`, `client`.
  - `isManager` = owner or admin;
  - `canSocial` = owner, admin or social;
  - `isMemberRole` = creative, social or print_operator (they only see their own and unassigned tasks);
  - clients only see their portal slice (`portalView`).
- **Platform owner:** the account whose e-mail is `OWNER_EMAIL`. Its **Plateforme** page (`app/api/platform`, `lib/platform-admin.ts`) lists companies, marks plans paid, gives read-only support access, and deletes companies.
- **Branding per workspace:** name, logo and colour (`lib/branding.ts`).

## 4. Plans and billing today

- `lib/plans.ts`: a 14-day **trial**, then **Starter 299 MAD** (3 seats, 10 clients, 2 GB, 300 AI calls per month), **Pro 699 MAD** (10 / 50 / 10 GB / 1,500), **Agence 1,499 MAD** (25 / 200 / 50 GB / 5,000). Grace period: 7 days.
- **No online payment:**
  1. a company clicks "request plan";
  2. The One Core gets an e-mail;
  3. The One Core collects the money by bank transfer or a card link;
  4. The One Core marks the workspace paid on the Plateforme page.
- `planRefusal(ws, limit)` blocks writes when the plan is inactive or a limit is hit. `countAiCall(ws)` counts assistant and writing-help calls.
- The One Core's own workspaces have **no plan and no limits**.

## 5. Inventory of every external API

| Service | Used for | Env vars (names only) | Code | Owned by | Multi-tenant today? |
|---|---|---|---|---|---|
| **Meta: Facebook Login for Business** | "Connecter" Facebook Pages and their Instagram business accounts | `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` | `lib/social-oauth.ts`, `app/api/social/connect\|callback/[provider]` | The One Core's Meta app | ✅ Tokens stored per workspace and client. The app needs **App Review + Advanced Access** before it works for Pages of people outside the app's roles. |
| **Meta: Graph API publishing and insights** | Posts, carousels, Reels, Stories on FB and IG; statistics | the connected tokens, or the legacy `META_PUBLISH_TOKEN` | `lib/meta-publish.ts`, `lib/social-insights.ts`, `lib/editorial-publish.ts` | — | ⚠️ See §9.4: the legacy system-token fallback is **not** tenant-safe. |
| **Meta: WhatsApp Cloud API** | "Prêt à valider" message to a client's phone (template) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE`, optional `WHATSAPP_COMMENT_TEMPLATE` | `lib/whatsapp.ts` | The One Core's number | ❌ Every workspace would send from The One Core's number and template. |
| **TikTok: Login Kit + Content Posting API** | Connect, publish videos and photos, read stats | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `lib/social-oauth.ts`, `lib/tiktok-publish.ts` | The One Core's TikTok app | ✅ Structurally. Posts stay **private** until TikTok audits the app. |
| **Google: YouTube Data API v3** | Connect, upload Shorts and videos, read stats | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (falls back to `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`) | `lib/social-oauth.ts`, `lib/youtube-publish.ts` | The One Core's Google Cloud project | ✅ Structurally. Needs **OAuth verification** (sensitive scope `youtube.upload`); in "Testing" mode, tokens die after 7 days. |
| **Google Gemini** | The assistant « One » (streaming and tools) | `GEMINI_API_KEY` (Production only), optional `GEMINI_MODEL`, `GEMINI_THINKING` | `lib/agent.ts`, `app/api/assistant/route.ts` | The One Core | ✅ Metered by `aiPerMonth`. Cost is The One Core's. |
| **Groq** | Captions, titles, corrections; assistant fallback | `GROQ_API_KEY`, optional `GROQ_MODEL`, `GROQ_VISION_MODEL` | `lib/ai.ts` | The One Core | ✅ Metered by `aiPerMonth`. |
| **Apify** | Instagram competitor analysis (public profiles) | `APIFY_TOKEN`, optional `IG_POSTS_LIMIT` | `lib/ig-analyzer/*`, `app/api/ig` | The One Core (pay per use) | ⚠️ **No plan limit**: any company owner or admin can spend The One Core's credits. |
| **Daily.co** | Video and audio calls (meetings) | `DAILY_API_KEY` | `lib/daily.ts`, `app/api/meetings` | The One Core | ⚠️ No plan limit for companies. |
| **Supabase** | Postgres and media storage | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MEDIA_BUCKET` | `lib/database.ts`, `lib/media-storage.ts` | The One Core | ✅ Storage counted in `storageMb`. |
| **Gmail SMTP** | Transactional e-mail | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | `lib/mail.ts` | The One Core | ⚠️ Gmail has daily sending caps and is not meant for SaaS volume. The password is still flagged as a readable secret in Vercel: re-create it as **Sensitive**. |
| **Google Drive** | Media pasted as Drive links (read only, public links) | none | `lib/drive.ts`, `lib/media-fetch.ts` | — | ✅ |

Other secrets:
- `AUTH_SECRET` (32+ characters): signs OAuth state and encrypts social tokens. Rotating it breaks every connected account, so plan for key versioning (§11.6).
- `CRON_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `AUTH_URL`, `PUBLIC_SIGNUP`.

## 6. How "Connecter" works today (social OAuth)

1. **Start.** `GET /api/social/connect/{meta|tiktok|google}?clientId=…&workspace=…`:
   - checks access (`lib/social-access.ts`): studio social roles, or a **client contact connecting their own accounts from the portal**;
   - creates a signed 15-minute `state` (HMAC with `AUTH_SECRET`: workspace, client, user, provider, nonce) plus an HttpOnly nonce cookie;
   - redirects to the provider.
2. **Callback.** `GET /api/social/callback/{provider}`:
   - checks the state and cookie, then exchanges the code;
   - **Meta:** short-lived token → long-lived user token → `/me/accounts` gives every Page (non-expiring Page tokens) and its linked IG business account. They are saved as *pending* (encrypted, 15 minutes), and the user **picks which Page** belongs to this client (`/api/social/accounts?pick=…`);
   - **TikTok / Google:** access and refresh tokens are saved directly.
3. **Storage.** `saveAccount()` writes the meta row `social-account:<ws>:<clientId>:<network>` with `seal()`-encrypted tokens. There is one account per network per client; `clientId='internal'` is the studio's own account.
4. **Use.** `accountFor()` (in `lib/editorial-publish.ts`) returns the connected account, refreshing TikTok or Google tokens 5 minutes before they expire (`refreshTiktok`, `refreshGoogle`, then `updateTokens`). An expired refresh token gives a « reconnectez » message.
5. **Scopes requested** (all at once, so no later re-login is needed):
   - Meta: `pages_show_list, pages_read_engagement, pages_manage_posts, read_insights, business_management, instagram_basic, instagram_content_publish, instagram_manage_insights` (or through the `META_LOGIN_CONFIG_ID` configuration);
   - TikTok: `user.info.basic, user.info.stats, video.list, video.publish, video.upload`;
   - Google: `youtube.upload, youtube.readonly`.
6. **Publishing.**
   - Posts are claimed and published by `/api/editorial/publish-due` (every 5 minutes) or by « Publier maintenant ».
   - Instagram videos are two-step containers, finished on the next run.
   - TikTok photos are served from `/api/social/file/[token]`, a verified URL prefix at TikTok.
   - Repeating posts are handled by `lib/social-repeat.ts` and `lib/editorial-repeat.ts`.
7. **Statistics.** `lib/social-insights.ts`: per-post metrics and follower history, refreshed during the cron at most every few hours per workspace, or with « Actualiser ».
8. **Graph API version:** `v21.0`, hard-coded in `lib/social-oauth.ts`, `lib/meta-publish.ts`, `lib/social-insights.ts` and `lib/whatsapp.ts`. ⚠️ Meta retires each version about 2 years after release, and v21.0 came out in late 2024. **Check its end-of-life date now** and move the version into one constant or env var (`META_GRAPH_VERSION`).

---

## 7. What "SaaS like Metricool / Notion" means here

| Topic | Metricool / Notion pattern | The One Space should |
|---|---|---|
| Platform apps | One verified app per network, owned by the SaaS; every customer connects through it | Keep The One Core's apps. Get them **approved for public use** (§8). Customers never create developer apps. |
| Connections | Per workspace ("brand"), per network; a health status; reconnect e-mails | Already per workspace and client. Add **health checks**, **expiry warnings** and **deauthorization webhooks**. |
| Limits | Plans limit connected accounts ("brands"), posts and analytics depth | Add limits for `socialAccounts`, `scheduledPosts`, `igAnalyses`, `meetingMinutes` to `PlanLimits`. |
| Billing | Self-serve card payment, upgrade, downgrade, invoices | Add a payment provider and webhooks (§11.5). |
| Keys | The SaaS pays for its own APIs and passes the cost into plans; some offer BYOK for AI | Platform keys metered per plan. BYOK is optional for agencies (encrypted with `secret-box`). |
| Legal | Privacy policy, terms, DPA, data deletion, subprocessors list | Required by Meta, TikTok and Google review, and by GDPR and Moroccan law 09-08 (CNDP) (§10). |
| Scale | Queues, per-app rate-limit handling, retries, webhooks | Replace the 5-minute polling with a queue; add backoff and rate-limit tracking (§11.3). |

---

## 8. Step-by-step: platform approvals (the long pole — start now)

### 8.1 Meta (Facebook Pages and Instagram)
Prerequisites:
- a **Meta Business portfolio** for The One Core with **Business Verification** (company documents, domain, phone);
- the app type is **Business**, linked to that portfolio.

Steps:
1. **App settings → Basic:**
   - privacy policy URL, terms URL, **User data deletion** (callback URL or instructions URL), app icon, category, contact e-mail;
   - app domains: `the1core.com`, `space.the1core.com`.
2. **Facebook Login for Business:**
   - Valid OAuth Redirect URI: `https://space.the1core.com/api/social/callback/meta`;
   - a **Configuration** (User access token; assets Pages + Instagram accounts; the permissions in §6.5). Its id goes in `META_LOGIN_CONFIG_ID`.
3. **Deauthorize callback URL** and **Data deletion request URL**: implement the endpoints first (§11.2).
4. **App Review: request Advanced Access** for each permission actually used. Without Advanced Access, only people with a role on the app can connect. For each one, give a screencast of the real flow plus a use-case text:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `read_insights`
   - `instagram_basic`
   - `instagram_content_publish`
   - `instagram_manage_insights`
   - `business_management`: only if really needed. It's often rejected; drop it if unused.

   ⚠️ Meta has been renaming permissions (for example, some Instagram API permissions moved to `instagram_business_*` scopes for "Instagram API with Instagram Login"). **Check the current permission names** and whether to offer "Instagram Login" in addition to "Facebook Login for Business".
5. **Switch the app to Live mode.**
6. **Webhooks (optional, recommended):** subscribe to Page/Instagram webhooks for comments and mentions later.
7. **Rate limits:** Graph "Business Use Case" limits apply **per app and per Page/IG account**. Read the `X-Business-Use-Case-Usage` and `X-App-Usage` headers and back off (§11.3).

### 8.2 TikTok
1. Complete the app in the developer portal:
   - Login Kit plus **Content Posting API** with Direct Post;
   - redirect `https://space.the1core.com/api/social/callback/tiktok`;
   - verified URL prefix `https://space.the1core.com/api/social/file/`;
   - privacy and terms URLs.
2. Build and record the **required UX**: TikTok's guidelines ask for a preview, a privacy-level selector from `creator_info`, interaction toggles (comments, duet, stitch), a consent notice, and branded-content disclosure. ⚠️ Check what the composer currently shows against TikTok's current "Content Sharing Guidelines". This is the usual audit-rejection reason.
3. **Submit the audit.** Until it's approved, all posts are **private (SELF_ONLY)** and a small number of users are allowed.
4. **Rate limits** apply per user token and per app, and there's a daily post cap per creator.

### 8.3 Google / YouTube
1. Google Cloud project:
   - enable **YouTube Data API v3**;
   - OAuth client redirect: `https://space.the1core.com/api/social/callback/google`.
2. **OAuth consent screen:**
   - app name, logo, **privacy policy**, terms, authorized domains;
   - scopes `youtube.upload` (sensitive) and `youtube.readonly`;
   - set it to **In production**; "Testing" kills refresh tokens after 7 days.
3. **Verification:** submit the domain ownership check, a demo video, and a justification per scope. Sensitive scopes need verification; restricted ones need a CASA audit, but YouTube upload is sensitive, not restricted. **Confirm** this for current rules.
4. **YouTube API Services audit and quota:** the default quota is small (an upload costs a lot of units). Apply for a **quota extension**, which needs a YouTube API compliance audit. Until then, many uploads can be forced private.
5. Show the **Google API Services User Data Policy / Limited Use** disclosure in the privacy policy.

### 8.4 Other networks to consider (Metricool supports them)
- **LinkedIn:** Community Management API (Page posting) needs LinkedIn partner approval.
- **Pinterest:** API v5 with app review.
- **X / Twitter:** paid API tiers.
- **Threads:** Meta Threads API, same app family as Meta.
- **Google Business Profile:** access request needed.

Add each as a new `OAuthProvider` in `lib/social-accounts.ts` and `lib/social-oauth.ts`. The storage model already supports it.

### 8.5 WhatsApp for each company (optional, but SaaS-grade)
- **Today:** one number, the template "Prêt à valider", and the token of The One Core's WhatsApp Business Account.
- **SaaS options:**
  - **A. Keep one shared "The One Space" sender.** The simplest: the template says "via The One Space" and names the company in a variable. Messages come from your number.
  - **B. Become a Meta Tech Provider** (or work through a Solution Partner) and use **Embedded Signup**: each company connects its own WhatsApp Business Account and number. Store its WABA id, phone number id and token per workspace (encrypted, like social accounts), and have each company's templates approved. Billing per conversation goes to their WABA.
- **Recommendation:** A now, B when a customer asks for their own sender.

---

## 9. Code changes, ordered

### 9.1 P0: before any outside company uses social or paid APIs
1. **Tenant-safe Meta fallback (security).**
   - The problem: in `lib/editorial-publish.ts → accountFor()` and `lib/social-insights.ts → accessFor()`, when no account is connected, Facebook and Instagram fall back to `env.META_PUBLISH_TOKEN` (The One Core's **system user token**) with the page id typed on the client record (`client.facebookPageId` / `client.instagramId`). A company workspace (`ws:org:*`) owner can edit those fields on their own clients. If they type the id of a Page the system user manages (one of The One Core's clients), the app would **publish to or read that Page with The One Core's token**.
   - The fix: allow the fallback only when `!isCompanyWorkspaceId(workspaceId)`, or remove it once The One Core's own accounts are connected with "Connecter". Add a test in `tests/publishing.mjs` or `tests/social-insights.mjs`.
2. **Limits for paid third-party APIs.** Add `igAnalysesPerMonth` (Apify) and `meetingMinutesPerMonth` or `meetingsPerMonth` (Daily) to `PlanLimits` and `plans`. Enforce them in `app/api/ig/route.ts` (scan) and `app/api/meetings` (join or create), for company workspaces only. Count them like `ai_usage` (a generic `usage` table: workspace, month, metric, count).
3. **Connected-account limit.** Add `socialAccounts` to `PlanLimits` and enforce it in the callback before `saveAccount()`.
4. **Graph API version constant.** Replace the four hard-coded `v21.0` with one `META_GRAPH_VERSION` (env var, default the current version), and test after upgrading.

### 9.2 P1: platform requirements
1. **Data deletion and deauthorization endpoints (Meta).**
   - `POST /api/social/meta/deauthorize` and `POST /api/social/meta/data-deletion`: verify the `signed_request` (HMAC-SHA256 with `META_APP_SECRET`) and delete every `social-account:*` row whose `externalId` belongs to that user or Page.
   - The data-deletion endpoint must return `{ url, confirmation_code }`, with a status page at `/data-deletion?code=…`.
   - TikTok and Google revocation: handle `invalid_grant` or revoked tokens by marking the account `expired` and notifying.
2. **Account health.**
   - A daily job (the sweep) that calls a cheap endpoint per connected account (`/me`, `creator_info`, `channels?mine=true`) and marks it `ok`, `expired` or `revoked`.
   - E-mail the workspace owner 7 days before a refresh token expires and when a connection dies.
   - Show it in `app/social-accounts.tsx`.
3. **Legal pages.** They already exist: `/conditions` (terms), `/confidentialite` (privacy) and `/suppression-des-donnees` (data-deletion instructions), all built on `app/legal-page.tsx`. They're written for The One Core as an agency. Rewrite them for a **SaaS provider**: companies are customers, The One Core processes their data, list the subprocessors and add the Google Limited Use statement (content in §10). Add a subprocessors page and link everything from sign-up, the footer and the OAuth consent screens.
4. **TikTok composer compliance:** privacy level from `creator_info`, interaction toggles, the disclosure toggle, consent text (§8.2).
5. **Transactional e-mail provider.** Move from Gmail SMTP to Resend, Postmark, SES or Brevo with a verified domain (SPF, DKIM, DMARC on `the1core.com`). Keep `lib/mail.ts` as the single entry point.

### 9.3 P2: scale and product
1. **Queue instead of polling.**
   - Publishing jobs are keyed by post and network, with a scheduled time, attempts and a next retry.
   - Options: Vercel Pro cron every minute plus a `jobs` table (`SELECT … FOR UPDATE SKIP LOCKED`); Upstash QStash (scheduled HTTP calls, no infra); or Supabase `pg_cron` plus `pg_net`.
   - Exponential backoff; respect the rate-limit headers; a dead-letter status shown in the UI.
2. **Insights at scale:** stagger refreshes per account, store daily snapshots, and cap history per plan.
3. **Webhooks in** (comments, mentions, TikTok post status) where platforms offer them, instead of polling.
4. **BYOK (optional):** per-workspace `GEMINI_API_KEY`, `GROQ_API_KEY` or `APIFY_TOKEN`, stored encrypted with `seal()` in a meta row (`workspace-keys:<ws>`). When present, skip the plan meter.
5. **Audit log** for sensitive actions (connect, disconnect, publish, delete, plan change). There's already an `activity` module (`lib/activity.ts`) to extend.
6. **Custom domains or white-label** for agencies: portal on `portal.client.com` (Vercel domains API). Later.

### 9.4 Where things live (quick map)
- **Connect / callback / accounts:** `app/api/social/connect/[provider]/route.ts`, `app/api/social/callback/[provider]/route.ts`, `app/api/social/accounts/route.ts`, `lib/social-access.ts`, `lib/social-accounts.ts`, `lib/social-oauth.ts`, UI `app/social-accounts.tsx`.
- **Publishing:** `lib/editorial-publish.ts` (`accountFor`, `publishPost`), `lib/meta-publish.ts`, `lib/tiktok-publish.ts`, `lib/youtube-publish.ts`, `lib/editorial-queue.ts`, `app/api/editorial/publish`, `app/api/editorial/publish-due`.
- **Insights:** `lib/social-insights.ts`, `app/api/social/insights/route.ts`, `lib/social-report.ts`.
- **Plans:** `lib/plans.ts`, `lib/subscription.ts`, UI `app/subscription-panel.tsx`, platform `app/platform-page.tsx`, `app/api/platform/route.ts`.
- **Sign-up:** `lib/signup.ts`, `app/api/auth/signup`.
- **Secrets:** `lib/secret-box.ts` (AES-256-GCM, HKDF from `AUTH_SECRET`), `lib/env.ts` (the only place `process.env` is read; tests swap it).

---

## 10. Legal and compliance checklist
- **Privacy policy:**
  - what is collected: account data; client content; social tokens and the statistics read; AI prompts sent to Google (Gemini) and Groq; call metadata (Daily);
  - why it's collected, how long it's kept, subprocessors (Vercel, Supabase, Google, Groq, Apify, Daily, Meta, TikTok, the e-mail provider), international transfers, user rights, contact details;
  - the **Google Limited Use** statement.
- **Terms of service:** acceptable use (no spam or automation abuse on social networks), the customer is responsible for the content published, payment and refund terms, suspension, liability.
- **Data deletion:**
  - in-app deletion of a company already exists (Plateforme → delete). Add a self-serve "delete my workspace" for owners, plus the Meta data-deletion callback;
  - disconnecting an account must delete its tokens immediately (it does: `removeAccount`).
- **DPA** (data processing agreement) template for agency customers.
- **Morocco: law 09-08 / CNDP.** Declare the processing of personal data to the CNDP; there are also rules for cross-border transfers.
- **EU customers: GDPR** (a representative if needed, record of processing, breach procedure).
- **Cookies:** only essential cookies today (session, OAuth nonce). Keep it that way or add consent.

## 11. Technical notes for the implementer
1. **Keep the pattern:** OAuth state signed with HMAC plus an HttpOnly nonce cookie; tokens sealed; meta rows never sent to the browser; every query filtered by `workspace_id`; permissions checked on the server; the plan checked with `planRefusal`.
2. **Signed requests from Meta:** `base64url(sig).base64url(payload)`, with sig = HMAC-SHA256(payload, app secret). Compare in constant time.
3. **Rate limits:** read `X-App-Usage`, `X-Business-Use-Case-Usage` (Meta) and TikTok's error codes. Pause per account or app when usage is above ~90%. Never retry 4xx errors other than 429.
4. **Token refresh races:** two runs refreshing the same TikTok token can invalidate each other. Refresh under a row lock, or reuse the claim mechanism already used for posts (`publishing.claimMinutes`).
5. **Billing (to decide):**
   - In Morocco, Stripe needs a foreign entity. The options are a Merchant of Record (Paddle, Lemon Squeezy; they handle VAT and invoices), a local gateway (CMI, via a bank), or Stripe through an EU/US entity.
   - The app already has `requestPlan`, `extendPaid` and `paidUntil`: a payment webhook only needs to call the same "mark paid" logic as the Plateforme page.
6. **Key rotation:** `seal()` writes `v1.<iv>.<tag>.<body>`. To rotate `AUTH_SECRET`, add `v2` with a new key and keep `open()` able to read `v1` with the old key (`AUTH_SECRET_PREVIOUS`), then re-seal in the background.
7. **Staging:** the preview deployments use the **production database**. Create a separate Supabase project for previews before testing OAuth with real customers.

## 12. Verify in current docs before acting
- **Meta:** the current Graph API version and v21.0's end-of-life; current permission names (Instagram API with Facebook Login vs Instagram Login, `instagram_business_*`); whether `business_management` is needed; App Review screencast requirements; Tech Provider and Embedded Signup requirements for WhatsApp.
- **TikTok:** Content Posting API audit checklist and UX guidelines; daily limits; photo-post support; verified domain or URL prefix rules.
- **Google:** whether `youtube.upload` is sensitive or restricted today; YouTube API quota costs and the audit form; OAuth verification timelines.
- **Payments available to a Moroccan company**, and VAT or invoicing obligations.

## 13. Env vars (names only; values live in Vercel, never in code)
```
AUTH_URL AUTH_SECRET OWNER_EMAIL OWNER_PASSWORD CRON_SECRET PUBLIC_SIGNUP
DATABASE_URL DIRECT_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_MEDIA_BUCKET
GMAIL_USER GMAIL_APP_PASSWORD
META_APP_ID META_APP_SECRET META_LOGIN_CONFIG_ID
META_PUBLISH_TOKEN META_STUDIO_FACEBOOK_PAGE_ID META_STUDIO_INSTAGRAM_ID   # legacy fallback — see §9.1
TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET
GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET
WHATSAPP_TOKEN WHATSAPP_PHONE_NUMBER_ID WHATSAPP_TEMPLATE WHATSAPP_COMMENT_TEMPLATE
GEMINI_API_KEY GEMINI_MODEL GEMINI_THINKING
GROQ_API_KEY GROQ_MODEL GROQ_VISION_MODEL
APIFY_TOKEN IG_POSTS_LIMIT
DAILY_API_KEY
```
Known state: `GEMINI_API_KEY` is set for Production only; `GROQ_API_KEY` for Production and Preview; the WhatsApp variables for Production, without `WHATSAPP_COMMENT_TEMPLATE`.

## 14. Questions for the owner (answer before building)
1. **Which networks** at launch: FB, IG, TikTok, YouTube only, or also LinkedIn, Pinterest, Threads?
2. **WhatsApp:** one shared "The One Space" sender (option A) or each company's own number (option B, Tech Provider)?
3. **Payment provider**, and whether prices stay in MAD or also EUR/USD.
4. **Plan limits** for connected accounts, scheduled posts, IG analyses and meeting minutes.
5. Should company workspaces get the **assistant, IG analysis and meetings** on every plan, or only on higher plans?
6. The legal entity and address to show in the privacy policy and on the Meta/TikTok/Google developer accounts.
7. A **separate staging database**: yes or no, and when.

## 15. Suggested first prompt for the next session
> "Read `docs/SAAS-HANDOFF.md` and `AGENTS.md`. Implement §9.1 (P0) on a feature branch: (1) restrict the legacy Meta system-token fallback in `lib/editorial-publish.ts` and `lib/social-insights.ts` to non-company workspaces, with tests; (2) add plan limits for Apify IG analyses, Daily meetings and connected social accounts, enforced for company workspaces only, with a generic monthly `usage` table and tests; (3) move the Graph API version to one `META_GRAPH_VERSION` setting. Keep the repo conventions in §2 (French UI with en/ar translations, `npm test` green). Do not push to main until the owner says 'push'."
