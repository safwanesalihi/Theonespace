# Pilot setup — the second production and the first agencies

How to run The One Space for the first pilot agencies. **The existing production (space.the1core.com, its Vercel
project and its Supabase database) is never touched**: everything below happens on a separate second production
with its own Vercel project and its own database. The real production is made from it later.

## 1. What The One Core sets up once (shared by every agency)

| Piece | What to do | Settings |
|---|---|---|
| Database | A new Supabase project (not the existing one). Apply `drizzle/*.sql` in order (`pnpm db:migrate` with its `DIRECT_URL`). Turn on daily backups and restore one once, as a test. | `DATABASE_URL` (transaction pooler, port 6543), `DIRECT_URL` |
| Hosting | A new Vercel project from the pilot branch, on its own domain | `AUTH_URL` (that domain), `AUTH_SECRET` (32+ random characters), `OWNER_EMAIL`, `OWNER_PASSWORD` (the platform owner's first sign-in; change it after) |
| Sign-up | Switch on public sign-up so a pilot creates its own space | `PUBLIC_SIGNUP=on` |
| E-mail | Pilot: a Gmail account with an App Password. Many agencies: a sending provider (Resend, Postmark, Brevo, SES) on a verified domain. Each agency's e-mails carry its name and its owner as Reply-To. | `GMAIL_USER`, `GMAIL_APP_PASSWORD`, or `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_SMTP_USER`, `MAIL_SMTP_PASSWORD`, `MAIL_FROM` |
| Scheduled work | A scheduler (cron-job.org works, free) calls, with `Authorization: Bearer <CRON_SECRET>`: `GET <AUTH_URL>/api/editorial/publish-due` **every 5 minutes** (due posts go out) and `GET <AUTH_URL>/api/flow/sweep` **every 15 minutes** (deadlines: silent approvals, reminders, freeze alerts, archiving; it walks every agency). Opening the app also runs an agency's own deadlines. Vercel Hobby only allows one cron a day. | `CRON_SECRET` |
| Facebook + Instagram | The One Core's Meta app (Business type, Facebook Login for Business), redirect `<AUTH_URL>/api/social/callback/meta` | `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` |
| TikTok, YouTube | Optional for the pilot (see README → Social) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |
| WhatsApp | The One Core's WhatsApp Business number and its approved templates (README → WhatsApp). Every message counts in the agency's plan. | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_*_TEMPLATE` |
| Calls | Daily (10,000 free minutes a month, shared) | `DAILY_API_KEY` |
| AI, Instagram analysis | Groq / Gemini, Apify | `GROQ_API_KEY`, `GEMINI_API_KEY`, `APIFY_TOKEN` |
| Agency Google Drive | The Google OAuth client for Drive (docs/GOOGLE-DRIVE-SETUP.md) | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_PICKER_KEY`, `GOOGLE_DRIVE_PROJECT_NUMBER` |
| Uploads from the computer | Optional: a public Supabase Storage bucket for post media | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MEDIA_BUCKET` |

## 2. Instagram and Facebook during Meta's test mode

Until Meta approves the app (Business verification + App Review), **only people with a role on The One Core's
Meta app can connect a Page**. For a pilot, that is enough:

1. developers.facebook.com → the app → *App roles → Roles* → **Add people → Testers**: the Facebook account of
   each pilot person who will click « Connecter » (usually the agency's owner or social media manager, the
   account that manages the clients' Pages in their Business Manager).
2. They accept the invitation from their Facebook (developers.facebook.com → *Requests*).
3. In The One Space: Social → Comptes → **Connecter** for each client → log into that Facebook → pick the
   client's Page; its professional Instagram comes with it.

Start Business verification and App Review in parallel: they are needed before agencies can connect on their
own, and they take weeks.

## 3. What the pilot agency does

1. **Signs up** on the second production: company name, e-mail, the code it receives, its kind of agency.
2. **Plays « Construisez votre agence »** (5 questions: kind of agency, what it makes, who reviews before the
   client, what the client's silence does, WhatsApp / e-mail).
3. **Équipe**: its brand (name, logo, colour), then invites its team (role, optional studio role, WhatsApp).
4. **Clients**: each client's sheet (brief, WhatsApp number, monthly quota), then invites the client's contact
   (a portal login).
5. **Social → Comptes → Connecter** for each client (§2).
6. **Paramètres → Google Drive**: connects its own Drive.
7. Works. Everything else changes on **« Personnaliser »**. The owner can download all its data any time
   (Équipe → Abonnement → **Exporter les données**).

## 4. Before the first invoice

- Terms, privacy and a data-processing agreement written for a SaaS (`/conditions`, `/confidentialite`,
  `/suppression-des-donnees` are written for The One Core as an agency), and the CNDP declaration (law 09-08).
- An entity that invoices the subscription; payment by bank transfer for the pilots, marked paid on the
  Plateforme page.
