// Internal review (« Validation interne »): every deliverable stops in the studio before the client
// sees it. The owner and the administrators send it on (« À valider ») or return it with a note only
// the studio reads (lib/flow.ts submitForReview / rejectInternally). These are the notices around it.
import { database } from '@/lib/database';
import type { RecordItem } from '@/lib/model';

/**
 * Who reviews, never the person who just submitted: the owner and the administrators; for a check reserved
 * to some studio roles (lib/process.ts reviewers), the owner and the people holding one of those roles,
 * the only ones who can pass it (lib/roles.ts passesCheck).
 */
export async function reviewersOf(workspaceId: string, exceptUserId: string, roleIds?: string[]): Promise<string[]> {
  const rows = roleIds?.length
    ? await database().query<{ userId: string }>(
      `SELECT wm.user_id AS "userId" FROM workspace_members wm
       LEFT JOIN records mr ON mr.kind = 'meta' AND mr.workspace_id = wm.workspace_id AND mr.id = 'member-role:' || wm.workspace_id || ':' || wm.user_id
       WHERE wm.workspace_id = $1 AND wm.user_id <> $2 AND (wm.role = 'owner' OR (wm.role <> 'client' AND mr.data->>'roleId' = ANY($3::text[])))`,
      [workspaceId, exceptUserId, roleIds])
    : await database().query<{ userId: string }>(
      "SELECT user_id AS \"userId\" FROM workspace_members WHERE workspace_id = $1 AND role IN ('owner', 'admin') AND user_id <> $2",
      [workspaceId, exceptUserId]);
  return rows.map((r) => r.userId);
}

/** A studio notice to the reviewers that a deliverable waits for them; null when nobody else reviews. */
export function reviewRequestEvent(task: RecordItem, reviewers: string[], actor: string, now: string): RecordItem | null {
  if (!reviewers.length) return null;
  return {
    id: `evt:${task.id}:internal-review:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
    name: `« ${task.name} » attend la validation interne (envoyé par ${actor}).`, taskId: task.id, clientId: task.clientId,
    createdAt: now, recipients: reviewers, readBy: [],
  };
}

/** A studio notice to the assignee that their deliverable came back from internal review. */
export function reviewRefusalEvent(task: RecordItem, actor: string, actorId: string, now: string): RecordItem | null {
  if (!task.assigneeId || task.assigneeId === actorId) return null;
  return {
    id: `evt:${task.id}:internal-refusal:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
    name: `« ${task.name} » revient de la validation interne : ${actor} a laissé une note.`, taskId: task.id, clientId: task.clientId,
    createdAt: now, recipients: [task.assigneeId], readBy: [],
  };
}
