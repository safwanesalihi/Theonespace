import { z } from 'zod';
import { driveAccess, driveFailure, driveJson } from '@/lib/drive-access';
import { driveIdSchema, folderMime, folderNameSchema } from '@/lib/client-folders';
import { DriveError } from '@/lib/drive-store';
import { clientDrive, changeClientFile, newClientFolder, importDriveFile } from '@/lib/drive-files';
import { insideClientRoot, listDriveFiles } from '@/lib/drive-google';

export async function GET(req: Request) {
  try {
    const a = await driveAccess(req); const q = new URL(req.url).searchParams;
    const { root } = await clientDrive(a.workspaceId, q.get('clientId') ?? '');
    const folder = await insideClientRoot(a.workspaceId, root.id, q.get('folderId') || root.id);
    if (folder.mimeType !== folderMime) throw new DriveError('Choisissez un dossier.');
    const result = await listDriveFiles(a.workspaceId, folder, q.get('pageToken') ?? undefined, q.get('trash') === '1');
    // Return only display fields. App properties are identifiers, not a browser API.
    const { appProperties: _props, ...displayFolder } = folder; void _props;
    return driveJson({ ...result, folder: displayFolder, root: { id: root.id, name: root.name }, refreshedAt: new Date().toISOString() });
  } catch (e) { return driveFailure(e); }
}
const common = { clientId: z.string().min(1).max(200) };
const schema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('folder'), parentId: driveIdSchema, name: folderNameSchema, requestId: z.string().uuid() }).strict(),
  z.object({ ...common, action: z.literal('rename'), fileId: driveIdSchema, name: folderNameSchema }).strict(),
  z.object({ ...common, action: z.literal('move'), fileId: driveIdSchema, parentId: driveIdSchema }).strict(),
  z.object({ ...common, action: z.literal('trash'), fileId: driveIdSchema }).strict(),
  z.object({ ...common, action: z.literal('restore'), fileId: driveIdSchema }).strict(),
  z.object({ ...common, action: z.literal('import'), fileId: driveIdSchema, parentId: driveIdSchema }).strict(),
]);
export async function POST(req: Request) {
  try {
    const a = await driveAccess(req); const b = schema.safeParse(await req.json());
    if (!b.success) throw new DriveError(b.error.issues[0]?.message || 'Action invalide.');
    const data = b.data;
    if (data.action === 'import' && a.role !== 'owner') throw new DriveError('Seul le propriétaire peut importer des fichiers depuis Drive.', 403);
    const file = data.action === 'folder' ? await newClientFolder(a.workspaceId, data.clientId, data.parentId, data.name, data.requestId) : data.action === 'import' ? await importDriveFile(a.workspaceId, data.clientId, data.parentId, data.fileId) : await changeClientFile(a.workspaceId, data.clientId, data.fileId, data);
    return driveJson({ file });
  } catch (e) { return driveFailure(e); }
}
