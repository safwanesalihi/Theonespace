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
  WHATSAPP_COMMENT_TEMPLATE?: string; // optional: name of the approved "new message on a task" template
  WHATSAPP_ASSIGNMENT_TEMPLATE?: string; // approved assignment template: member, task, assigner, sign-in URL
  WHATSAPP_CHANGES_TEMPLATE?: string; // client feedback: member, task, client, sign-in URL
  WHATSAPP_REMINDER_TEMPLATE?: string; // task reminder: member, task, sender, sign-in URL
  WHATSAPP_TEMPLATE_LANGUAGE?: string; // exact Meta language code; automatic detection when unset
  WHATSAPP_ASSIGNMENT_LANGUAGE?: string;
  WHATSAPP_COMMENT_LANGUAGE?: string;
  WHATSAPP_CHANGES_LANGUAGE?: string;
  WHATSAPP_REMINDER_LANGUAGE?: string;
  WHATSAPP_APPROVED_TEMPLATE?: string; // « task approved by the client » to the owner and admins: person, task, client, sign-in URL
  WHATSAPP_APPROVED_LANGUAGE?: string;
  // Social accounts connected with « Connecter » (lib/social-accounts.ts): one app per platform,
  // registered once by the studio. Nobody copies an account id or a token.
  AUTH_SECRET?: string;              // 32+ random characters: encrypts the connected accounts' tokens
  AUTH_SECRET_PREVIOUS?: string;     // optional: earlier AUTH_SECRET value(s), comma-separated, still accepted to decrypt after a rotation (lib/secret-box.ts)
  TRUST_PROXY_HEADERS?: string;      // '1': trust x-real-ip / x-forwarded-for for the sign-in throttle (only behind a proxy that overwrites them)
  META_APP_ID?: string;              // Meta app (Facebook Login for Business) → Facebook Pages + Instagram
  META_APP_SECRET?: string;
  META_LOGIN_CONFIG_ID?: string;     // Facebook Login for Business configuration (its permissions and assets)
  META_GRAPH_VERSION?: string;       // Meta Graph API version for every Meta call, e.g. v23.0 (lib/meta-graph.ts); v21.0 when empty
  TIKTOK_CLIENT_KEY?: string;        // TikTok app (Login Kit + Content Posting API)
  TIKTOK_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;         // Google OAuth client with the YouTube Data API (AUTH_GOOGLE_* are used if unset)
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string; // optional dedicated pair; otherwise reuse GOOGLE_CLIENT_* / AUTH_GOOGLE_*
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_PICKER_KEY?: string; // browser API key, restricted to app origins and Google Picker API
  GOOGLE_DRIVE_PROJECT_NUMBER?: string; // numeric Cloud project number used by Picker
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  GROQ_API_KEY?: string;            // Groq: writing help and the assistant (lib/ai.ts)
  GROQ_MODEL?: string;              // optional: another Groq text model (default openai/gpt-oss-120b)
  GROQ_VISION_MODEL?: string;       // image analysis when Gemini is not configured
  GEMINI_API_KEY?: string;          // assistant, full video/audio and image analysis, writing help
  GEMINI_THINKING?: string;         // optional: how long Gemini thinks first — minimal, low (default), medium, high
  GEMINI_MODEL?: string;            // optional: another Gemini model (default gemini-flash-latest, then gemini-3.8-flash and gemini-flash-lite-latest)
  APIFY_TOKEN?: string;             // IG Analyzer: Apify token that reads public Instagram profiles (lib/ig-analyzer)
  IG_POSTS_LIMIT?: string;          // optional: recent posts read per account (12–200, default 50)
  DAILY_API_KEY?: string;           // Daily (daily.co): audio and video calls for the meetings (lib/daily.ts)
  PUBLIC_SIGNUP?: string;           // 'on': anyone can create a company account and its own workspace (lib/signup.ts); off by default
  NODE_ENV?: string;
};

export const env: AppEnvironment = process.env as AppEnvironment;
