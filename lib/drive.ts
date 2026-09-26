// Google Drive as a media source for social posts: the studio pastes the link of a file already in
// Drive, and Meta fetches the file itself when the post goes out. That works only when the file is
// shared as « Tous les utilisateurs disposant du lien » (Meta has no Google login), and only through
// Drive's direct download address, never the viewer page a share link opens.

/** The file id in any of Drive's link shapes (…/file/d/<id>/view, open?id=, uc?id=, …/d/<id>). */
export function driveFileId(link: string): string | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (!/(^|\.)(drive|docs)\.google\.com$|^drive\.usercontent\.google\.com$/.test(url.hostname)) return null;
  const fromPath = url.pathname.match(/\/d\/([\w-]{20,})/)?.[1];
  const fromQuery = url.searchParams.get('id');
  const id = fromPath || fromQuery || '';
  return /^[\w-]{20,}$/.test(id) ? id : null;
}

export const isDriveFolder = (link: string) => /\/drive\/(u\/\d+\/)?folders\//.test(link);

/** The file itself — `confirm=t` skips the "too large to scan for viruses" page of big videos. */
export const driveDownloadUrl = (id: string) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
/** A small preview image Drive renders for photos and videos alike. */
export const driveThumbnailUrl = (id: string) => `https://drive.google.com/thumbnail?id=${id}&sz=w600`;

export type DriveFile = { url: string; thumb: string; type: 'image' | 'video'; mime: string; name: string; size?: number };

/**
 * Checks the file is public and is a photo or a video, reading only the answer's headers. A private
 * file (or a Google Docs/Sheets document) comes back as an HTML page, never as media.
 */
export async function inspectDriveFile(link: string, fetcher: typeof fetch = fetch): Promise<DriveFile | { error: string }> {
  if (isDriveFolder(link)) return { error: 'C’est un dossier : ouvrez le fichier dans Drive et copiez son lien à lui.' };
  const id = driveFileId(link);
  if (!id) return { error: 'Collez le lien d’un fichier Google Drive (Partager → Copier le lien).' };
  const url = driveDownloadUrl(id);
  let response: Response;
  try {
    response = await fetcher(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  } catch {
    return { error: 'Google Drive ne répond pas. Réessayez.' };
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const disposition = response.headers.get('content-disposition') || '';
  const size = Number(response.headers.get('content-length')) || undefined;
  await response.body?.cancel().catch(() => {});
  if (!response.ok || mime.startsWith('text/html')) {
    return { error: 'Ce fichier n’est pas public : dans Drive, Partager → Accès général → « Tous les utilisateurs disposant du lien ».' };
  }
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : null;
  if (!type) return { error: 'Ce fichier n’est ni une photo ni une vidéo.' };
  const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'Google Drive');
  return { url, thumb: driveThumbnailUrl(id), type, mime, name, size };
}
