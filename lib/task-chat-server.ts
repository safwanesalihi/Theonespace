import { database } from '@/lib/database';
import type { RecordItem } from '@/lib/model';

/** Only a conversation and its visibility context. No workspace sweep, documents or media payload. */
export async function loadTaskThread(workspaceId: string, taskId: string, clientId?: string | null): Promise<RecordItem[]> {
  const rows = await database().query<{ id: string; kind: RecordItem['kind']; data: RecordItem | string; revision: number }>(
    `WITH task AS (
       SELECT data FROM records WHERE workspace_id = $1 AND id = $2 AND kind IN ('task', 'plan_item')
     )
     SELECT id, kind, data, revision FROM records WHERE workspace_id = $1 AND (
       id = $2 OR id = $3 OR id IN (SELECT data->>'clientId' FROM task UNION SELECT data->>'projectId' FROM task)
       OR (kind = 'comment' AND data->>'taskId' = $2)
     )`, [workspaceId, taskId, clientId ?? null],
  );
  const records = rows.map(row => ({ ...(typeof row.data === 'string' ? JSON.parse(row.data) : row.data), id: row.id, kind: row.kind, revision: row.revision } as RecordItem));
  const task = records.find(r => r.id === taskId && (r.kind === 'task' || r.kind === 'plan_item'));
  // Match the full workspace loader's legacy assignment rule, including ambiguous/departed names.
  if (task?.assignee?.trim() && !task.assigneeId) {
    const roster = await database().query<{ userId: string; name: string | null; email: string | null }>(
      `SELECT user_id AS "userId", name, email FROM workspace_members WHERE workspace_id = $1 AND role <> 'client'`, [workspaceId],
    );
    const name = task.assignee.trim().toLowerCase();
    const matches = roster.filter(m => [m.name, m.email].some(v => v?.trim().toLowerCase() === name));
    task.assigneeId = matches.length === 1 ? matches[0].userId : 'legacy:' + name;
  }
  return records;
}
