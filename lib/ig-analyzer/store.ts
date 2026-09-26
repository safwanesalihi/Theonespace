// IG Analyzer — what a workspace keeps: the accounts it follows (one marked « Mon compte »), the last
// reading of each, and one follower count per account per day for growth. Stored as 'meta' rows, never
// part of the records the app loads for everyone.
import { database } from '@/lib/database';
import type { IgAccount } from '@/lib/ig-analyzer/scraper';

export type Tracked = { username: string; isMe?: boolean };
export type HistoryPoint = { date: string; followers: number };

const trackedId = (ws: string) => `ig-tracked:${ws}`;
const cacheId = (ws: string, u: string) => `ig-account:${ws}:${u}`;
const historyId = (ws: string, u: string) => `ig-history:${ws}:${u}`;
const parse = <T,>(data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as T;

async function read<T>(ws: string, id: string): Promise<T | null> {
  const row = (await database().query<{ data: unknown }>("SELECT data FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [id, ws]))[0];
  return row ? parse<T>(row.data) : null;
}
async function write(ws: string, id: string, data: unknown) {
  await database().query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
    [id, ws, JSON.stringify(data)],
  );
}

export const listTracked = async (ws: string) => (await read<{ accounts: Tracked[] }>(ws, trackedId(ws)))?.accounts ?? [];
export async function track(ws: string, username: string) {
  const accounts = await listTracked(ws);
  if (!accounts.some((a) => a.username === username)) await write(ws, trackedId(ws), { accounts: [...accounts, { username, ...(accounts.length ? {} : { isMe: true }) }] });
  return listTracked(ws);
}
export async function setMe(ws: string, username: string) {
  const accounts = (await listTracked(ws)).map((a) => ({ username: a.username, ...(a.username === username ? { isMe: true } : {}) }));
  await write(ws, trackedId(ws), { accounts });
  return accounts;
}
export async function untrack(ws: string, username: string) {
  const accounts = (await listTracked(ws)).filter((a) => a.username !== username);
  await write(ws, trackedId(ws), { accounts });
  await database().query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'meta' AND id = ANY($2::text[])", [ws, [cacheId(ws, username), historyId(ws, username)]]);
  return accounts;
}

export const readCached = (ws: string, username: string) => read<IgAccount>(ws, cacheId(ws, username));
/** Keeps the reading, and the day's follower count (one per day; the latest reading of the day wins). */
export async function saveReading(ws: string, account: IgAccount) {
  const u = account.profile.username;
  await write(ws, cacheId(ws, u), account);
  const day = account.fetchedAt.slice(0, 10);
  const points = (await read<{ points: HistoryPoint[] }>(ws, historyId(ws, u)))?.points ?? [];
  const next = [...points.filter((p) => p.date !== day), { date: day, followers: account.profile.followers_count }].sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
  await write(ws, historyId(ws, u), { points: next });
}
export async function histories(ws: string) {
  const out: Record<string, HistoryPoint[]> = {};
  for (const a of await listTracked(ws)) out[a.username] = (await read<{ points: HistoryPoint[] }>(ws, historyId(ws, a.username)))?.points ?? [];
  return out;
}
