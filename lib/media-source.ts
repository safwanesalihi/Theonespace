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
// Drive may answer a download with a redirect between its download hosts or to Google's file servers
// (<id>.googleusercontent.com). Nothing else on google.com (accounts, apis, …) is followed.
const redirectHosts = /^(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|accounts\.google\.com|([a-z0-9-]+\.)+googleusercontent\.com)$/;

const parse = (value: string) => { try { return new URL(value); } catch { return null; } };

/** Is this an address a post may take its media from? */
export function isMediaSource(value: string) {
  const url = parse(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return false;
  const storage = storagePrefix();
  if (driveHosts.test(url.hostname)) return true;
  return !!storage && inStorage(url, storage);
}

// fetch() normalizes dot segments, so a raw prefix test could be walked out of the bucket
// (…/editorial-media/../../x). Compare the parsed origin and path, and refuse anything that tries.
function inStorage(url: URL, storage: string) {
  const base = parse(storage);
  if (!base || url.origin !== base.origin || url.search.includes('\\')) return false;
  if (/\.\.|%2e|%2f|%5c|\\/i.test(url.pathname)) return false;
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return false; }
  if (path.includes('\\') || path.split('/').some((segment) => segment === '.' || segment === '..')) return false;
  return path.startsWith(base.pathname) && path.length > base.pathname.length;
}

const redirectAllowed = (value: string) => {
  const url = parse(value);
  if (!url || url.protocol !== 'https:') return false;
  const storage = storagePrefix();
  return redirectHosts.test(url.hostname) || (!!storage && inStorage(url, storage));
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
