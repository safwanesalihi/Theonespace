import type { Db } from '@/lib/database';
import type { RecordItem } from '@/lib/model';

/** Join and end serialize on the same row, so an in-flight join cannot reopen a finished room.
 * Call only inside a transaction; hold the lock until the provider operation has finished. */
export async function lockedMeeting(tx: Db, workspaceId: string, id: unknown): Promise<RecordItem | null> {
  if (typeof id !== 'string') return null;
  const row = (await tx.query<{ id: string; data: unknown; revision: number }>(
    "SELECT id, data, revision FROM records WHERE workspace_id = $1 AND id = $2 AND kind = 'meeting' FOR UPDATE",
    [workspaceId, id],
  ))[0];
  if (!row) return null;
  const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as RecordItem;
  return { ...data, id: row.id, kind: 'meeting', revision: row.revision };
}
