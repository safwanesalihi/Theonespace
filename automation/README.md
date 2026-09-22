# Social publisher — n8n setup

`the-one-social-publisher.n8n.json` publishes the tracker's editorial plan to Instagram, Facebook and YouTube. Import it into n8n, fill the **Config** node, attach five credentials, activate.

```
Every 15 min ─ Config ─ GET /api/editorial/queue ─ one item per (post, platform)
  └ Parse Drive link ─ Download from Google Drive ─ Media kind (image | video, client accounts)
      └ Caption by AI? ─ yes → Gemini writes it from the brief ─┐
                         no  → description used verbatim ───────┤
      ├ Instagram → Supabase re-host → /{client IG id}/media → publish
      ├ Facebook  → Supabase re-host → Page token for {client Page id} → /photos | /videos
      ├ YouTube   → which channel? → one upload node per channel (own Google sign-in)
      └ anything else → reported as unsupported
  every branch → POST /api/editorial/queue { ok, externalId, url | error }
```

## 1. Tracker

1. Add `AUTOMATION_SECRET` (32+ random chars) to the Vercel project → redeploy.
   ```sh
   openssl rand -hex 32
   ```
2. Platforms page: the names must be exactly **Instagram**, **Facebook**, **YouTube** (case does not matter). Add *YouTube* if it is not there yet; *TikTok* posts are reported as unsupported.
3. A post is picked up when it has a date, at least one platform and a **media link** (Google Drive share link). Optional time = earliest publishing hour (Casablanca).
4. **Caption**: the description is published as is — unless **« Légende rédigée par l'IA »** is ticked, in which case the description is a brief and Gemini writes the caption in the client's language (with the client's sector and brief as context), at publishing time.
5. **Per-client accounts** — on each client file, *Comptes sociaux*: Instagram Business account id, Facebook Page id, YouTube channel key. Any empty field falls back to the studio's own account from the **Config** node (internal posts always use the studio's).

## 2. Supabase — public bucket for Meta

Instagram and Facebook only fetch media from a public, direct URL; Drive links are not that.

1. Supabase → Storage → **New bucket** `social-media`, tick **Public bucket**.
2. Project settings → API → copy the **service_role** key (server-side only; it never leaves n8n).

The workflow uploads `<postId>.<ext>` with upsert, so re-runs overwrite the same object. Files stay there; empty the bucket from time to time or add a lifecycle rule.

## 3. Meta (Instagram + Facebook)

Requirements: a Facebook **Page**, an **Instagram Business/Creator** account linked to that Page, and a Meta developer app.

**Several clients, one credential.** The workflow uses one Meta token and, per post, asks Graph for the Page's own token (`GET /{page-id}?fields=access_token`). So the token's user must be able to manage every client Page:
- either the clients add your account as an **admin/editor of their Page** and link their Instagram account to it,
- or (cleaner for an agency) you create a **Business Manager**, clients grant your business **partner access** to their Page + Instagram account, and you use a **System User** token with `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `business_management` — it never expires.
Then note each client's Page id and Instagram account id on their client file in the tracker.

1. developers.facebook.com → **Create app** → *Other* → *Business*. Add the products **Instagram Graph API** and **Facebook Login for Business**.
2. Graph API Explorer → select the app → **Get User Access Token** with permissions
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`.
3. Exchange it for a **long-lived** token, then fetch the **Page access token** (does not expire while the user token is valid):
   ```sh
   curl "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN"
   ```
   ```sh
   curl "https://graph.facebook.com/v21.0/me/accounts?access_token=LONG_LIVED_USER_TOKEN"
   ```
   The response gives the **Page id** and the Page `access_token`.
4. Instagram Business account id:
   ```sh
   curl "https://graph.facebook.com/v21.0/PAGE_ID?fields=instagram_business_account&access_token=PAGE_TOKEN"
   ```
5. While the app is in *Development* mode only app admins/testers can post — fine for your own accounts. Go through **App Review** for `instagram_content_publish` / `pages_manage_posts` before posting on clients' accounts you don't administer.

