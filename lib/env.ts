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
  AUTOMATION_SECRET?: string; // bearer token n8n sends to /api/editorial/queue (32+ chars, distinct from CRON_SECRET)
  WHATSAPP_TOKEN?: string;           // Meta system-user access token with whatsapp_business_messaging
  WHATSAPP_PHONE_NUMBER_ID?: string; // the sending number's id in WhatsApp Manager (not the number itself)
  WHATSAPP_TEMPLATE?: string;        // name of the approved "ready to approve" template
  WHATSAPP_TEMPLATE_LANGUAGES?: string; // languages it is approved in, e.g. "fr,ar" (default "fr")
  NODE_ENV?: string;
};

export const env: AppEnvironment = process.env as AppEnvironment;
