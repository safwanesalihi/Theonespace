// The only place the app reads process.env. Tests swap this module for a controlled object.
export type AppEnvironment = {
  AUTH_URL?: string;          // exact origin the browser uses, e.g. https://tracker.the1core.com
  OWNER_EMAIL?: string;       // the one owner account
  OWNER_PASSWORD?: string;    // seeds (or re-arms) the owner account; change the password after first login
  GMAIL_USER?: string;        // Gmail address that sends invitations
  GMAIL_APP_PASSWORD?: string;// Google "App password" for that address (2-step verification required)
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  CRON_SECRET?: string;
  SUPABASE_URL?: string;             // https://<project>.supabase.co — media files for the Plan éditorial
  SUPABASE_SERVICE_ROLE_KEY?: string; // server-only; signs uploads into the media bucket
  SUPABASE_MEDIA_BUCKET?: string;     // public bucket for post media (default "editorial-media")
  META_PUBLISH_TOKEN?: string;        // system-user token allowed to post on the Pages and Instagram accounts
  META_STUDIO_FACEBOOK_PAGE_ID?: string; // the studio's own Page, for internal posts
  META_STUDIO_INSTAGRAM_ID?: string;     // the studio's own Instagram business account, for internal posts
  WHATSAPP_TOKEN?: string;           // Meta system-user access token with whatsapp_business_messaging
  WHATSAPP_PHONE_NUMBER_ID?: string; // the sending number's id in WhatsApp Manager (not the number itself)
  WHATSAPP_TEMPLATE?: string;        // name of the approved "ready to approve" template
  // Social accounts connected with « Connecter » (lib/social-accounts.ts): one app per platform,
  // registered once by the studio. Nobody copies an account id or a token.
  AUTH_SECRET?: string;              // 32+ random characters: encrypts the connected accounts' tokens
  META_APP_ID?: string;              // Meta app (Facebook Login for Business) → Facebook Pages + Instagram
  META_APP_SECRET?: string;
  META_LOGIN_CONFIG_ID?: string;     // Facebook Login for Business configuration (its permissions and assets)
  TIKTOK_CLIENT_KEY?: string;        // TikTok app (Login Kit + Content Posting API)
  TIKTOK_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;         // Google OAuth client with the YouTube Data API (AUTH_GOOGLE_* are used if unset)
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  NODE_ENV?: string;
};

export const env: AppEnvironment = process.env as AppEnvironment;
