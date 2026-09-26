// Publishing to Facebook Pages and Instagram business accounts through Meta's Graph API.
// Server-only; every function returns a result and never throws, so one platform failing never
// stops the others or loses what already went out.
//
// Facebook takes a post or a photo story in one or two calls, a Reel or a video story through an
// upload session. Instagram works in two steps: a "container" is created from the media's public
// URL, Instagram processes it (a few seconds for a photo, up to a few minutes for a video), and only
// then can it be published. A container still processing is
// reported as `pending` and finished by the next run (lib/editorial-publish.ts).
import { env } from '@/lib/env';
import type { MediaType } from '@/lib/media-storage';

const graph = 'https://graph.facebook.com/v21.0';

export type MediaItem = { url: string; type: MediaType };
/** What one network publishes: its format (lib/social.ts), its media in order, and its caption. */
export type PostMedia = { items: MediaItem[]; caption: string; format: string };
export type Outcome =
  | { ok: true; externalId: string; url?: string }
  | { ok: false; error: string }
  | { pending: true; containerId?: string; childIds?: string[] };

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

/**
 * A Reel or a video story goes up in three steps: an upload session is opened, Meta fetches the video
 * from its public URL (`file_url`), then the session is finished. Returns what the last step answers.
 */
async function uploadVideo<T>(pageId: string, edge: 'video_reels' | 'video_stories', token: string, url: string, finish: Record<string, unknown>) {
  const started = await call<{ video_id: string; upload_url?: string }>(`${pageId}/${edge}`, { method: 'POST', token, body: { upload_phase: 'start' } });
  if (!started.ok) return started;
  const videoId = started.data.video_id;
  try {
    const response = await fetch(started.data.upload_url || `https://rupload.facebook.com/video-upload/v21.0/${videoId}`, {
      method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: url }, signal: AbortSignal.timeout(60_000),
    });
    const data = (await response.json().catch(() => ({}))) as GraphError & { success?: boolean };
    if (!response.ok || data.error) {
      const reason = data.error?.error_user_msg || data.error?.message || `HTTP ${response.status}`;
      console.error('meta', 'rupload', data.error?.code, reason);
      return { ok: false as const, error: reason };
    }
  } catch (error) {
    const timeout = (error as Error).name === 'TimeoutError';
    console.error('meta', 'rupload', timeout ? 'timeout' : (error as Error).message);
    return { ok: false as const, error: timeout ? 'Meta n’a pas récupéré la vidéo à temps.' : 'Meta est injoignable.' };
  }
  const finished = await call<T>(`${pageId}/${edge}`, { method: 'POST', token, body: { upload_phase: 'finish', video_id: videoId, ...finish } });
  return finished.ok ? { ok: true as const, data: finished.data, videoId } : finished;
}

/** A Reel: one video, with its caption. Meta finishes processing it on its side and then shows it. */
async function publishFacebookReel(pageId: string, token: string, media: PostMedia): Promise<Outcome> {
  const video = media.items.length === 1 && media.items[0].type === 'video' ? media.items[0] : null;
  if (!video) return { ok: false, error: 'Un Reel publie une seule vidéo.' };
  const result = await uploadVideo<{ success?: boolean }>(pageId, 'video_reels', token, video.url, { video_state: 'PUBLISHED', ...(media.caption ? { description: media.caption } : {}) });
  return result.ok ? { ok: true, externalId: result.videoId, url: `https://www.facebook.com/reel/${result.videoId}` } : { ok: false, error: result.error };
}

/** A story: one photo or one video, without a caption (Facebook stories carry none). */
async function publishFacebookStory(pageId: string, token: string, media: PostMedia): Promise<Outcome> {
  if (media.items.length !== 1) return { ok: false, error: 'Une story publie une seule photo ou vidéo.' };
  const item = media.items[0];
  if (item.type === 'video') {
    const result = await uploadVideo<{ post_id?: string }>(pageId, 'video_stories', token, item.url, {});
    if (!result.ok) return { ok: false, error: result.error };
    const id = result.data.post_id || result.videoId;
    return { ok: true, externalId: id, url: `https://www.facebook.com/${id}` };
  }
  // A photo story is made from a photo uploaded unpublished.
  const photo = await call<{ id: string }>(`${pageId}/photos`, { method: 'POST', token, body: { url: item.url, published: false } });
  if (!photo.ok) return { ok: false, error: photo.error };
  const story = await call<{ post_id?: string }>(`${pageId}/photo_stories`, { method: 'POST', token, body: { photo_id: photo.data.id } });
  if (!story.ok) return { ok: false, error: story.error };
  const id = story.data.post_id || photo.data.id;
  return { ok: true, externalId: id, url: `https://www.facebook.com/${id}` };
}

