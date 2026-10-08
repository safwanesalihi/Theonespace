// Google Drive as a media source for social posts: the studio pastes the link of a file already in
// Drive — or of a folder, for all its photos and videos — and Meta fetches each file itself when the
// post goes out. That works only when the file is
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
/** A folder link's id (…/drive/folders/<id>, …/drive/u/0/folders/<id>). */
export const driveFolderId = (link: string) => (isDriveFolder(link) ? link.match(/\/folders\/([\w-]{20,})/)?.[1] ?? null : null);

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

/** At most this many files are read from one folder (a post holds 35 media at most). */
export const folderLimit = 35;

/**
 * The photos and videos of a public folder, sorted by name (« 1 », « 2 »… « 10 » in that order),
 * each checked like a pasted file. Drive's embedded view of the folder lists its files without
 * any Google login — the same page a website embeds — so it only works for a folder shared as
 * « Tous les utilisateurs disposant du lien ». Sub-folders and documents are left out.
 */
export async function inspectDriveFolder(link: string, fetcher: typeof fetch = fetch): Promise<{ files: DriveFile[]; skipped: number } | { error: string }> {
  const id = driveFolderId(link);
  if (!id) return { error: 'Collez le lien d’un dossier Google Drive (Partager → Copier le lien).' };
  const page = new URL('https://drive.google.com/embeddedfolderview');
  page.searchParams.set('id', id);
  const resourceKey = (() => { try { return new URL(link.trim()).searchParams.get('resourcekey'); } catch { return null; } })();
  if (resourceKey && /^[\w-]{1,200}$/.test(resourceKey)) page.searchParams.set('resourcekey', resourceKey);
  let html: string;
  try {
    const response = await fetcher(page, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    html = response.ok ? await response.text() : '';
  } catch {
    return { error: 'Google Drive ne répond pas. Réessayez.' };
  }
  if (!html.includes('flip-entries')) return { error: 'Ce dossier n’est pas public : dans Drive, Partager → Accès général → « Tous les utilisateurs disposant du lien ».' };
  const entries = html.split('class="flip-entry"').slice(1).map((chunk) => ({
    id: chunk.match(/^\s*id="entry-([\w-]{20,})"/)?.[1],
    mime: chunk.match(/\/type\/([\w.+-]+\/[\w.+-]+)"/)?.[1]?.toLowerCase() ?? '',
    name: chunk.match(/class="flip-entry-title">([^<]*)</)?.[1] ?? '',
  })).filter((e): e is { id: string; mime: string; name: string } => !!e.id);
  const media = entries.filter((e) => e.mime.startsWith('image/') || e.mime.startsWith('video/'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (!media.length) return { error: 'Ce dossier ne contient ni photo ni vidéo.' };
  // Each file is checked as if pasted alone (public, really a photo or a video), a few at a time.
  const checked: (DriveFile | null)[] = new Array(Math.min(media.length, folderLimit)).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < checked.length) {
      const i = next++;
      const file = await inspectDriveFile(`https://drive.google.com/file/d/${media[i].id}/view`, fetcher);
      checked[i] = 'error' in file ? null : file;
    }
  }));
  const files = checked.filter((f): f is DriveFile => !!f);
  if (!files.length) return { error: 'Les fichiers de ce dossier ne sont pas publics : partagez le dossier en « Tous les utilisateurs disposant du lien ».' };
  return { files, skipped: media.length - files.length };
}
