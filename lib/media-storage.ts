// Media for the Plan éditorial, kept in a public Supabase Storage bucket. Public on purpose: Meta
// fetches the file itself when a post is published and accepts nothing behind a login (a Google
// Drive link doesn't work either). Paths are random, so a file is only reachable by whoever has
// its exact URL.
//
// The browser uploads straight to Supabase with a signed URL minted here, so large videos never
// pass through a Vercel function (whose request body is capped at 4.5 MB).
import { env } from '@/lib/env';

export const mediaLimits = {
  image: { maxBytes: 8_000_000, types: ['image/jpeg'] },             // Instagram publishes JPEG only
  video: { maxBytes: 100_000_000, types: ['video/mp4', 'video/quicktime'] },
};
export type MediaType = keyof typeof mediaLimits;

const bucket = () => env.SUPABASE_MEDIA_BUCKET || 'editorial-media';
const base = () => (env.SUPABASE_URL || '').replace(/\/$/, '');
export const mediaStorageConfigured = () => !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
// Supabase has two key formats. The legacy service_role key is a JWT and goes in both headers; the
// newer secret key (sb_secret_…) is not a JWT and is only accepted in `apikey`.
function keyHeaders(): Record<string, string> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

export function mediaTypeOf(contentType: string): MediaType | null {
  const type = contentType.split(';')[0].trim().toLowerCase();
  return (Object.keys(mediaLimits) as MediaType[]).find((k) => mediaLimits[k].types.includes(type)) ?? null;
}

export const publicMediaUrl = (path: string) => `${base()}/storage/v1/object/public/${bucket()}/${path}`;

/** A one-time upload URL for `path`; the browser PUTs the file to it directly. */
export async function signedUpload(path: string): Promise<{ uploadUrl: string } | { error: string }> {
  try {
    const response = await fetch(`${base()}/storage/v1/object/upload/sign/${bucket()}/${path}`, {
      method: 'POST',
      headers: { ...keyHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
    if (!response.ok || !data.url) {
      console.error('media sign', response.status, data.message || data.error);
      return { error: data.message ? `Stockage : ${data.message}` : 'Le stockage des médias ne répond pas.' };
    }
    return { uploadUrl: `${base()}/storage/v1${data.url}` };
  } catch (error) {
    console.error('media sign', (error as Error).message);
    return { error: 'Le stockage des médias ne répond pas.' };
  }
}

/** Best effort: a leftover file costs a little storage, never a failed save. */
export async function removeMedia(paths: string[]) {
  const list = paths.filter(Boolean);
  if (!list.length || !mediaStorageConfigured()) return;
  try {
    await fetch(`${base()}/storage/v1/object/${bucket()}`, {
      method: 'DELETE',
      headers: { ...keyHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: list }),
    });
  } catch (error) {
    console.error('media remove', (error as Error).message);
  }
}
