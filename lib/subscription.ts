// A company's plan on the server (lib/plans.ts): stored in `subscriptions`, one row per company
// workspace, and its usage counted from the data itself (team seats, clients, uploaded files) plus a
// monthly AI counter. The One Core's own workspaces have no row, no limit and are never read-only.
// Both tables are created on first use, like the sign-up and reset tables.
import { lockTable } from '@/lib/lock-table';
import { database, type Db } from '@/lib/database';
import { inactiveMessage, limitMessages, overLimit, plans, subscriptionState, trialDays, type Limit, type Meter, type PaidPlanId, type PlanId, type Subscription, type SubscriptionState, type Usage } from '@/lib/plans';
import { env } from '@/lib/env';
import { isCompanyWorkspaceId } from '@/lib/workspace';

let ready: Promise<void> | null = null;
function ensureTables(db: Db) {
  ready ??= (async () => {
    await db.query(
      `CREATE TABLE IF NOT EXISTS subscriptions (
         workspace_id text PRIMARY KEY, plan text NOT NULL, trial_ends_at timestamptz NOT NULL, paid_until timestamptz,
         canceled boolean NOT NULL DEFAULT false, requested_plan text, requested_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await db.query('CREATE TABLE IF NOT EXISTS ai_usage (workspace_id text NOT NULL, month text NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, month))');
    // The other monthly meters (lib/plans.ts meters), one row per company, month and meter; usage_once
    // remembers what was already counted (a participant's minutes for one meeting are counted once).
    await db.query('CREATE TABLE IF NOT EXISTS usage_counters (workspace_id text NOT NULL, month text NOT NULL, meter text NOT NULL, amount integer NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, month, meter))');
    await db.query('CREATE TABLE IF NOT EXISTS usage_once (workspace_id text NOT NULL, key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, key))');
    await lockTable(db, 'subscriptions');
    await lockTable(db, 'ai_usage');
    await lockTable(db, 'usage_counters');
    await lockTable(db, 'usage_once');
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

type Row = { plan: string; trial_ends_at: Date | string; paid_until: Date | string | null; canceled: boolean; requested_plan: string | null; requested_at: Date | string | null };
const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
const fromRow = (row: Row): Subscription => ({
  plan: (row.plan in plans ? row.plan : 'trial') as PlanId,
  trialEndsAt: iso(row.trial_ends_at)!,
  paidUntil: iso(row.paid_until),
  canceled: row.canceled,
  requestedPlan: (row.requested_plan as PaidPlanId | null) ?? null,
  requestedAt: iso(row.requested_at),
});
const month = (now = new Date()) => now.toISOString().slice(0, 7);

/** The company's subscription; a company without one (created before plans existed) starts its trial now. */
export async function subscriptionOf(workspaceId: string, db: Db = database()): Promise<Subscription | null> {
  if (!isCompanyWorkspaceId(workspaceId)) return null;
  await ensureTables(db);
  const row = (await db.query<Row>('SELECT * FROM subscriptions WHERE workspace_id = $1', [workspaceId]))[0];
  if (row) return fromRow(row);
  return startTrial(workspaceId, db);
}

/** A new company's free trial (called at sign-up; harmless if it already has one). */
export async function startTrial(workspaceId: string, db: Db = database()): Promise<Subscription> {
  await ensureTables(db);
  const ends = new Date(Date.now() + trialDays * 86_400_000);
  await db.query("INSERT INTO subscriptions (workspace_id, plan, trial_ends_at) VALUES ($1, 'trial', $2) ON CONFLICT (workspace_id) DO NOTHING", [workspaceId, ends]);
  return fromRow((await db.query<Row>('SELECT * FROM subscriptions WHERE workspace_id = $1', [workspaceId]))[0]);
}

export async function usageOf(workspaceId: string, db: Db = database()): Promise<Usage> {
  await ensureTables(db);
  const [seats, clients, bytes, ai, metered] = await Promise.all([
    // Team seats: not client contacts, and not The One Core's support access (lib/platform-admin.ts).
    db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM workspace_members WHERE workspace_id = $1 AND role <> 'client' AND lower(coalesce(email, '')) <> $2",
      [workspaceId, (env.OWNER_EMAIL ?? '').trim().toLowerCase() || '\u0000'],
    ),
    db.query<{ n: number | string }>("SELECT count(*) AS n FROM records WHERE workspace_id = $1 AND kind = 'client' AND coalesce(data->>'archived', 'false') <> 'true'", [workspaceId]),
    db.query<{ n: number | string | null }>('SELECT coalesce(sum(size), 0) AS n FROM assets WHERE workspace_id = $1', [workspaceId]),
    db.query<{ calls: number }>('SELECT calls FROM ai_usage WHERE workspace_id = $1 AND month = $2', [workspaceId, month()]),
    db.query<{ meter: string; amount: number }>('SELECT meter, amount FROM usage_counters WHERE workspace_id = $1 AND month = $2', [workspaceId, month()]),
  ]);
  const meter = (name: Meter) => Number(metered.find((m) => m.meter === name)?.amount ?? 0);
  return {
    members: Number(seats[0]?.n ?? 0),
    clients: Number(clients[0]?.n ?? 0),
    storageMb: Math.round((Number(bytes[0]?.n ?? 0) / 1_048_576) * 10) / 10,
    aiThisMonth: ai[0]?.calls ?? 0,
    igThisMonth: meter('igPerMonth'),
    meetingMinutesThisMonth: meter('meetingMinutesPerMonth'),
    whatsappThisMonth: meter('whatsappPerMonth'),
  };
}

export type PlanView = { subscription: Subscription; state: SubscriptionState; usage: Usage };
/** What the owner's Abonnement panel shows (null for The One Core's own workspaces). */
export async function planView(workspaceId: string, db: Db = database()): Promise<PlanView | null> {
  const subscription = await subscriptionOf(workspaceId, db);
  if (!subscription) return null;
  return { subscription, state: subscriptionState(subscription), usage: await usageOf(workspaceId, db) };
}

export type Refusal = { error: string; status: number; code: 'plan-inactive' | 'plan-limit' };
/**
 * Whether the workspace may make this change: not after its trial or paid period (402, read-only), and
 * not past its plan's limit for `limit` (403). Null when allowed — always for The One Core's workspaces.
 */
export async function planRefusal(workspaceId: string, limit?: Limit, adding = 1, db: Db = database()): Promise<Refusal | null> {
  const subscription = await subscriptionOf(workspaceId, db);
  if (!subscription) return null;
  const state = subscriptionState(subscription);
  if (!state.active) return { error: inactiveMessage(state.phase), status: 402, code: 'plan-inactive' };
  if (!limit) return null;
  const over = overLimit(state.limits, await usageOf(workspaceId, db), limit, adding);
  return over ? { error: limitMessages[over], status: 403, code: 'plan-limit' } : null;
}

/**
 * Reserves `amount` AI units of the month, atomically: one statement that only adds them while the total stays
 * within the plan's aiPerMonth. Returns false (nothing counted) when that would go over; always true for
 * workspaces without a plan (The One Core's own). Call it BEFORE the provider work.
 */
export async function countAiCall(workspaceId: string, amount = 1, db: Db = database()): Promise<boolean> {
  if (!isCompanyWorkspaceId(workspaceId)) return true;
  const units = Math.max(1, Math.min(1000, Math.floor(Number(amount)) || 1));
  const subscription = await subscriptionOf(workspaceId, db);
  if (!subscription) return true;
  const limit = plans[subscription.plan].limits.aiPerMonth;
  await ensureTables(db);
  const rows = await db.query<{ calls: number }>(
    `INSERT INTO ai_usage (workspace_id, month, calls) SELECT $1::text, $2::text, $3::integer WHERE $3::integer <= $4::integer
     ON CONFLICT (workspace_id, month) DO UPDATE SET calls = ai_usage.calls + $3::integer WHERE ai_usage.calls + $3::integer <= $4::integer
     RETURNING calls`,
    [workspaceId, month(), units, limit],
  );
  return rows.length > 0;
}

/**
 * Reserves `amount` of a monthly meter (Instagram readings, meeting minutes, WhatsApp messages) the same way
 * as the AI counter: one statement that only adds while the month's total stays within the plan. False when
 * it would go over (nothing counted); always true for The One Core's own workspaces. With `once`, an amount
 * already counted under that key is not counted again (and true is returned). Call it BEFORE the paid work.
 */
export async function countUsage(workspaceId: string, meter: Meter, amount = 1, options: { once?: string; db?: Db } = {}): Promise<boolean> {
  if (!isCompanyWorkspaceId(workspaceId)) return true;
  const db = options.db ?? database();
  const subscription = await subscriptionOf(workspaceId, db);
  if (!subscription) return true;
  const units = Math.max(1, Math.min(100_000, Math.floor(Number(amount)) || 1));
  const limit = plans[subscription.plan].limits[meter];
  await ensureTables(db);
  return db.transaction(async (tx) => {
    if (options.once) {
      const first = await tx.query('INSERT INTO usage_once (workspace_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key', [workspaceId, options.once]);
      if (!first.length) return true;
    }
    const rows = await tx.query<{ amount: number }>(
      `INSERT INTO usage_counters (workspace_id, month, meter, amount) SELECT $1::text, $2::text, $3::text, $4::integer WHERE $4::integer <= $5::integer
       ON CONFLICT (workspace_id, month, meter) DO UPDATE SET amount = usage_counters.amount + $4::integer WHERE usage_counters.amount + $4::integer <= $5::integer
       RETURNING amount`,
      [workspaceId, month(), meter, units, limit],
    );
    // Over the limit: the `once` mark is rolled back with the transaction, so a later try can count it.
    if (!rows.length) throw new MeterFull();
    return true;
  }).catch((error) => { if (error instanceof MeterFull) return false; throw error; });
}
class MeterFull extends Error {}

/** Gives back what a paid call reserved but never used (the provider failed before doing the work). */
export async function releaseUsage(workspaceId: string, meter: Meter, amount = 1, db: Db = database()) {
  if (!isCompanyWorkspaceId(workspaceId)) return;
  await ensureTables(db);
  await db.query('UPDATE usage_counters SET amount = GREATEST(0, amount - $4::integer) WHERE workspace_id = $1 AND month = $2 AND meter = $3', [workspaceId, month(), meter, Math.max(1, Math.floor(amount))]);
}

/** The refusal shown when a meter is full (the French message, translated in the browser). */
export const meterRefusal = (meter: Meter): Refusal => ({ error: limitMessages[meter], status: 403, code: 'plan-limit' });

export async function requestPlan(workspaceId: string, plan: PaidPlanId, db: Db = database()) {
  await subscriptionOf(workspaceId, db);
  await db.query('UPDATE subscriptions SET requested_plan = $2, requested_at = now(), updated_at = now() WHERE workspace_id = $1', [workspaceId, plan]);
}

/** The Plateforme page's changes (platform owner only — checked by the route). */
export async function updateSubscription(workspaceId: string, change: Partial<Pick<Subscription, 'plan' | 'trialEndsAt' | 'paidUntil' | 'canceled'>> & { clearRequest?: boolean }, db: Db = database()) {
  await subscriptionOf(workspaceId, db);
  const sets: string[] = [], params: unknown[] = [workspaceId];
  const set = (column: string, value: unknown) => { params.push(value); sets.push(`${column} = $${params.length}`); };
  if (change.plan) set('plan', change.plan);
  if (change.trialEndsAt) set('trial_ends_at', new Date(change.trialEndsAt));
  if (change.paidUntil !== undefined) set('paid_until', change.paidUntil ? new Date(change.paidUntil) : null);
  if (change.canceled !== undefined) set('canceled', change.canceled);
  if (change.clearRequest) { sets.push('requested_plan = NULL', 'requested_at = NULL'); }
  if (!sets.length) return;
  await db.query(`UPDATE subscriptions SET ${sets.join(', ')}, updated_at = now() WHERE workspace_id = $1`, params);
}

export type CompanyRow = PlanView & { id: string; name: string; createdAt: string; ownerEmail: string | null; ownerName: string | null };
/** Every company workspace, newest first, for the Plateforme page. */
export async function listCompanies(db: Db = database()): Promise<CompanyRow[]> {
  await ensureTables(db);
  const rows = await db.query<{ id: string; name: string; created_at: Date | string; email: string | null; member_name: string | null }>(
    `SELECT w.id, w.name, w.created_at, m.email, m.name AS member_name FROM workspaces w
     LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.role = 'owner'
     WHERE w.id LIKE 'ws:org:%' ORDER BY w.created_at DESC LIMIT 500`,
  );
  return Promise.all(rows.map(async (row) => ({
    id: row.id, name: row.name, createdAt: new Date(row.created_at).toISOString(), ownerEmail: row.email, ownerName: row.member_name,
    ...(await planView(row.id, db))!,
  })));
}
