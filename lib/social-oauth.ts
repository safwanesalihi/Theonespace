// The three logins behind « Connecter »: Facebook (Pages and their Instagram accounts), TikTok and
// Google (YouTube). Each builds the provider's login address, turns its answer into accounts, and
// keeps the tokens fresh. The platforms only offer this through an app the studio registers once
// (META_APP_*, TIKTOK_CLIENT_*, GOOGLE_CLIENT_*); nobody copies an id or a token.
import { env } from '@/lib/env';
import type { OAuthProvider, PendingPage } from '@/lib/social-accounts';

const graph = 'https://graph.facebook.com/v21.0';
const googleId = () => env.GOOGLE_CLIENT_ID || env.AUTH_GOOGLE_ID || '';
const googleSecret = () => env.GOOGLE_CLIENT_SECRET || env.AUTH_GOOGLE_SECRET || '';

export const providerLabels: Record<OAuthProvider, string> = { meta: 'Facebook et Instagram', tiktok: 'TikTok', google: 'YouTube' };

export function providerConfigured(provider: OAuthProvider) {
  if (provider === 'meta') return !!(env.META_APP_ID && env.META_APP_SECRET);
  if (provider === 'tiktok') return !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
  return !!(googleId() && googleSecret());
}

export const redirectUri = (origin: string, provider: OAuthProvider) => `${origin}/api/social/callback/${provider}`;

// Everything publishing and statistics need, asked once, so a later phase never needs a new login.
const metaScopes = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'business_management',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights',
];
const tiktokScopes = ['user.info.basic', 'video.publish', 'video.upload'];
const googleScopes = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];

export function authorizeUrl(provider: OAuthProvider, redirect: string, state: string) {
  if (provider === 'meta') {
    // A Business-type app logs in through a « configuration » that holds the permissions; an app
    // without one asks for the permissions directly.
    const q = new URLSearchParams({
      client_id: env.META_APP_ID!, redirect_uri: redirect, state, response_type: 'code',
      ...(env.META_LOGIN_CONFIG_ID ? { config_id: env.META_LOGIN_CONFIG_ID, override_default_response_type: 'true' } : { scope: metaScopes.join(',') }),
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
  }
  if (provider === 'tiktok') {
    const q = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY!, redirect_uri: redirect, state, response_type: 'code', scope: tiktokScopes.join(',') });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  }
  const q = new URLSearchParams({
    client_id: googleId(), redirect_uri: redirect, state, response_type: 'code', scope: googleScopes.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type Json = Record<string, unknown>;
async function getJson(url: string, init?: RequestInit): Promise<Json> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const data = (await response.json().catch(() => ({}))) as Json;
  // TikTok answers every success with `error: { code: 'ok' }`; anything else in `error` is a failure.
  const error = (data.error as { message?: string; code?: string } | string | undefined);
  const failed = typeof error === 'object' ? !!error && error.code !== 'ok' : !!error;
  if (!response.ok || failed || data.error_description) {
    const message = typeof error === 'object' ? error?.message : (data.error_description as string) || (typeof error === 'string' ? error : '');
    throw new Error(message || `HTTP ${response.status}`);
  }
  return data;
}
const isoIn = (seconds?: unknown) => (typeof seconds === 'number' && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : undefined);

// ---------------------------------------------------------------- Meta

/** The login's answer → every Page this person manages, each with its token and its Instagram account. */
export async function metaPages(code: string, redirect: string): Promise<PendingPage[]> {
  const short = await getJson(`${graph}/oauth/access_token?${new URLSearchParams({ client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, redirect_uri: redirect, code })}`);
  // A long-lived user token makes Page tokens that don't expire.
  const long = await getJson(`${graph}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, fb_exchange_token: String(short.access_token) })}`);
  const pages = await getJson(`${graph}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}', limit: '100', access_token: String(long.access_token) })}`);
  type Page = { id: string; name: string; access_token?: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } };
  return ((pages.data as Page[]) ?? []).filter((p) => p.access_token).map((p) => ({
    id: p.id, name: p.name, token: p.access_token!, ...(p.picture?.data?.url ? { picture: p.picture.data.url } : {}),
    ...(p.instagram_business_account ? { instagram: { id: p.instagram_business_account.id, username: p.instagram_business_account.username, picture: p.instagram_business_account.profile_picture_url } } : {}),
  }));
}

// ---------------------------------------------------------------- TikTok

export type TokenSet = { token: string; refreshToken?: string; expiresAt?: string; refreshExpiresAt?: string };

async function tiktokToken(body: Record<string, string>): Promise<TokenSet & { openId: string }> {
  const data = await getJson('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY!, client_secret: env.TIKTOK_CLIENT_SECRET!, ...body }),
  });
  return {
    token: String(data.access_token), refreshToken: String(data.refresh_token), openId: String(data.open_id),
    expiresAt: isoIn(data.expires_in), refreshExpiresAt: isoIn(data.refresh_expires_in),
  };
}

export async function tiktokAccount(code: string, redirect: string) {
  const tokens = await tiktokToken({ code, grant_type: 'authorization_code', redirect_uri: redirect });
  const info = await getJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', { headers: { Authorization: `Bearer ${tokens.token}` } });
  const user = ((info.data as Json)?.user ?? {}) as { display_name?: string; avatar_url?: string };
  return { ...tokens, externalId: tokens.openId, name: user.display_name || 'TikTok', picture: user.avatar_url };
}

export const refreshTiktok = (refreshToken: string) => tiktokToken({ grant_type: 'refresh_token', refresh_token: refreshToken });

// ---------------------------------------------------------------- Google / YouTube

async function googleToken(body: Record<string, string>): Promise<TokenSet> {
  const data = await getJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: googleId(), client_secret: googleSecret(), ...body }),
  });
  return { token: String(data.access_token), ...(data.refresh_token ? { refreshToken: String(data.refresh_token) } : {}), expiresAt: isoIn(data.expires_in) };
}

export async function youtubeAccount(code: string, redirect: string) {
  const tokens = await googleToken({ code, grant_type: 'authorization_code', redirect_uri: redirect });
  if (!tokens.refreshToken) throw new Error('Google n’a pas accordé d’accès durable : reconnectez le compte.');
  const channels = await getJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${tokens.token}` } });
  type Channel = { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } };
  const channel = ((channels.items as Channel[]) ?? [])[0];
  if (!channel) throw new Error('Ce compte Google n’a pas de chaîne YouTube.');
  return { ...tokens, externalId: channel.id, name: channel.snippet?.title || 'YouTube', username: channel.snippet?.customUrl, picture: channel.snippet?.thumbnails?.default?.url };
}

export const refreshGoogle = (refreshToken: string) => googleToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
