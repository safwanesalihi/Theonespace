// App usage per person: when they arrived, when they left, how long the app was on their screen and
// how much of that they were actually using it. Read by the owner on the « Activité » page.
//
// How it is measured: while the app is the visible tab, the browser sends a beat every minute
// (app/activity-beat.ts), saying whether the person touched the keyboard, mouse or screen in the last
// few minutes. Beats less than `gapMinutes` apart belong to the same session; a longer silence (tab
// hidden, computer asleep, app closed) ends it. Time between beats counts as "on screen", and also as
// "active" when the beat says the person was interacting. The server only trusts the gap between two
// beats, capped, so a client can't claim more time than has actually passed.
//
// Storage: one 'meta' row per person, workspace and day (Casablanca time) — never part of the records
// the app loads, so nobody else receives it, and no database migration is needed.
import { database } from '@/lib/database';
import { dayIn, shiftDay } from '@/lib/flow';
import { activity, applyBeat, type ActivityDay } from '@/lib/activity-rules';
export * from '@/lib/activity-rules';

const rowId = (workspaceId: string, userId: string, day: string) => `activity:${workspaceId}:${userId}:${day}`;

const parse = (data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as ActivityDay;

export async function recordBeat(workspaceId: string, userId: string, active: boolean, now = new Date()) {
  const day = dayIn(now);
  const id = rowId(workspaceId, userId, day);
  // Two open tabs beat independently; the row lock keeps their read-modify-write in order.
  await database().transaction(async (tx) => {
    await tx.query(
      `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1) ON CONFLICT (id) DO NOTHING`,
      [id, userId, workspaceId, JSON.stringify({ userId, day, sessions: [] })],
    );
    const row = (await tx.query<{ data: unknown }>('SELECT data FROM records WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [id, workspaceId]))[0];
    if (!row) return;
    const next = applyBeat(parse(row.data), userId, day, now, active);
    await tx.query('UPDATE records SET data = $1::jsonb WHERE id = $2 AND workspace_id = $3', [JSON.stringify(next), id, workspaceId]);
  });
}

/** Every recorded day in [from, to] for the workspace, plus each person's last beat ever. */
export async function activityReport(workspaceId: string, from: string, to: string, now = new Date()) {
  const db = database();
  const prefix = `activity:${workspaceId}:`;
  await db.query(
    "DELETE FROM records WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2) AND data->>'day' < $3",
    [workspaceId, prefix, shiftDay(dayIn(now), -activity.keepDays)],
  );
  const days = (await db.query<{ data: unknown }>(
    "SELECT data FROM records WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2) AND data->>'day' BETWEEN $3 AND $4",
    [workspaceId, prefix, from, to],
  )).map((r) => parse(r.data));
  const latest = await db.query<{ data: unknown }>(
    `SELECT DISTINCT ON (data->>'userId') data FROM records
     WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2) ORDER BY data->>'userId', data->>'day' DESC`,
    [workspaceId, prefix],
  );
  const lastSeen: Record<string, string> = {};
  for (const row of latest) {
    const day = parse(row.data);
    const end = day.sessions.at(-1)?.end;
    if (end) lastSeen[day.userId] = end;
  }
  return { days, lastSeen };
}
