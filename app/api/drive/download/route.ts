import { driveAccess, driveFailure } from '@/lib/drive-access';
import { clientDrive } from '@/lib/drive-files';
import { driveRequest, insideClientRoot } from '@/lib/drive-google';
import { DriveError } from '@/lib/drive-store';
import { folderMime } from '@/lib/client-folders';

export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams; const a = await driveAccess(req, q.get('workspaceId'));
    const { root } = await clientDrive(a.workspaceId, q.get('clientId') ?? '');
    const file = await insideClientRoot(a.workspaceId, root.id, q.get('fileId') ?? '');
    if (file.mimeType === folderMime || !file.capabilities?.canDownload) throw new DriveError('Ce fichier ne peut pas être téléchargé.', 403);
    const exports: Record<string, { type: string; ext: string }> = { 'application/vnd.google-apps.document': { type: 'application/pdf', ext: '.pdf' }, 'application/vnd.google-apps.spreadsheet': { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' }, 'application/vnd.google-apps.presentation': { type: 'application/pdf', ext: '.pdf' } };
    const exportType = exports[file.mimeType];
    if (file.mimeType.startsWith('application/vnd.google-apps.') && !exportType) throw new DriveError('Ouvrez ce document dans Google Drive pour le télécharger.');
    const r = await driveRequest(a.workspaceId, exportType ? `files/${file.id}/export?mimeType=${encodeURIComponent(exportType.type)}` : `files/${file.id}?alt=media&supportsAllDrives=true`, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(280_000)]) });
    const name = file.name + (exportType?.ext ?? '');
    return new Response(r.body, { headers: { 'Content-Type': exportType?.type ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (e) { return driveFailure(e); }
}
