// Deleting records with everything that hangs off them: comments, notices, voice notes and files, a
// client's projects, tasks, calendar, requests and meetings, and stored post media.
import { removeMedia } from '@/lib/media-storage';
import { mediaOf } from '@/lib/social';
import { removeClientAccounts } from '@/lib/social-accounts';
import { canManageMembers, canSocial } from '@/lib/workspace';
import type { ActionStep } from '../context';
import { response } from '../http';
import { dropCommentAssets } from '../store';

/** Several tasks deleted at once (the task table's selection), with their comments, notices and files. */
export const deleteManyTasks: ActionStep = {
  actions: ['delete-many'],
  when: ({ body }) => body.kind === 'task',
  async run({ body, workspace, rows, db, result }) {
    if (!canManageMembers(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent supprimer.' }, 403);
    const wanted = Array.isArray(body.items) ? (body.items as { id?: unknown; revision?: unknown }[]).slice(0, 500) : [];
    if (!wanted.length) return response({ error: 'Sélectionnez au moins une tâche.' }, 400);
    const targets = wanted.map((w) => ({ w, record: rows.find((r) => r.kind === 'task' && r.id === w?.id) }));
    if (targets.some((x) => !x.record)) return response({ error: 'Une des tâches est introuvable. Actualisez avant de réessayer.' }, 404);
    if (targets.some((x) => x.record!.revision !== x.w.revision)) return response({ error: 'Une des tâches a changé. Actualisez avant de réessayer.' }, 409);
    const ids = targets.map((x) => x.record!.id);
    const done = await db.transaction(async (tx) => {
      for (const { record } of targets) {
        const deleted = await tx.query('DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id', [workspace.id, record!.id, record!.revision]);
        if (!deleted.length) throw new Error('changed');
      }
      await dropCommentAssets(tx, workspace.id, ids);
      await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind IN ('comment', 'event') AND data->>'taskId' = ANY($2::text[])", [workspace.id, ids]);
      return true;
    }).catch((e) => { if ((e as Error).message === 'changed') return false; throw e; });
    if (!done) return response({ error: 'Une des tâches a changé. Actualisez avant de réessayer.' }, 409);
    return result();
  },
};

/** Any other kind: the owner and admins (a social manager for a post); a client by the owner only. */
export const deleteRecord: ActionStep = {
  actions: ['delete'],
  async run({ body, workspace, rows, db, result }) {
    const socialDelete = body.kind === 'editorial_post' && canSocial(workspace.role);
    if (!canManageMembers(workspace.role) && !socialDelete) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent supprimer.' }, 403);
    if (body.kind === 'client' && workspace.role !== 'owner') return response({ error: 'Seul le propriétaire peut supprimer un client.' }, 403);
    const record = rows.find((r) => r.id === body.id && r.kind === body.kind);
    if (!record) return response({ error: 'Élément introuvable.' }, 404);
    if (body.revision !== record.revision) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
    // Media files of the posts going away (the post itself, or a deleted client's whole calendar).
    const mediaGone = rows
      .filter((r) => r.kind === 'editorial_post' && (r.id === record.id || (body.kind === 'client' && r.clientId === record.id)))
      .flatMap((r) => mediaOf(r).map((m) => m.path).filter((p): p is string => !!p));
    const deleted = await db.transaction(async (tx) => {
      const gone = await tx.query('DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id', [workspace.id, record.id, record.revision]);
      if (!gone.length) return false;
      // Voice messages and files on the comments going away are dropped with them.
      const dropVoice = async (taskIds: string[]) => {
        if (!taskIds.length) return;
        await dropCommentAssets(tx, workspace.id, taskIds);
      };
      if (body.kind === 'editorial_post') {
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'postId' = $2", [workspace.id, record.id]);
      } else if (body.kind === 'meeting') {
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'meetingId' = $2", [workspace.id, record.id]);
      } else if (body.kind === 'task') {
        await dropVoice([record.id]);
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind IN ('comment', 'event') AND data->>'taskId' = $2", [workspace.id, record.id]);
      } else if (body.kind === 'client') {
        const taskIds = rows.filter((r) => r.kind === 'task' && r.clientId === record.id).map((r) => r.id);
        await dropVoice(taskIds);
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'project' AND data->>'clientId' = $2", [workspace.id, record.id]);
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'task' AND data->>'clientId' = $2", [workspace.id, record.id]);
        // The posting calendar belongs to the client too: left behind, its posts keep showing on
        // the studio-wide calendar under a client that no longer exists.
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'editorial_post' AND data->>'clientId' = $2", [workspace.id, record.id]);
        // Its requests (and their notices), its meetings and theirs.
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'requestId' IN (SELECT id FROM records WHERE workspace_id = $1 AND kind = 'request' AND data->>'clientId' = $2)", [workspace.id, record.id]);
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'request' AND data->>'clientId' = $2", [workspace.id, record.id]);
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'meetingId' IN (SELECT id FROM records WHERE workspace_id = $1 AND kind = 'meeting' AND data->>'clientId' = $2)", [workspace.id, record.id]);
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'meeting' AND data->>'clientId' = $2", [workspace.id, record.id]);
        if (taskIds.length) await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind IN ('comment', 'event') AND data->>'taskId' = ANY($2::text[])", [workspace.id, taskIds]);
        // The logo and banner uploaded for this client (devis/factures are kept on purpose).
        const images = [record.logo, record.banner].filter(Boolean) as string[];
        if (images.length) await tx.query("DELETE FROM assets WHERE workspace_id = $1 AND id = ANY($2::text[])", [workspace.id, images]);
      }
      return true;
    });
    if (!deleted) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
    await removeMedia(mediaGone);
    // A deleted client's connected accounts go with it: nothing may post in its name any more.
    if (body.kind === 'client') await removeClientAccounts(workspace.id, record.id);
    return result();
  },
};