/** A post (text, one video, one photo, or several photos in one post), a Reel, or a story. */
export async function publishToFacebook(pageId: string, media: PostMedia, connectedToken?: string): Promise<Outcome> {
  const { items, caption, format } = media;
  const videos = items.filter((m) => m.type === 'video');
  if (format === 'post' && videos.length && items.length > 1) return { ok: false, error: 'Facebook : une vidéo seule, ou des photos (pas les deux).' };
  // A Page connected with « Connecter » brings its own token; the older setup asks Meta for it.
  const page = connectedToken ? { token: connectedToken } : await pageToken(pageId);
  if ('error' in page) return { ok: false, error: page.error! };
  if (format === 'reel') return publishFacebookReel(pageId, page.token!, media);
  if (format === 'story') return publishFacebookStory(pageId, page.token!, media);
  if (!items.length) {
    const result = await call<{ id: string }>(`${pageId}/feed`, { method: 'POST', token: page.token, body: { message: caption } });
    return result.ok ? { ok: true, externalId: result.data.id, url: `https://www.facebook.com/${result.data.id}` } : { ok: false, error: result.error };
  }
  if (videos.length) {
    const result = await call<{ id: string }>(`${pageId}/videos`, { method: 'POST', token: page.token, body: { file_url: videos[0].url, description: caption } });
    return result.ok ? { ok: true, externalId: result.data.id, url: `https://www.facebook.com/${pageId}/videos/${result.data.id}` } : { ok: false, error: result.error };
  }
  if (items.length === 1) {
    const result = await call<{ id: string; post_id?: string }>(`${pageId}/photos`, { method: 'POST', token: page.token, body: { url: items[0].url, caption, published: true } });
    if (!result.ok) return { ok: false, error: result.error };
    const postId = result.data.post_id || result.data.id;
    return { ok: true, externalId: postId, url: `https://www.facebook.com/${postId}` };
  }
  // Several photos: each is uploaded unpublished, then attached to one post.
  const ids: string[] = [];
  for (const item of items) {
    const uploaded = await call<{ id: string }>(`${pageId}/photos`, { method: 'POST', token: page.token, body: { url: item.url, published: false } });
    if (!uploaded.ok) return { ok: false, error: uploaded.error };
    ids.push(uploaded.data.id);
  }
  const post = await call<{ id: string }>(`${pageId}/feed`, {
    method: 'POST', token: page.token, body: { message: caption, attached_media: ids.map((id) => ({ media_fbid: id })) },
  });
  return post.ok ? { ok: true, externalId: post.data.id, url: `https://www.facebook.com/${post.data.id}` } : { ok: false, error: post.error };
}

// ---------------------------------------------------------------- Instagram

export async function startInstagram(igUserId: string, media: PostMedia, token?: string): Promise<Outcome> {
  const { items, caption, format } = media;
  if (!items.length) return { ok: false, error: 'Ajoutez une photo ou une vidéo.' };
  if (format === 'carousel') {
    // Each item becomes a carousel child; the carousel itself is created once they are all processed.
    const childIds: string[] = [];
    for (const item of items.slice(0, 10)) {
      const child = await call<{ id: string }>(`${igUserId}/media`, {
        method: 'POST', token, body: item.type === 'video' ? { media_type: 'VIDEO', video_url: item.url, is_carousel_item: true } : { image_url: item.url, is_carousel_item: true },
      });
      if (!child.ok) return { ok: false, error: child.error };
      childIds.push(child.data.id);
    }
    return { pending: true, childIds };
  }
  const item = items[0];
  const story = format === 'story';
  const body: Record<string, unknown> = item.type === 'video'
    ? { media_type: story ? 'STORIES' : 'REELS', video_url: item.url }
    : { ...(story ? { media_type: 'STORIES' } : {}), image_url: item.url };
  // Stories carry no caption.
  if (!story && caption) body.caption = caption.slice(0, 2200);
  const created = await call<{ id: string }>(`${igUserId}/media`, { method: 'POST', token, body });
  return created.ok ? { pending: true, containerId: created.data.id } : { ok: false, error: created.error };
}

