// Publishing a video to YouTube with the channel connected by « Connecter »: a resumable upload of
// the file, then the video is live (Shorts are recognised by YouTube from the vertical format).
import type { Outcome } from '@/lib/meta-publish';
import { mediaBytes } from '@/lib/media-fetch';

export async function publishToYoutube(token: string, format: string, videoUrl: string, title: string, description: string): Promise<Outcome> {
  const file = await mediaBytes(videoUrl);
  if ('error' in file) return { ok: false, error: file.error };
  const text = format === 'short' && !/#shorts/i.test(`${title} ${description}`) ? `${description}\n\n#Shorts`.trim() : description;
  try {
    const session = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(file.bytes.byteLength), 'X-Upload-Content-Type': file.type.startsWith('video/') ? file.type : 'video/mp4',
      },
      body: JSON.stringify({ snippet: { title: title.slice(0, 100), description: text.slice(0, 5000), categoryId: '22' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }),
      signal: AbortSignal.timeout(20_000),
    });
    const location = session.headers.get('location');
    if (!session.ok || !location) {
      const reason = ((await session.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
      return { ok: false, error: `YouTube : ${reason || `HTTP ${session.status}`}` };
    }
    const upload = await fetch(location, {
      method: 'PUT', headers: { 'Content-Type': file.type.startsWith('video/') ? file.type : 'video/mp4' },
      body: file.bytes, signal: AbortSignal.timeout(120_000),
    });
    const video = (await upload.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!upload.ok || !video.id) return { ok: false, error: `YouTube : ${video.error?.message || `HTTP ${upload.status}`}` };
    return { ok: true, externalId: video.id, url: format === 'short' ? `https://youtube.com/shorts/${video.id}` : `https://youtu.be/${video.id}` };
  } catch (error) {
    return { ok: false, error: (error as Error).name === 'TimeoutError' ? 'YouTube a mis trop de temps à recevoir la vidéo.' : 'YouTube est injoignable.' };
  }
}
