import { randomUUID } from 'node:crypto';
import { folderMime, rootFolderId, type DriveFile } from '@/lib/client-folders';
import { connection, DriveError, readMeta, readPlan, writeMeta } from '@/lib/drive-store';
import { createFolder, generateIds, getDriveFile, insideClientRoot, updateDriveFile } from '@/lib/drive-google';
import { driveClient } from '@/lib/drive-access';

export async function clientDrive(w: string, clientId: string, writing = false) {
  await driveClient(w, clientId, writing);
  const plan = await readPlan(w, clientId); const c = await connection(w); const rootId = rootFolderId(plan);
  if (!plan?.binding || !rootId || !c) throw new DriveError('Créez d’abord le dossier client dans Drive.', 409, 'not-created');
  if (plan.binding.accountId !== c.account.id) throw new DriveError('Reconnectez le compte Google d’origine pour accéder aux fichiers de ce client.', 409, 'binding-mismatch');
  const root = await getDriveFile(w, rootId);
  if (root.trashed) throw new DriveError('Le dossier principal est dans la corbeille Drive. Restaurez-le depuis Google Drive.', 409, 'trashed');
  if (root.mimeType !== folderMime || root.appProperties?.trackerWorkspace !== w || root.appProperties?.trackerClient !== clientId) throw new DriveError('Le dossier principal n’appartient pas à ce client.', 403);
  return { plan, c, root };
}
export async function newClientFolder(w: string, clientId: string, parentId: string, name: string, requestId: string = randomUUID()) {
  const { root } = await clientDrive(w, clientId, true);
  const parent = await insideClientRoot(w, root.id, parentId);
  if (parent.mimeType !== folderMime || !parent.capabilities?.canAddChildren) throw new DriveError('Vous ne pouvez pas créer un dossier à cet emplacement.', 403);
  const key = `drive-op:${w}:${clientId}:${requestId}`;
  let row = await readMeta<{ fileId: string; parentId: string; name: string }>(w, key);
  if (!row) {
    const data = { fileId: (await generateIds(w, 1))[0], parentId, name };
    try { await writeMeta(w, key, data, 0); row = { data, revision: 1 }; }
    catch (e) { if (!(e instanceof DriveError && e.code === 'conflict')) throw e; row = await readMeta(w, key); }
  }
  if (!row || row.data.name !== name || row.data.parentId !== parentId) throw new DriveError('Cette opération correspond à un autre dossier.', 409);
  return createFolder(w, row.data.fileId, parentId, name, { trackerWorkspace: w, trackerClient: clientId, trackerOperation: requestId });
}
export async function changeClientFile(w: string, clientId: string, fileId: string, change: { action: 'rename' | 'move' | 'trash' | 'restore'; name?: string; parentId?: string }): Promise<DriveFile> {
  const { root } = await clientDrive(w, clientId, true);
  const file = await insideClientRoot(w, root.id, fileId, change.action === 'restore');
  if (file.id === root.id && change.action !== 'rename') throw new DriveError('Le dossier principal doit rester lié au client.', 409);
  if (change.action === 'rename') {
    if (!file.capabilities?.canEdit) throw new DriveError('Vous ne pouvez pas renommer ce fichier.', 403);
    return updateDriveFile(w, file.id, { name: change.name });
  }
  if (change.action === 'trash' || change.action === 'restore') {
    if (change.action === 'trash' ? !file.capabilities?.canTrash : !file.capabilities?.canUntrash) throw new DriveError('Google Drive ne permet pas cette action pour ce fichier.', 403);
    return updateDriveFile(w, file.id, { trashed: change.action === 'trash' });
  }
  const target = await insideClientRoot(w, root.id, change.parentId!);
  if (!file.capabilities?.canEdit || !target.capabilities?.canAddChildren || target.mimeType !== folderMime) throw new DriveError('Déplacement non autorisé.', 403);
  let ancestor = target;
  while (true) {
    if (ancestor.id === file.id) throw new DriveError('Un dossier ne peut pas être déplacé dans lui-même ou dans un de ses enfants.');
    if (ancestor.id === root.id) break;
    if (!ancestor.parents?.[0]) throw new DriveError('Dossier parent introuvable.', 409);
    ancestor = await getDriveFile(w, ancestor.parents[0]);
  }
  if (file.parents?.includes(target.id)) return file;
  return updateDriveFile(w, file.id, {}, { addParents: target.id, removeParents: file.parents?.join(',') ?? '' });
}

/** Explicit owner-confirmed import: move individually selected Google Picker files into this client. */
export async function importDriveFile(w: string, clientId: string, parentId: string, fileId: string) {
  const { root } = await clientDrive(w, clientId, true);
  const target = await insideClientRoot(w, root.id, parentId);
  const file = await getDriveFile(w, fileId);
  if (file.mimeType.startsWith('application/vnd.google-apps.shortcut') || file.mimeType === folderMime || file.trashed || !file.capabilities?.canEdit || !target.capabilities?.canAddChildren || target.mimeType !== folderMime) throw new DriveError('Choisissez un fichier que vous pouvez déplacer.', 403);
  // Never import another app client's file. Parent checks also catch manually uploaded files there.
  let ancestor = file;
  for (let depth = 0; depth < 40; depth++) {
    const props = ancestor.appProperties;
    if (props?.trackerWorkspace && (props.trackerWorkspace !== w || props.trackerClient !== clientId)) throw new DriveError('Ce fichier est déjà lié à un autre client.', 403);
    if (!ancestor.parents?.[0]) break;
    try { ancestor = await getDriveFile(w, ancestor.parents[0]); }
    catch (e) { if (e instanceof DriveError && e.code === 'file-missing') break; throw e; }
  }
  if (file.parents?.includes(target.id)) return file;
  return updateDriveFile(w, file.id, {}, { addParents: target.id, removeParents: file.parents?.join(',') ?? '' });
}
