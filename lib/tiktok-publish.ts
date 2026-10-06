// Publishing to TikTok through its Content Posting API, with the account connected by « Connecter ».
// A video is uploaded (TikTok can't fetch a Drive link itself); photos are given by address through
// the app's own domain (app/api/social/file), which the studio verifies once with TikTok. TikTok then
// processes the post: the run reports it pending and the next one finishes it, as with Instagram.
import type { Outcome } from '@/lib/meta-publish';
import { mediaBytes } from '@/lib/media-fetch';

const api = 'https://open.tiktokapis.com/v2/post/publish';
type Item = { url: string; type: 'image' | 'video' };

async function call<T>(path: string, token: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${api}/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
    if (!response.ok || (json.error?.code && json.error.code !== 'ok')) {
      console.error('tiktok', path, json.error?.code, json.error?.message);
      return { ok: false, error: `TikTok : ${json.error?.message || json.error?.code || `HTTP ${response.status}`}` };
    }
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, error: 'TikTok ne répond pas.' };
  }
}

/** The most public audience this account may post to (an app not yet audited by TikTok may only post privately). */
async function privacy(token: string): Promise<string | { error: string }> {
  const info = await call<{ privacy_level_options?: string[] }>('creator_info/query/', token, {});
  if (!info.ok) return { error: info.error };
  const options = info.data.privacy_level_options ?? [];
  return options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0] ?? 'SELF_ONLY';
}

export async function startTiktok(token: string, format: string, items: Item[], caption: string, fileUrl: (url: string) => string): Promise<Outcome> {
  const level = await privacy(token);
  if (typeof level !== 'string') return { ok: false, error: level.error };
  if (format === 'photos') {
    const photos = items.filter((m) => m.type === 'image');
    const init = await call<{ publish_id: string }>('content/init/', token, {
      post_info: { title: caption.slice(0, 90), description: caption.slice(0, 4000), privacy_level: level, disable_comment: false, auto_add_music: true },
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: photos.map((m) => fileUrl(m.url)) },
      post_mode: 'DIRECT_POST', media_type: 'PHOTO',
    });
    return init.ok ? { pending: true, containerId: init.data.publish_id } : { ok: false, error: init.error };
  }
  const video = items.find((m) => m.type === 'video');
  if (!video) return { ok: false, error: 'TikTok : une seule vidéo.' };
  const file = await mediaBytes(video.url);
  if ('error' in file) return { ok: false, error: file.error };
  // TikTok's chunk rules: one chunk up to 64 MB, else 10 MB chunks with the remainder folded into the last one
  // (count = floor(size / chunk), so the last chunk runs to the end of the file).
  const size = file.bytes.byteLength;
  if (size === 0) return { ok: false, error: 'La vidéo est vide.' };
  const chunk = size <= 64_000_000 ? size : 10_000_000;
  const count = Math.max(1, Math.floor(size / chunk));
  const init = await call<{ publish_id: string; upload_url: string }>('video/init/', token, {
    post_info: { title: caption.slice(0, 2200), privacy_level: level, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count },
  });
  if (!init.ok) return { ok: false, error: init.error };
  for (let i = 0; i < count; i++) {
    const start = i * chunk, end = i === count - 1 ? size : start + chunk;
    try {
      const put = await fetch(init.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type.startsWith('video/') ? file.type : 'video/mp4', 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
        body: file.bytes.slice(start, end), signal: AbortSignal.timeout(60_000),
      });
      if (!put.ok) return { ok: false, error: `TikTok a refusé l’envoi de la vidéo (HTTP ${put.status}).` };
    } catch {
      return { ok: false, error: 'L’envoi de la vidéo à TikTok a été interrompu.' };
    }
  }
  return { pending: true, containerId: init.data.publish_id };
}

export async function finishTiktok(token: string, publishId: string, username?: string): Promise<Outcome> {
  const status = await call<{ status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>('status/fetch/', token, { publish_id: publishId });
  if (!status.ok) return { ok: false, error: status.error };
  if (status.data.status === 'FAILED') return { ok: false, error: `TikTok a refusé la publication${status.data.fail_reason ? ` (${status.data.fail_reason})` : ''}.` };
  if (status.data.status !== 'PUBLISH_COMPLETE') return { pending: true, containerId: publishId };
  const postId = status.data.publicaly_available_post_id?.[0];
  return { ok: true, externalId: String(postId ?? publishId), ...(postId && username ? { url: `https://www.tiktok.com/@${username}/video/${postId}` } : {}) };
}
