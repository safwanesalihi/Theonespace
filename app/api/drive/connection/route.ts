import { z } from 'zod';
import { driveAccess, driveFailure, driveJson } from '@/lib/drive-access';
import { connection, connectionKey, connectionView, DriveError, readMeta, removeMeta, writeMeta, type DriveConnection } from '@/lib/drive-store';
import { driveToken, getDriveFile } from '@/lib/drive-google';
import { driveIdSchema, folderMime } from '@/lib/client-folders';
import { env } from '@/lib/env';

export async function GET(req: Request) {
  try { const a = await driveAccess(req); return driveJson(connectionView(await connection(a.workspaceId))); } catch (e) { return driveFailure(e); }
}
const bodySchema = z.discriminatedUnion('action', [z.object({ action: z.literal('disconnect') }).strict(), z.object({ action: z.literal('picker') }).strict(), z.object({ action: z.literal('root'), id: driveIdSchema }).strict()]);
export async function POST(req: Request) {
  try {
    const a = await driveAccess(req, undefined, true);
    const parsed = bodySchema.safeParse(await req.json()); if (!parsed.success) throw new DriveError('Action Drive invalide.');
    const b = parsed.data;
    if (b.action === 'disconnect') { await removeMeta(a.workspaceId, connectionKey(a.workspaceId)); return driveJson(connectionView(null)); }
    if (b.action === 'picker') {
      if (!env.GOOGLE_DRIVE_PICKER_KEY || !env.GOOGLE_DRIVE_PROJECT_NUMBER) throw new DriveError('Configurez GOOGLE_DRIVE_PICKER_KEY et GOOGLE_DRIVE_PROJECT_NUMBER sur le serveur.', 503, 'picker-not-configured');
      // Only the owner receives a short-lived, drive.file-scoped token to authorize Google's picker.
      return driveJson({ accessToken: await driveToken(a.workspaceId), key: env.GOOGLE_DRIVE_PICKER_KEY, projectNumber: env.GOOGLE_DRIVE_PROJECT_NUMBER });
    }
    const row = await readMeta<DriveConnection>(a.workspaceId, connectionKey(a.workspaceId));
    if (!row) throw new DriveError('Connectez d’abord Google Drive.', 409);
    const file = await getDriveFile(a.workspaceId, b.id);
    if (file.mimeType !== folderMime || file.trashed || !file.capabilities?.canAddChildren) throw new DriveError('Choisissez un dossier Drive dans lequel vous pouvez créer des fichiers.', 403);
    const data = { ...row.data, root: { id: file.id, name: file.name, ...(file.driveId ? { driveId: file.driveId } : {}) } };
    await writeMeta(a.workspaceId, connectionKey(a.workspaceId), data, row.revision);
    return driveJson(connectionView(data));
  } catch (e) { return driveFailure(e); }
}