/** A carousel whose children were created: once they're all processed, creates the carousel container. */
export async function finishCarouselChildren(igUserId: string, childIds: string[], caption: string, token?: string): Promise<Outcome> {
  for (const id of childIds) {
    const status = await call<{ status_code?: string; status?: string }>(`${id}?fields=status_code,status`, { token });
    if (!status.ok) return { ok: false, error: status.error };
    if (status.data.status_code === 'IN_PROGRESS') return { pending: true, childIds };
    if (status.data.status_code === 'ERROR' || status.data.status_code === 'EXPIRED') {
      return { ok: false, error: `Instagram a refusé un élément du carrousel${status.data.status ? ` (${status.data.status})` : ''}.` };
    }
  }
  const carousel = await call<{ id: string }>(`${igUserId}/media`, {
    method: 'POST', token, body: { media_type: 'CAROUSEL', children: childIds.join(','), ...(caption ? { caption: caption.slice(0, 2200) } : {}) },
  });
  return carousel.ok ? { pending: true, containerId: carousel.data.id } : { ok: false, error: carousel.error };
}

/** Finishes a container: publishes it once Instagram is done processing, or says it isn't yet. */
export async function finishInstagram(igUserId: string, containerId: string, token?: string): Promise<Outcome> {
  const status = await call<{ status_code?: string; status?: string }>(`${containerId}?fields=status_code,status`, { token });
  if (!status.ok) return { ok: false, error: status.error };
  const code = status.data.status_code;
  if (code === 'IN_PROGRESS') return { pending: true, containerId };
  if (code === 'ERROR' || code === 'EXPIRED') {
    return { ok: false, error: code === 'EXPIRED' ? 'Instagram a laissé expirer le média : relancez la publication.' : `Instagram a refusé le média${status.data.status ? ` (${status.data.status})` : ''}. Vérifiez le format et les proportions.` };
  }
  // FINISHED — or already PUBLISHED by an earlier run that lost its answer on the way back.
  const published = await call<{ id: string }>(`${igUserId}/media_publish`, { method: 'POST', token, body: { creation_id: containerId } });
  if (!published.ok) return { ok: false, error: published.error };
  const link = await call<{ permalink?: string }>(`${published.data.id}?fields=permalink`, { token });
  return { ok: true, externalId: published.data.id, url: link.ok ? link.data.permalink : undefined };
}

/** One step forward for a pending Instagram publication: carousel children, then the container. */
export async function continueInstagram(igUserId: string, pending: { containerId?: string; childIds?: string[] }, caption: string, token?: string): Promise<Outcome> {
  if (pending.containerId) return finishInstagram(igUserId, pending.containerId, token);
  if (pending.childIds?.length) {
    const next = await finishCarouselChildren(igUserId, pending.childIds, caption, token);
    return 'pending' in next && next.containerId ? finishInstagram(igUserId, next.containerId, token) : next;
  }
  return { ok: false, error: 'Publication Instagram introuvable : relancez-la.' };
}

/** Starts, then keeps checking for up to `waitMs` so a photo (and a short video) finishes in one go. */
export async function publishToInstagram(igUserId: string, media: PostMedia, waitMs: number, token?: string, pause = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Outcome> {
  let outcome = await startInstagram(igUserId, media, token);
  const deadline = Date.now() + waitMs;
  while ('pending' in outcome) {
    outcome = await continueInstagram(igUserId, outcome, media.caption, token);
    if (!('pending' in outcome) || Date.now() + 3000 > deadline) break;
    await pause(3000);
  }
  return outcome;
}
