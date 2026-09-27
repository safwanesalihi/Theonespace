// The bytes of a post's photo or video, for the platforms that take an upload rather than fetching a
// public address themselves (TikTok videos, YouTube). Read from wherever the post points: a Google
// Drive direct download or the app's storage — nothing else (lib/media-source.ts).
import { fetchMediaSource } from '@/lib/media-source';

export const uploadLimitBytes = 250_000_000;

export async function mediaBytes(url: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | { error: string }> {
  try {
    const response = await fetchMediaSource(url, { signal: AbortSignal.timeout(45_000) });
    if (!response) return { error: 'Ce média ne vient ni de Google Drive ni du stockage de l’application : ajoutez-le à nouveau depuis le composeur.' };
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || type.startsWith('text/html')) return { error: 'Le fichier n’est plus accessible (lien Drive privé ou supprimé ?).' };
    const size = Number(response.headers.get('content-length')) || 0;
    if (size > uploadLimitBytes) return { error: 'Vidéo trop lourde pour être envoyée (250 Mo au plus).' };
    return { bytes: new Uint8Array(await response.arrayBuffer()), type: type || 'video/mp4' };
  } catch (error) {
    return { error: (error as Error).name === 'TimeoutError' ? 'Le fichier a mis trop de temps à arriver.' : 'Le fichier est injoignable.' };
  }
}
