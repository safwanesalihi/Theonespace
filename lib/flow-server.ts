// Runs The One Flow clocks against Postgres. Pure rules live in lib/flow.ts; this file only reads and writes rows.
import { batch, database, type Statement } from '@/lib/database';
import type { RecordItem } from '@/lib/model';
import { dayIn, leftWorkAt, sweep } from '@/lib/flow';
import { withWorkflowSettings } from './workflow-settings';
import { loadWorkflowSettings } from './workflow-settings-server';
import { isRetiredWorkspaceId } from '@/lib/workspace';
import { planRefusal } from '@/lib/subscription';
import { notifyOwnerOfApproval } from '@/lib/approval-notice';
import { env } from '@/lib/env';
import { after } from 'next/server';

type RecordRow = { id: string; kind: RecordItem['kind']; data: unknown; revision: number };
const parse = (data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as Partial<RecordItem>;

/**
 * One client's slice of a workspace: everything their portal can ever show (lib/flow.ts portalView) —
 * their client record, every row carrying their clientId, and the comments and notices attached to
 * those. A client's page polls every few seconds; reading the whole studio for it cost every row of
 * every other client, on each poll.
 */
const clientSliceQuery = `WITH own AS (
    SELECT id FROM records WHERE workspace_id = $1 AND kind <> 'meta' AND data->>'clientId' = $2
  )
  SELECT id, kind, data, revision FROM records WHERE workspace_id = $1 AND kind <> 'meta' AND (
    id = $2 OR data->>'clientId' = $2
    OR (kind IN ('comment', 'event') AND (data->>'taskId' IN (SELECT id FROM own) OR data->>'postId' IN (SELECT id FROM own)
      OR data->>'meetingId' IN (SELECT id FROM own) OR data->>'requestId' IN (SELECT id FROM own)))
  )`;

/** The workspace's rows, or with `clientId` only that client's slice (see clientSliceQuery). */
export async function loadRecords(workspaceId: string, clientId?: string): Promise<RecordItem[]> {
  const [rows, roster, plans, settings] = await Promise.all([
    clientId
      ? database().query<RecordRow>(clientSliceQuery, [workspaceId, clientId])
      : database().query<RecordRow>("SELECT id, kind, data, revision FROM records WHERE workspace_id = $1 AND kind != 'meta'", [workspaceId]),
    database().query<{userId: string; name: string | null; email: string | null}>(
      "SELECT user_id AS \"userId\", name, email FROM workspace_members WHERE workspace_id = $1 AND role <> 'client'", [workspaceId],
    ),
    database().query<{data: {id: string; month: string}}>("SELECT data FROM records WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2)", [workspaceId, `content-plan:${workspaceId}:`]),
    loadWorkflowSettings(workspaceId),
  ]);
  const items = rows.map((row) => {
    const item = { ...parse(row.data), id: row.id, kind: row.kind, revision: row.revision } as RecordItem;
    if (item.planId) item.planMonth = plans.find(p => p.data.id === item.planId)?.data.month || item.planMonth;
    if (item.kind === 'task' && item.assignee?.trim()) {
      if (!item.assigneeId) {
        const value = item.assignee.trim().toLowerCase();
        const matches = roster.filter((m) => [m.name, m.email].some((v) => v?.trim().toLowerCase() === value));
        // Ambiguous or departed legacy identities remain visible to managers only.
        item.assigneeId = matches.length === 1 ? matches[0].userId : 'legacy:' + value;
      }
      const assigned = roster.find((m) => m.userId === item.assigneeId);
      if (assigned) item.assignee = assigned.name || assigned.email || item.assignee;
    }
    return item;
  });
  for (const item of items) {
    if (item.kind === 'task' && item.assigneeId && !parse(rows.find((r) => r.id === item.id)!.data).assigneeId) {
      await database().query("UPDATE records SET data = jsonb_set(data, '{assigneeId}', to_jsonb($3::text)) WHERE workspace_id = $1 AND id = $2 AND data->>'assigneeId' IS NULL", [workspaceId, item.id, item.assigneeId]);
    }
  }
  return withWorkflowSettings(items, settings, dayIn(new Date()));
}

export const insertRecord = (record: RecordItem, owner: string, workspaceId: string, ignoreConflict = false): Statement => ({
  text: `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, $4, $5::jsonb, 1)${ignoreConflict ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
  params: [record.id, owner, workspaceId, record.kind, JSON.stringify(record)],
});

/**
 * Applies auto-approvals, reminders, the J−1 sweep, J−7 alerts and the archiving of approved work to one workspace.
 * Returns the number of rows touched. Safe to call on every request: it writes nothing when nothing is due.
 */
export async function applySweep(workspaceId: string, rows?: RecordItem[], now = new Date()) {
  if (isRetiredWorkspaceId(workspaceId)) return 0;
  const records = rows ?? await loadRecords(workspaceId);
  const { tasks, events } = sweep(records, now);
  if (!tasks.length && !events.length) return 0;
  const statements: Statement[] = tasks.map((task) => {
    const before = records.find((r) => r.id === task.id)!;
    // A status change or an archiving means every open browser holds stale data; reminder bookkeeping does not.
    const bump = before.status !== task.status || !!before.archived !== !!task.archived ? 1 : 0;
    return {
      text: 'UPDATE records SET data = $1::jsonb, revision = revision + $2 WHERE id = $3 AND workspace_id = $4 AND revision = $5',
      params: [JSON.stringify(task), bump, task.id, workspaceId, before.revision],
    };
  });
  for (const event of events) statements.push(insertRecord(event, 'system', workspaceId, true));
  await batch(database(), statements);
  // The owner hears of every tacit approval (the deadline passed without an answer).
  const approved = tasks.filter((task) => task.status === 'Validé' && records.find((r) => r.id === task.id)?.status !== 'Validé');
  if (approved.length) {
    const origin = env.AUTH_URL ?? '';
    const notify = async () => { for (const task of approved) await notifyOwnerOfApproval(workspaceId, task, origin, records.find((r) => r.kind === 'client' && r.id === task.clientId)?.name); };
    try { after(notify); } catch { await notify(); }
  }
  return statements.length;
}

const defaultPlatforms = ['Instagram', 'Facebook', 'TikTok'];

/**
 * Seeds the three default platforms once per workspace, so the posting calendar has something to
 * select from immediately. Cheap no-op in the common case (some platform already exists). Never
 * resurrects them if a studio deliberately deletes all of them — tracked via a 'meta' marker row,
 * a 'meta' row the records query never returns.
 */
/**
 * The app used to seed fictional "demo" clients/projects/tasks (flagged `demo: true`) into an empty
 * workspace. That feature is gone; any leftovers are removed the next time the workspace loads,
 * along with the marker row that recorded the seeding. Editing one of those records cleared the flag,
 * so only untouched samples are affected. Returns true when something was removed.
 */
export async function purgeDemoRecords(workspaceId: string, rows: RecordItem[]): Promise<boolean> {
  if (!rows.some((r) => (r as RecordItem & { demo?: boolean }).demo === true)) return false;
  await database().query(
    "DELETE FROM records WHERE workspace_id = $1 AND ((data->>'demo')::boolean IS TRUE OR (kind = 'meta' AND id LIKE '%:demo'))",
    [workspaceId],
  );
  return true;
}

export async function ensurePlatforms(workspaceId: string, rows: RecordItem[]): Promise<boolean> {
  if (isRetiredWorkspaceId(workspaceId)) return false;
  if (rows.some((r) => r.kind === 'platform')) return false;
  const markerId = `platforms-seeded:${workspaceId}`;
  const marker = await database().query('SELECT 1 FROM records WHERE id = $1 AND workspace_id = $2', [markerId, workspaceId]);
  if (marker.length) return false;
  const now = new Date().toISOString();
  const statements: Statement[] = defaultPlatforms.map((name) => insertRecord(
    { id: `platform:${workspaceId}:${name.toLowerCase()}`, kind: 'platform', revision: 1, name, createdAt: now },
    'system', workspaceId, true,
  ));
  statements.push({
    text: "INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', '{}'::jsonb, 1) ON CONFLICT (id) DO NOTHING",
    params: [markerId, 'system', workspaceId],
  });
  await batch(database(), statements);
  return true;
}

/**
 * Closes clocks still running on tasks that are no longer « En cours » — left over from before every
 * status change stopped them. Each is ended when the task most likely left work (lib/flow.ts
 * leftWorkAt), so the repair only ever removes time. A no-op once nothing is left to close.
 */
export async function closeStaleClocks(workspaceId: string, rows: RecordItem[], now = new Date()) {
  const nowIso = now.toISOString();
  const stale = rows.filter((r) => r.kind === 'task' && r.status !== 'En cours' && r.timeEntries?.some((e) => !e.end));
  if (!stale.length) return 0;
  const statements: Statement[] = stale.map((task) => {
    const fixed = { ...task, timeEntries: task.timeEntries!.map((e) => (e.end ? e : { ...e, end: leftWorkAt(task, e.start, nowIso) })) };
    return {
      text: 'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4',
      params: [JSON.stringify(fixed), task.id, workspaceId, task.revision],
    };
  });
  await batch(database(), statements);
  return statements.length;
}

/** Cron entry point: every workspace, one after the other. */
export async function sweepAllWorkspaces(now = new Date()) {
  const workspaces = await database().query<{ id: string }>('SELECT id FROM workspaces');
  let touched = 0;
  let skipped = 0;
  for (const { id } of workspaces) {
    // A suspended company (trial over, plan expired or canceled) is read-only: the sweep doesn't write to it.
    if (!isRetiredWorkspaceId(id) && await planRefusal(id)) { skipped++; continue; }
    touched += await applySweep(id, undefined, now);
  }
  return { workspaces: workspaces.length, touched, skipped };
}
