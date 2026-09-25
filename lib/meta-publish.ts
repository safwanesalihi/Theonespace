// Publishing to Facebook Pages and Instagram business accounts through Meta's Graph API.
// Server-only; every function returns a result and never throws, so one platform failing never
// stops the others or loses what already went out.
//
// Facebook takes a photo or a video in one call. Instagram works in two steps: a "container" is
// created from the media's public URL, Instagram processes it (a few seconds for a photo, up to a
// few minutes for a video), and only then can it be published. A container still processing is
// reported as `pending` and finished by the next run (lib/editorial-publish.ts).
import { env } from '@/lib/env';
import type { MediaType } from '@/lib/media-storage';

const graph = 'https://graph.facebook.com/v21.0';

export const metaPublishingConfigured = () => !!env.META_PUBLISH_TOKEN;

export type PostMedia = { url: string; type: MediaType; caption: string; postType?: string };
export type Outcome =
  | { ok: true; externalId: string; url?: string }
  | { ok: false; error: string }
  | { pending: true; containerId: string };

type GraphError = { error?: { message?: string; error_user_msg?: string; error_user_title?: string; code?: number } };

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; token?: string; body?: Record<string, unknown> } = {}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${graph}/${path}`, {
      method: init.method || 'GET',
      headers: { Authorization: `Bearer ${init.token || env.META_PUBLISH_TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json().catch(() => ({}))) as T & GraphError;
    if (!response.ok || data.error) {
      // Meta's user-facing message is the one that says what to change ("aspect ratio", "no permission"…).
      const reason = data.error?.error_user_msg || data.error?.message || `HTTP ${response.status}`;
      console.error('meta', path.split('?')[0], data.error?.code, reason);
      return { ok: false, error: reason };
    }
    return { ok: true, data };
  } catch (error) {
    const timeout = (error as Error).name === 'TimeoutError';
    console.error('meta', path.split('?')[0], timeout ? 'timeout' : (error as Error).message);
    return { ok: false, error: timeout ? 'Meta n’a pas répondu à temps.' : 'Meta est injoignable.' };
  }
}

// ---------------------------------------------------------------- Facebook

/** Posting as a Page takes the Page's own token, which the system user can ask for. */
async function pageToken(pageId: string) {
  const result = await call<{ access_token?: string }>(`${pageId}?fields=access_token`);
  if (!result.ok) return { error: result.error };
  if (!result.data.access_token) return { error: 'Cette Page n’est pas attribuée à l’utilisateur système (Business settings → System users → Assign assets).' };
  return { token: result.data.access_token };
}

export async function publishToFacebook(pageId: string, media: PostMedia): Promise<Outcome> {
  if (media.postType === 'Story') return { ok: false, error: 'Les stories Facebook ne sont pas prises en charge : choisissez Post, Reel ou Vidéo.' };
  if (media.postType === 'Carrousel') return { ok: false, error: 'Les carrousels ne sont pas encore pris en charge (un seul média par post).' };
  const page = await pageToken(pageId);
  if ('error' in page) return { ok: false, error: page.error! };
  if (media.type === 'video') {
    const result = await call<{ id: string }>(`${pageId}/videos`, { method: 'POST', token: page.token, body: { file_url: media.url, description: media.caption } });
    return result.ok ? { ok: true, externalId: result.data.id, url: `https://www.facebook.com/${pageId}/videos/${result.data.id}` } : { ok: false, error: result.error };
  }
  const result = await call<{ id: string; post_id?: string }>(`${pageId}/photos`, { method: 'POST', token: page.token, body: { url: media.url, caption: media.caption, published: true } });
  if (!result.ok) return { ok: false, error: result.error };
  const postId = result.data.post_id || result.data.id;
  return { ok: true, externalId: postId, url: `https://www.facebook.com/${postId}` };
}

// ---------------------------------------------------------------- Instagram

export async function startInstagram(igUserId: string, media: PostMedia): Promise<Outcome> {
  if (media.postType === 'Carrousel') return { ok: false, error: 'Les carrousels ne sont pas encore pris en charge (un seul média par post).' };
  const story = media.postType === 'Story';
  const body: Record<string, unknown> = media.type === 'video'
    ? { media_type: story ? 'STORIES' : 'REELS', video_url: media.url }
    : { ...(story ? { media_type: 'STORIES' } : {}), image_url: media.url };
  // Stories carry no caption.
  if (!story && media.caption) body.caption = media.caption.slice(0, 2200);
  const created = await call<{ id: string }>(`${igUserId}/media`, { method: 'POST', body });
  return created.ok ? { pending: true, containerId: created.data.id } : { ok: false, error: created.error };
}

/** Finishes a container: publishes it once Instagram is done processing, or says it isn't yet. */
export async function finishInstagram(igUserId: string, containerId: string): Promise<Outcome> {
  const status = await call<{ status_code?: string; status?: string }>(`${containerId}?fields=status_code,status`);
  if (!status.ok) return { ok: false, error: status.error };
  const code = status.data.status_code;
  if (code === 'IN_PROGRESS') return { pending: true, containerId };
  if (code === 'ERROR' || code === 'EXPIRED') {
    return { ok: false, error: code === 'EXPIRED' ? 'Instagram a laissé expirer le média : relancez la publication.' : `Instagram a refusé le média${status.data.status ? ` (${status.data.status})` : ''}. Vérifiez le format et les proportions.` };
  }
  // FINISHED — or already PUBLISHED by an earlier run that lost its answer on the way back.
  const published = await call<{ id: string }>(`${igUserId}/media_publish`, { method: 'POST', body: { creation_id: containerId } });
  if (!published.ok) return { ok: false, error: published.error };
  const link = await call<{ permalink?: string }>(`${published.data.id}?fields=permalink`);
  return { ok: true, externalId: published.data.id, url: link.ok ? link.data.permalink : undefined };
}

/** Starts, then keeps checking for up to `waitMs` so a photo (and a short video) finishes in one go. */
export async function publishToInstagram(igUserId: string, media: PostMedia, waitMs: number, pause = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Outcome> {
  let outcome = await startInstagram(igUserId, media);
  const deadline = Date.now() + waitMs;
  while ('pending' in outcome) {
    outcome = await finishInstagram(igUserId, outcome.containerId);
    if (!('pending' in outcome) || Date.now() + 3000 > deadline) break;
    await pause(3000);
  }
  return outcome;
}
