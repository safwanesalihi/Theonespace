// Production failures, where the platform owner can see them. Before this, `console.error` was the whole
// story: the first report of a broken page or a post that never went out came from a user. Each failure
// is written to the server log as one JSON line, kept in `error_log` (the same error in the same area
// within a day is one row with a count), shown on the Plateforme page, and e-mailed to OWNER_EMAIL at
// most once an hour per area. Never throws: reporting must not turn a handled failure into a new one.
import { database, type Db } from '@/lib/database';
import { lockTable } from '@/lib/lock-table';
import { sendErrorAlert } from '@/lib/mail';

let ready: Promise<void> | null = null;
function ensureTable(db: Db) {
  ready ??= (async () => {
    await db.query(
      `CREATE TABLE IF NOT EXISTS error_log (
         id bigserial PRIMARY KEY, area text NOT NULL, message text NOT NULL, detail text, workspace_id text,
         count integer NOT NULL DEFAULT 1, first_at timestamptz NOT NULL DEFAULT now(), last_at timestamptz NOT NULL DEFAULT now(), alerted_at timestamptz
       )`,
    );
    await db.query('CREATE INDEX IF NOT EXISTS idx_error_log_area ON error_log (area, last_at DESC)');
    await lockTable(db, 'error_log');
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

const alertEveryMs = 3600_000;
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export type ErrorEntry = { id: number; area: string; message: string; detail: string | null; workspaceId: string | null; count: number; firstAt: string; lastAt: string; recent: boolean };

/** Records a failure in `area` (a short fixed name, e.g. 'records-save'). */
export async function reportError(area: string, error: unknown, context: { workspaceId?: string | null } = {}, db: Db = database()) {
  const message = text(error instanceof Error ? error.message : error, 500) || 'Erreur inconnue';
  const detail = error instanceof Error ? text(error.stack?.split('\n').slice(1, 4).join(' | '), 600) : null;
  console.error(JSON.stringify({ level: 'error', area, message, workspaceId: context.workspaceId ?? null }));
  try {
    await ensureTable(db);
    const [row] = await db.query<{ id: number; count: number; alerted_at: Date | string | null }>(
      `UPDATE error_log SET count = count + 1, last_at = now()
       WHERE id = (SELECT id FROM error_log WHERE area = $1 AND message = $2 AND last_at > now() - interval '1 day' ORDER BY last_at DESC LIMIT 1)
       RETURNING id, count, alerted_at`,
      [area, message],
    );
    const entry = row ?? (await db.query<{ id: number; count: number; alerted_at: Date | string | null }>(
      'INSERT INTO error_log (area, message, detail, workspace_id) VALUES ($1, $2, $3, $4) RETURNING id, count, alerted_at',
      [area, message, detail, context.workspaceId ?? null],
    ))[0];
    // One e-mail per area and hour, whatever the number of failures: the page lists them all.
    const recent = await db.query('SELECT 1 FROM error_log WHERE area = $1 AND alerted_at > $2 LIMIT 1', [area, new Date(Date.now() - alertEveryMs)]);
    if (!recent.length) {
      const mail = await sendErrorAlert({ area, message, count: entry.count });
      if (mail.sent) await db.query('UPDATE error_log SET alerted_at = now() WHERE id = $1', [entry.id]);
    }
  } catch (failure) {
    console.error(JSON.stringify({ level: 'error', area: 'error-report', message: text((failure as Error)?.message, 300) }));
  }
}

/** The latest failures for the Plateforme page (platform owner only — checked by the route). */
export async function recentErrors(limit = 50, db: Db = database()): Promise<ErrorEntry[]> {
  await ensureTable(db);
  const rows = await db.query<{ id: number; area: string; message: string; detail: string | null; workspace_id: string | null; count: number; first_at: Date | string; last_at: Date | string }>(
    'SELECT id, area, message, detail, workspace_id, count, first_at, last_at FROM error_log ORDER BY last_at DESC LIMIT $1', [Math.min(200, Math.max(1, limit))],
  );
  return rows.map((r) => ({ id: Number(r.id), area: r.area, message: r.message, detail: r.detail, workspaceId: r.workspace_id, count: r.count, firstAt: new Date(r.first_at).toISOString(), lastAt: new Date(r.last_at).toISOString(), recent: Date.now() - new Date(r.last_at).getTime() < 86_400_000 }));
}

/** Keeps the log small: the daily cron forgets failures not seen for 30 days. */
export async function pruneErrors(db: Db = database()) {
  await ensureTable(db);
  await db.query("DELETE FROM error_log WHERE last_at < now() - interval '30 days'");
}
