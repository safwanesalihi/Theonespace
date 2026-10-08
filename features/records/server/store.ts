// The few SQL shapes the record actions repeat. Each keeps the statement it replaced, word for word.
import { database, type Db } from '@/lib/database';

type Queryable = Pick<Db, 'query'>;

/** The first row of a query, or null. */
export async function one<T>(text: string, params: unknown[] = []) {
  return (await database().query<T>(text, params))[0] ?? null;
}

/**
 * Optimistic write: replaces a record's data only while its revision is still the one that was read.
 * False when someone changed it meanwhile (the caller answers 409).
 */
export async function updateAtRevision(db: Queryable, workspaceId: string, id: string, revision: unknown, data: unknown) {
  const changed = await db.query(
    'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
    [JSON.stringify(data), id, workspaceId, revision],
  );
  return changed.length > 0;
}

/** Deletes one record, only at the revision the person saw. False when it changed meanwhile. */
export async function deleteAtRevision(db: Queryable, workspaceId: string, id: string, revision: unknown) {
  const deleted = await db.query('DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id', [workspaceId, id, revision]);
  return deleted.length > 0;
}

/** Creates or replaces a workspace 'meta' row (settings kept outside the records payload). */
export async function upsertMeta(db: Queryable, id: string, owner: string, workspaceId: string, data: unknown) {
  await db.query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
    [id, owner, workspaceId, JSON.stringify(data)],
  );
}

/**
 * Atomic 60-second lease on a 'meta' row: double-clicks and concurrent requests get it at most once a
 * minute. True when this request holds it.
 */
export async function claimLease(db: Queryable, id: string, owner: string, workspaceId: string) {
  const claimed = await db.query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision)
         VALUES ($1, $2, $3, 'meta', jsonb_build_object('retryAfter', now() + interval '60 seconds'), 1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1
         WHERE records.workspace_id = EXCLUDED.workspace_id AND (records.data->>'retryAfter')::timestamptz <= now() RETURNING id`,
    [id, owner, workspaceId],
  );
  return claimed.length > 0;
}

/** Drops the voice messages and files sent in the comments of these tasks (the comments go separately). */
export async function dropCommentAssets(tx: Queryable, workspaceId: string, taskIds: string[]) {
  await tx.query(
    `DELETE FROM assets WHERE workspace_id = $1 AND kind = 'audio' AND id IN (
       SELECT data->>'audio' FROM records WHERE workspace_id = $1 AND kind = 'comment' AND data->>'taskId' = ANY($2::text[]) AND data ? 'audio')`,
    [workspaceId, taskIds],
  );
  await tx.query(
    `DELETE FROM assets WHERE workspace_id = $1 AND kind = 'file' AND id IN (
       SELECT f->>'id' FROM records c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.data->'attachments') = 'array' THEN c.data->'attachments' ELSE '[]'::jsonb END) f
       WHERE c.workspace_id = $1 AND c.kind = 'comment' AND c.data->>'taskId' = ANY($2::text[]))`,
    [workspaceId, taskIds],
  );
}
