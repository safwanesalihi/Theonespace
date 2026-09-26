// A photo handed to TikTok by address: TikTok only fetches from a domain the studio has verified with
// it, so the app serves the file from its own domain for a few hours. The link is signed and
// time-limited, and only ever points at the files a post already uses.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const key = () => env.AUTH_SECRET || (env.NODE_ENV === 'production' ? '' : 'local-development-only-secret-000000');
const mac = (payload: string) => createHmac('sha256', key()).update(`social-file:${payload}`).digest('base64url');

export function fileUrl(origin: string, url: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: url, e: now + 6 * 3_600_000 })).toString('base64url');
  return `${origin}/api/social/file/${payload}.${mac(payload)}`;
}

export function fileTarget(token: string, now = Date.now()): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || key().length < 32) return null;
  const a = Buffer.from(mac(payload)), b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: string; e: number };
    return e > now && /^https:\/\//.test(u) ? u : null;
  } catch { return null; }
}
