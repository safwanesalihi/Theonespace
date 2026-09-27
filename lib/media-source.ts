// Where a post's photos and videos may come from: the app's own storage (uploads) or Google Drive —
// the only two sources the composer offers. The server downloads these files itself (TikTok, YouTube,
// TikTok photos served from the app's domain), so any other address is refused, on save and again
// on download, redirects included: a post can never make the server fetch an internal or foreign address.
import { env } from '@/lib/env';

const storagePrefix = () => {
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/storage/v1/object/public/${env.SUPABASE_MEDIA_BUCKET || 'editorial-media'}/` : null;
};
const driveHosts = /^(drive\.usercontent\.google\.com|drive\.google\.com|docs\.google\.com)$/;
// Drive may answer a download with a redirect to Google's file servers.
const redirectHosts = /(^|\.)(google\.com|googleusercontent\.com)$/;

const parse = (value: string) => { try { return new URL(value); } catch { return null; } };

/** Is this an address a post may take its media from? */
export function isMediaSource(value: string) {
  const url = parse(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return false;
  const storage = storagePrefix();
  return driveHosts.test(url.hostname) || (!!storage && value.startsWith(storage));
}

const redirectAllowed = (value: string) => {
  const url = parse(value);
  if (!url || url.protocol !== 'https:') return false;
  const storage = storagePrefix();
  return redirectHosts.test(url.hostname) || (!!storage && url.origin === new URL(storage).origin);
};

/** Downloads a post's media, following at most 5 redirects, each one checked. Null when refused. */
export async function fetchMediaSource(value: string, init: { signal?: AbortSignal } = {}): Promise<Response | null> {
  if (!isMediaSource(value)) return null;
  let url = value;
  for (let hop = 0; hop <= 5; hop++) {
    const response = await fetch(url, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const next = response.headers.get('location');
    if (!next) return response;
    url = new URL(next, url).toString();
    if (!redirectAllowed(url)) return null;
  }
  return null;
}
