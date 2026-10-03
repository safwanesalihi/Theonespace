import { z } from 'zod';
import { driveAccess, driveFailure, driveJson } from '@/lib/drive-access';
import { driveIdSchema, folderNameSchema } from '@/lib/client-folders';
import { DriveError } from '@/lib/drive-store';
import { driveUploadChunk, driveUploadStatus, maxDriveUploadSize, startDriveUpload, uploadChunkSize } from '@/lib/drive-upload';

export const maxDuration = 60;
const idSchema = z.string().uuid();
const schema = z.object({ clientId: z.string().min(1).max(200), parentId: driveIdSchema, name: folderNameSchema, mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/).max(150).refine((v) => !v.startsWith('application/vnd.google-apps.')), size: z.number().int().min(1).max(maxDriveUploadSize), requestId: idSchema, replaceId: driveIdSchema.optional() }).strict();
export async function POST(req: Request) {
  try { const a = await driveAccess(req); const b = schema.safeParse(await req.json()); if (!b.success) throw new DriveError('Fichier invalide : taille maximale 1 Go.'); return driveJson(await startDriveUpload(a.workspaceId, a.user.userId, b.data)); } catch (e) { return driveFailure(e); }
}
export async function GET(req: Request) {
  try { const a = await driveAccess(req); const uploadId = idSchema.parse(new URL(req.url).searchParams.get('uploadId')); return driveJson(await driveUploadStatus(a.workspaceId, a.user.userId, uploadId)); } catch (e) { return driveFailure(e); }
}
export async function PUT(req: Request) {
  try {
    const a = await driveAccess(req); const q = new URL(req.url).searchParams;
    const id = idSchema.safeParse(q.get('uploadId')); const offset = Number(q.get('offset'));
    if (!id.success || q.get('offset') === null || !Number.isSafeInteger(offset)) throw new DriveError('Transfert invalide.');
    const declared = req.headers.get('content-length'); if (declared && Number(declared) > uploadChunkSize) throw new DriveError('Bloc de transfert trop volumineux.', 413);
    if (!req.body) throw new DriveError('Fichier vide.');
    const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > uploadChunkSize) { await reader.cancel(); throw new DriveError('Bloc de transfert trop volumineux.', 413); } chunks.push(value); }
    const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return driveJson(await driveUploadChunk(a.workspaceId, a.user.userId, id.data, offset, bytes.buffer));
  } catch (e) { return driveFailure(e); }
}
