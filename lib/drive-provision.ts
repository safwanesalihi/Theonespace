import { randomUUID } from 'node:crypto';
import { orderedFolders, rootFolderId, folderMime } from '@/lib/client-folders';
import { connection, DriveError, readPlan, writePlan } from '@/lib/drive-store';
import { createFolder, generateIds, getDriveFile } from '@/lib/drive-google';
import { driveClient } from '@/lib/drive-access';

/** Bounded batches fit serverless requests. A persisted generated id makes every create resumable. */
export async function provisionFolders(w: string, clientId: string, revision: number) {
  await driveClient(w, clientId, true);
  let plan = await readPlan(w, clientId); const c = await connection(w);
  if (!plan || !c?.root) throw new DriveError('Enregistrez le plan et choisissez le dossier agence dans les paramètres.', 409);
  if (plan.binding && (plan.binding.accountId !== c.account.id || plan.binding.parentId !== c.root.id)) throw new DriveError('Ce client est lié à un autre emplacement Drive. Reconnectez le compte et son dossier d’origine.', 409, 'binding-mismatch');
  if (plan.revision !== revision) throw new DriveError('Le plan a changé. Actualisez puis réessayez.', 409, 'conflict');
  if (plan.done.length === plan.blueprint.nodes.length) return plan;
  if (plan.lease && plan.lease.until > Date.now()) throw new DriveError('La création est déjà en cours. Patientez puis actualisez.', 409, 'busy');
  const parent = await getDriveFile(w, c.root.id);
  if (parent.mimeType !== folderMime || parent.trashed || !parent.capabilities?.canAddChildren) throw new DriveError('Le dossier agence ne permet pas la création de fichiers.', 403);
  const lease = { id: randomUUID(), until: Date.now() + 360_000 };
  plan = await writePlan(w, clientId, { ...plan, binding: { accountId: c.account.id, parentId: c.root.id }, lease });
  try {
    const nodes = orderedFolders(plan.blueprint);
    if (!Object.keys(plan.fileIds).length) {
      const ids = await generateIds(w, nodes.length);
      plan = await writePlan(w, clientId, { ...plan, fileIds: Object.fromEntries(nodes.map((n, i) => [n.id, ids[i]])) });
    }
    let created = 0;
    for (const node of nodes) {
      if (plan.done.includes(node.id)) continue;
      const parentId = node.parentId === null ? c.root.id : plan.fileIds[node.parentId];
      if (node.parentId !== null && !plan.done.includes(node.parentId)) throw new DriveError('Le dossier parent n’a pas encore été créé.', 409);
      const current = await connection(w);
      if (current?.account.id !== c.account.id || current?.root?.id !== c.root.id) throw new DriveError('La connexion Drive a changé. Actualisez.', 409);
      // Confirm the existing parent/root remains in the bound hierarchy after edits made in Drive.
      if (node.parentId !== null) {
        const { insideClientRoot } = await import('@/lib/drive-google');
        await insideClientRoot(w, rootFolderId(plan)!, parentId);
      }
      await createFolder(w, plan.fileIds[node.id], parentId, node.name, { trackerWorkspace: w, trackerClient: clientId, trackerNode: node.id });
      plan = await writePlan(w, clientId, { ...plan, done: [...plan.done, node.id] });
      if (++created >= 4) break;
    }
  } finally {
    // Even on a failed Google request, keep the completed ids so Resume never starts from scratch.
    const current = await readPlan(w, clientId);
    if (current?.lease?.id === lease.id) { const { lease: _lease, ...unlocked } = current; void _lease; plan = await writePlan(w, clientId, unlocked); }
  }
  return plan;
}