Limits: Instagram allows 25 API publishes per account per 24 h; Reels ≤ 90 s (15 min for eligible accounts), 9:16, MP4/MOV; images JPEG only, ≤ 8 MB.

## 4. Google (Drive + YouTube)

1. console.cloud.google.com → new project → enable **Google Drive API** and **YouTube Data API v3**.
2. APIs & Services → **OAuth consent screen** → External → add your Google account as a test user. Add the n8n redirect URL shown in the n8n credential dialog.
3. Credentials → **OAuth client ID** (Web application) → copy client id / secret.
4. In n8n create two credentials with them: **Google Drive OAuth2 API** and **YouTube OAuth2 API**; connect with the Google account that owns (or is shared on) the Drive files and the YouTube channel.

YouTube upload quota: each upload costs 1 600 units of the default 10 000/day → ~6 uploads/day unless you request a quota increase.

**Several channels.** YouTube's OAuth is bound to one channel, so each client channel needs its own sign-in: create one *YouTube OAuth2 API* credential per channel (sign in with a Google account that manages that channel), and attach each to its **YT: upload (…)** node. The switch **YT: which channel?** routes on the client's *YouTube · chaîne* value — the keys shipped are `channel-a`, `channel-b`, `channel-c` (rename them to your clients' names in both places); empty → **YT: upload (studio)**. For a 4th channel, add a rule to the switch and duplicate an upload node.

## 4b. Gemini (captions)

Node **Gemini model** needs a *Google Gemini (PaLM) API* credential: an API key from aistudio.google.com → *Get API key* (free tier is enough for captions). If n8n's assistant already created a Gemini credential for you, just select it. Model and temperature: `geminiModel` in Config (`models/gemini-2.5-flash`), 0.7 on the node. The prompt lives in **Write caption (Gemini)** — edit it there to change the voice.

## 5. n8n

1. n8n Cloud (app.n8n.cloud) or self-hosted — either works; the workflow has no self-hosted-only node.
2. **Workflows → Import from file** → `the-one-social-publisher.n8n.json`.
3. Open **Config** and fill: `trackerUrl`, `igUserId` / `fbPageId` (the **studio's** accounts — fallbacks), `supabaseUrl`, `supabaseBucket` (leave `graphVersion`, `geminiModel`, `youtubePrivacy`, `youtubeCategoryId` unless you know why).
4. Credentials (each node with a red warning → pick or create):

   | n8n credential type | Name in the workflow | Value |
   |---|---|---|
   | Bearer Auth | Tracker – AUTOMATION_SECRET | the `AUTOMATION_SECRET` |
   | Header Auth | Supabase – service role | name `Authorization`, value `Bearer <service_role key>` |
   | Facebook Graph API | Meta – Page access token | the Page access token from step 3 |
   | Google Drive OAuth2 API | Google Drive | step 4 |
   | YouTube OAuth2 API | YouTube – studio / channel-a / … | step 4, one per channel |
   | Google Gemini (PaLM) API | Google Gemini | step 4b |

5. Test: create a post in the tracker dated today, platforms *Facebook* only, a Drive link to a small JPEG, no time. Click **Execute workflow** in n8n, watch the branch, then check the tracker: the post shows *Publié* with an *Ouvrir* link, or the platform's error message.
6. **Activate** the workflow.

## Behaviour to know

- Each platform is one job; a failure on one does not block the others. The tracker retries a failed platform on the next run after **one hour** and shows the last error on the post.
- Posts up to **3 days** old are still offered if never published (downtime, media added late). Older ones are left alone.
- A published post stays published even if edited. To post the same content again, create a new post.
- Instagram video processing is polled every 20 s for up to 5 min; longer than that is reported as a failure and retried later.
- Nothing is deleted from Drive or Supabase by the workflow.
- AI captions are generated at publishing time and are not stored back in the tracker; the post keeps its brief. The published text is visible on the platform via the *Ouvrir* link.
