import { seal, open } from '@/lib/secret-box';
import { connection, DriveError, readMeta, writeMeta } from '@/lib/drive-store';
import { driveToken, generateIds, googleFailure, insideClientRoot } from '@/lib/drive-google';
import { clientDrive } from '@/lib/drive-files';
import { folderMime, type DriveFile } from '@/lib/client-folders';
import { database } from '@/lib/database';

export const uploadChunkSize = 4 * 1024 * 1024; // under Vercel's request limit; multiple of 256 KiB
export const maxDriveUploadSize = 1024 * 1024 * 1024;
export type UploadInput = { clientId: string; parentId: string; name: string; mimeType: string; size: number; requestId: string; replaceId?: string };
type UploadJob = UploadInput & { userId: string; accountId: string; fileId: string; rootId: string; expires: number; session?: string; file?: DriveFile };
const jobKey = (w: string, id: string) => `drive-upload:${w}:${id}`;
function sessionUrl(job: UploadJob) {
  const url = new URL(open(job.session!));
  if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || !url.pathname.startsWith('/upload/drive/v3/files') || !url.searchParams.get('upload_id')) throw new DriveError('Session de transfert invalide.', 409);
  return url.toString();
}
export async function startDriveUpload(w: string, userId: string, b: UploadInput) {
  const { root, c } = await clientDrive(w, b.clientId, true);
  const parent = await insideClientRoot(w, root.id, b.parentId);
  if (parent.mimeType !== folderMime || !parent.capabilities?.canAddChildren) throw new DriveError('Transfert non autorisé dans ce dossier.', 403);
  if (b.replaceId) {
    const file = await insideClientRoot(w, root.id, b.replaceId);
    if (!file.capabilities?.canEdit || file.mimeType.startsWith('application/vnd.google-apps.')) throw new DriveError('Ce document ne peut pas être remplacé.', 403);
    if (!file.parents?.includes(b.parentId)) throw new DriveError('Le fichier a changé d’emplacement. Actualisez.', 409);
  }
  await database().query("DELETE FROM records WHERE workspace_id=$1 AND kind='meta' AND id LIKE 'drive-upload:%' AND (data->>'expires')::bigint < $2", [w, Date.now()]);
  let row = await readMeta<UploadJob>(w, jobKey(w, b.requestId));
  if (!row) {
    const job: UploadJob = { ...b, userId, accountId: c.account.id, fileId: b.replaceId || (await generateIds(w, 1))[0], rootId: root.id, expires: Date.now() + 24 * 60 * 60_000 };
    try { await writeMeta(w, jobKey(w, b.requestId), job, 0); row = { data: job, revision: 1 }; }
    catch (e) { if (!(e instanceof DriveError && e.code === 'conflict')) throw e; row = await readMeta(w, jobKey(w, b.requestId)); }
  }
  if (!row || row.data.userId !== userId || row.data.accountId !== c.account.id || ['clientId', 'parentId', 'name', 'mimeType', 'size', 'replaceId'].some((key) => row!.data[key as keyof UploadInput] !== b[key as keyof UploadInput])) throw new DriveError('Ce transfert correspond à un autre fichier.', 409);
  if (!row.data.session && !row.data.file) {
    const token = await driveToken(w);
    const path = b.replaceId ? `/${b.replaceId}` : '';
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files${path}?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,parents,size,modifiedTime,capabilities,webViewLink`, { method: b.replaceId ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': b.mimeType, 'X-Upload-Content-Length': String(b.size) }, body: JSON.stringify(b.replaceId ? { name: b.name, mimeType: b.mimeType } : { id: row.data.fileId, name: b.name, mimeType: b.mimeType, parents: [b.parentId], appProperties: { trackerWorkspace: w, trackerClient: b.clientId } }), signal: AbortSignal.timeout(20_000) });
    if (!r.ok) await googleFailure(r);
    const location = r.headers.get('location'); if (!location) throw new DriveError('Google Drive n’a pas ouvert le transfert.', 503);
    const job = { ...row.data, session: seal(location) }; sessionUrl(job);
    await writeMeta(w, jobKey(w, b.requestId), job, row.revision);
  }
  return { uploadId: b.requestId, chunkSize: uploadChunkSize, size: b.size };
}
async function uploadJob(w: string, userId: string, uploadId: string) {
  const row = await readMeta<UploadJob>(w, jobKey(w, uploadId));
  if (!row || row.data.userId !== userId || row.data.expires < Date.now()) throw new DriveError('Transfert expiré. Sélectionnez à nouveau le fichier.', 404, 'upload-expired');
  const c = await connection(w); if (c?.account.id !== row.data.accountId) throw new DriveError('Le compte Drive a changé.', 409);
  await clientDrive(w, row.data.clientId, true);
  await insideClientRoot(w, row.data.rootId, row.data.parentId);
  if (row.data.replaceId) await insideClientRoot(w, row.data.rootId, row.data.replaceId);
  if (!row.data.session && !row.data.file) throw new DriveError('Transfert non initialisé. Réessayez.', 409);
  return row;
}
async function interpretUpload(w: string, uploadId: string, row: { data: UploadJob; revision: number }, r: Response): Promise<{ done: boolean; offset: number; file?: DriveFile }> {
  if (r.status === 308) {
    const range = r.headers.get('range'); const match = range?.match(/^bytes=0-(\d+)$/);
    return { done: false, offset: match ? Number(match[1]) + 1 : 0 };
  }
  if (r.status === 404 || r.status === 410) throw new DriveError('Le transfert Google Drive a expiré. Sélectionnez à nouveau le fichier.', 410, 'upload-expired');
  if (!r.ok) await googleFailure(r);
  const file: DriveFile = await r.json();
  if (file.id !== row.data.fileId) throw new DriveError('Réponse de transfert invalide.', 502);
  try { await writeMeta(w, jobKey(w, uploadId), { ...row.data, file }, row.revision); }
  catch (e) { if (!(e instanceof DriveError && e.code === 'conflict')) throw e; }
  return { done: true, offset: row.data.size, file };
}
export async function driveUploadStatus(w: string, userId: string, uploadId: string) {
  const row = await uploadJob(w, userId, uploadId);
  if (row.data.file) return { done: true, offset: row.data.size, file: row.data.file };
  const r = await fetch(sessionUrl(row.data), { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${row.data.size}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  return interpretUpload(w, uploadId, row, r);
}
export async function driveUploadChunk(w: string, userId: string, uploadId: string, offset: number, bytes: ArrayBuffer) {
  const row = await uploadJob(w, userId, uploadId);
  if (row.data.file) return { done: true, offset: row.data.size, file: row.data.file };
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % (256 * 1024) !== 0 || bytes.byteLength < 1 || bytes.byteLength > uploadChunkSize || offset + bytes.byteLength > row.data.size || (offset + bytes.byteLength < row.data.size && bytes.byteLength % (256 * 1024) !== 0)) throw new DriveError('Bloc de transfert invalide.');
  const r = await fetch(sessionUrl(row.data), { method: 'PUT', headers: { 'Content-Type': row.data.mimeType, 'Content-Length': String(bytes.byteLength), 'Content-Range': `bytes ${offset}-${offset + bytes.byteLength - 1}/${row.data.size}` }, body: bytes, signal: AbortSignal.timeout(25_000), redirect: 'error' });
  return interpretUpload(w, uploadId, row, r);
}
