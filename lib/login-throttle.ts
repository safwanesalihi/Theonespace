// Slows password guessing without letting a stranger lock anyone out. Failed sign-ins are counted
// per network address AND e-mail (5 → that pair waits 15 minutes) and per network address alone
// (20 → that address waits 15 minutes) — never per account alone, so knowing someone's e-mail is not
// enough to keep them out: they sign in from their own address as usual. An e-mail with no account is
// counted exactly like a real one, so the answer never tells whether an account exists.
// Keys are hashed: the table holds no address and no e-mail in the clear.
import { lockTable } from '@/lib/lock-table';
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import type { Db } from '@/lib/database';

export const throttle = { pairAttempts: 5, addressAttempts: 20, minutes: 15 };

/**
 * The caller's address as Vercel reports it (it overwrites what the client sends). x-real-ip and
 * x-forwarded-for are client-controllable unless a proxy in front overwrites them, so they are only
 * read when TRUST_PROXY_HEADERS=1; otherwise everyone else shares the 'unknown' bucket.
 */
export function clientAddress(headers: Headers) {
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null;
  const vercel = first(headers.get('x-vercel-forwarded-for'));
  if (vercel) return vercel;
  if (env.TRUST_PROXY_HEADERS === '1') return first(headers.get('x-real-ip')) ?? first(headers.get('x-forwarded-for')) ?? 'unknown';
  return 'unknown';
}

const hash = (value: string) => createHash('sha256').update(`login-throttle:${value}`).digest('base64url');
const keysFor = (address: string, email: string) => ({ pair: hash(`pair:${address}:${email}`), address: hash(`address:${address}`) });

// Created on first use, so no manual migration can be forgotten before sign-in needs it.
let ready: Promise<void> | null = null;
function ensureTable(db: Db) {
  ready ??= db.query(
    `CREATE TABLE IF NOT EXISTS login_throttle (
       key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now(), locked_until timestamptz
     )`,
  ).then(() => lockTable(db, 'login_throttle')).catch((error) => { ready = null; throw error; });
  return ready;
}

/** Minutes left to wait, or 0 when this address may try this e-mail now. */
export async function waitMinutes(db: Db, address: string, email: string, now = new Date()) {
  await ensureTable(db);
  const { pair, address: addr } = keysFor(address, email);
  const rows = await db.query<{ locked_until: Date | string | null }>('SELECT locked_until FROM login_throttle WHERE key = ANY($1::text[])', [[pair, addr]]);
  const until = Math.max(0, ...rows.map((r) => (r.locked_until ? new Date(r.locked_until).getTime() : 0)));
  return until > now.getTime() ? Math.max(1, Math.ceil((until - now.getTime()) / 60_000)) : 0;
}

/** Counts one failure for the pair and for the address; locks whichever reached its limit. */
export async function recordFailure(db: Db, address: string, email: string, now = new Date()) {
  await ensureTable(db);
  const { pair, address: addr } = keysFor(address, email);
  const windowStart = new Date(now.getTime() - throttle.minutes * 60_000);
  const lockUntil = new Date(now.getTime() + throttle.minutes * 60_000);
  for (const [key, limit] of [[pair, throttle.pairAttempts], [addr, throttle.addressAttempts]] as const) {
    // A failure outside the current 15-minute window starts a new count; reaching the limit locks and resets it.
    await db.query(
      `INSERT INTO login_throttle (key, failures, window_start, locked_until) VALUES ($1, 1, $2, NULL)
       ON CONFLICT (key) DO UPDATE SET
         failures = CASE WHEN login_throttle.window_start < $3 THEN 1 ELSE login_throttle.failures + 1 END,
         window_start = CASE WHEN login_throttle.window_start < $3 THEN $2 ELSE login_throttle.window_start END`,
      [key, now, windowStart],
    );
    await db.query('UPDATE login_throttle SET locked_until = $2, failures = 0, window_start = $3 WHERE key = $1 AND failures >= $4', [key, lockUntil, now, limit]);
  }
}

/** A successful sign-in clears this address's count for that e-mail. */
export async function recordSuccess(db: Db, address: string, email: string) {
  await ensureTable(db);
  await db.query('DELETE FROM login_throttle WHERE key = $1', [keysFor(address, email).pair]);
}

/**
 * A plain rate limit on the same table: counts one use of `name` and says whether it is still within
 * `limit` uses per `minutes` window (e.g. sign-ups started from one address in an hour).
 */
export async function withinLimit(db: Db, name: string, limit: number, minutes: number, now = new Date()) {
  await ensureTable(db);
  const key = hash(`limit:${name}`);
  const windowStart = new Date(now.getTime() - minutes * 60_000);
  const rows = await db.query<{ failures: number }>(
    `INSERT INTO login_throttle (key, failures, window_start) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       failures = CASE WHEN login_throttle.window_start < $3 THEN 1 ELSE login_throttle.failures + 1 END,
       window_start = CASE WHEN login_throttle.window_start < $3 THEN $2 ELSE login_throttle.window_start END
     RETURNING failures`,
    [key, now, windowStart],
  );
  return (rows[0]?.failures ?? 1) <= limit;
}
