// Photos and videos picked in the client's Drive folder from the post composer (« Parcourir Drive »).
// Each file must sit inside that client's folder and be a photo or a video. Meta and TikTok fetch the
// media themselves and have no Google login, so the file is shared as « Tous les utilisateurs
// disposant du lien » — what a pasted link already requires — and answered in the same shape as a
// pasted link (lib/drive.ts), so the rest of publishing doesn't change.
import { z } from 'zod';
import { driveAccess, driveFailure, driveJson } from '@/lib/drive-access';
import { driveIdSchema } from '@/lib/client-folders';
import { DriveError } from '@/lib/drive-store';
import { clientDrive } from '@/lib/drive-files';
import { driveRequest, insideClientRoot } from '@/lib/drive-google';
import { driveDownloadUrl, driveThumbnailUrl, type DriveFile } from '@/lib/drive';

export const dynamic = 'force-dynamic';

const schema = z.object({ clientId: z.string().min(1).max(200), fileIds: z.array(driveIdSchema).min(1).max(35) }).strict();

export async function POST(req: Request) {
  try {
    const a = await driveAccess(req);
    const body = schema.safeParse(await req.json());
    if (!body.success) throw new DriveError('Sélection invalide.');
    const { root } = await clientDrive(a.workspaceId, body.data.clientId);
    const files: DriveFile[] = [];
    for (const id of [...new Set(body.data.fileIds)]) {
      const file = await insideClientRoot(a.workspaceId, root.id, id);
      const type = file.mimeType.startsWith('image/') ? 'image' : file.mimeType.startsWith('video/') ? 'video' : null;
      if (!type) throw new DriveError(`« ${file.name} » n’est ni une photo ni une vidéo.`);
      try {
        // Asking twice is harmless: Drive keeps a single « anyone with the link » permission.
        await driveRequest(a.workspaceId, `files/${file.id}/permissions?supportsAllDrives=true&fields=id`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });
      } catch (e) {
        if (e instanceof DriveError && e.status === 403) throw new DriveError(`Drive refuse de partager « ${file.name} » par lien (règle du Drive partagé ou de l’organisation). Partagez-le à la main ou importez-le depuis le PC.`, 403, 'share-denied');
        throw e;
      }
      files.push({ url: driveDownloadUrl(file.id), thumb: driveThumbnailUrl(file.id), type, mime: file.mimeType, name: file.name, ...(file.size ? { size: Number(file.size) } : {}) });
    }
    return driveJson({ files });
  } catch (e) { return driveFailure(e); }
}
