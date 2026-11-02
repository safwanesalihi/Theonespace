// The Plateforme page's log: every change the platform owner makes to a company (payment, trial, suspension,
// support access, password link, deletion) and to the public site, with who, when and what. Read on the
// « Journal » tab; nothing is ever edited or removed from it. The table is created on first use.
import { lockTable } from '@/lib/lock-table';
import { database, type Db } from '@/lib/database';

let ready: Promise<void> | null = null;
function ensureTable(db: Db) {
  ready ??= (async () => {
    await db.query(
      `CREATE TABLE IF NOT EXISTS platform_audit (
         id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, action text NOT NULL,
         workspace_id text, workspace_name text, detail jsonb NOT NULL DEFAULT '{}'::jsonb
       )`,
    );
    await lockTable(db, 'platform_audit');
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

export type AuditEntry = { id: number; at: string; actor: string; action: string; workspaceId: string | null; workspaceName: string | null; detail: Record<string, unknown> };

/** Records one change. The company's name is kept as it was, so a deleted company still reads in the log. */
export async function recordAction(entry: { actor: string; action: string; workspaceId?: string | null; detail?: Record<string, unknown> }, db: Db = database()) {
  await ensureTable(db);
  const name = entry.workspaceId
    ? (await db.query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [entry.workspaceId]))[0]?.name ?? null
    : null;
  await db.query('INSERT INTO platform_audit (actor, action, workspace_id, workspace_name, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [entry.actor, entry.action, entry.workspaceId ?? null, name, JSON.stringify(entry.detail ?? {})]);
}

/** The latest changes, newest first. */
export async function recentActions(limit = 200, db: Db = database()): Promise<AuditEntry[]> {
  await ensureTable(db);
  const rows = await db.query<{ id: number | string; at: Date | string; actor: string; action: string; workspace_id: string | null; workspace_name: string | null; detail: Record<string, unknown> | string }>(
    'SELECT * FROM platform_audit ORDER BY at DESC, id DESC LIMIT $1', [Math.max(1, Math.min(500, limit))],
  );
  return rows.map((r) => ({
    id: Number(r.id), at: new Date(r.at).toISOString(), actor: r.actor, action: r.action, workspaceId: r.workspace_id, workspaceName: r.workspace_name,
    detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail ?? {},
  }));
}
