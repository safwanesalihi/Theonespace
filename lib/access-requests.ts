// « Demander un accès »: an agency does not open its own account. It asks; The One Core calls it back,
// agrees on the plan and the payment, then opens its space from the Plateforme page: the account, the
// workspace with this person as owner, the process of the kind of studio it chose, the trial or the paid
// period, and an e-mailed link (valid 7 days) to choose a password. Declining keeps the request on file.
//
// The public form answers the same whether or not the address already has an account, and is throttled
// per address and per e-mail. The same address asking again while its request waits only updates it.
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, type Db } from '@/lib/database';
import { lockTable } from '@/lib/lock-table';
import { withinLimit } from '@/lib/login-throttle';
import { sendAccessGranted, sendAccessRequestNotice } from '@/lib/mail';
import { hashPassword } from '@/lib/password';
import { issuePasswordLink } from '@/lib/password-reset';
import { extendPaid, isPaidPlanId, type PaidPlanId } from '@/lib/plans';
import { isPresetId, presetProcess } from '@/lib/process-presets';
import { processKey } from '@/lib/process-server';
import { startTrial, updateSubscription } from '@/lib/subscription';

export const accessRules = { perAddress: 5, perEmail: 3, windowMinutes: 60, linkDays: 7 };
export const teamSizes = ['1', '2-5', '6-15', '16+'] as const;

const text = (max: number) => z.string().trim().max(max);
export const accessRequestInput = z.object({
  company: z.string().trim().min(2, 'Donnez le nom de votre agence.').max(80, 'Nom d’agence trop long (80 caractères au plus).'),
  name: z.string().trim().min(2, 'Donnez votre nom.').max(80, 'Nom trop long (80 caractères au plus).'),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(200),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/, 'Numéro de téléphone invalide.').default(''),
  city: text(60).default(''),
  teamSize: z.enum(teamSizes).or(z.literal('')).default(''),
  studioType: text(40).default(''),
  message: text(600).default(''),
});
export type AccessRequestInput = z.infer<typeof accessRequestInput>;

export type AccessRequest = AccessRequestInput & {
  id: number; status: 'pending' | 'approved' | 'declined'; createdAt: string;
  decidedAt: string | null; decidedBy: string | null; workspaceId: string | null;
};
/** What the platform owner sets when opening a space: a trial of n days, or a paid plan for n months. */
export type AccessGrant = { plan: 'trial'; trialDays: number } | { plan: PaidPlanId; months: number };

export class AccessRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

let ready: Promise<void> | null = null;
function ensureTable(db: Db) {
  ready ??= db.query(
    `CREATE TABLE IF NOT EXISTS access_requests (
       id bigserial PRIMARY KEY, email text NOT NULL, company text NOT NULL, name text NOT NULL, phone text NOT NULL DEFAULT '',
       city text NOT NULL DEFAULT '', team_size text NOT NULL DEFAULT '', studio_type text NOT NULL DEFAULT '', message text NOT NULL DEFAULT '',
       status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
       decided_by text, workspace_id text
     )`,
  ).then(() => db.query("CREATE UNIQUE INDEX IF NOT EXISTS access_requests_pending ON access_requests (email) WHERE status = 'pending'"))
    .then(() => lockTable(db, 'access_requests')).catch((error) => { ready = null; throw error; });
  return ready;
}

type Row = { id: number | string; email: string; company: string; name: string; phone: string; city: string; team_size: string; studio_type: string;
  message: string; status: AccessRequest['status']; created_at: Date | string; decided_at: Date | string | null; decided_by: string | null; workspace_id: string | null };
const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
const fromRow = (r: Row): AccessRequest => ({
  id: Number(r.id), email: r.email, company: r.company, name: r.name, phone: r.phone, city: r.city,
  teamSize: (teamSizes as readonly string[]).includes(r.team_size) ? r.team_size as AccessRequest['teamSize'] : '',
  studioType: r.studio_type, message: r.message, status: r.status, createdAt: iso(r.created_at)!,
  decidedAt: iso(r.decided_at), decidedBy: r.decided_by, workspaceId: r.workspace_id,
});

/** The public form: kept (or, while it waits, updated) and announced to The One Core. Same answer for everyone. */
export async function submitAccessRequest(input: AccessRequestInput, address: string, appUrl: string, db: Db = database()) {
  await ensureTable(db);
  const perAddress = await withinLimit(db, `access-request:${address}`, accessRules.perAddress, accessRules.windowMinutes);
  const perEmail = await withinLimit(db, `access-request-email:${input.email}`, accessRules.perEmail, accessRules.windowMinutes);
  if (!perAddress || !perEmail) throw new AccessRequestError('Trop de demandes : réessayez dans une heure.', 429);
  await db.query(
    `INSERT INTO access_requests (email, company, name, phone, city, team_size, studio_type, message) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) WHERE status = 'pending' DO UPDATE SET company = EXCLUDED.company, name = EXCLUDED.name, phone = EXCLUDED.phone,
       city = EXCLUDED.city, team_size = EXCLUDED.team_size, studio_type = EXCLUDED.studio_type, message = EXCLUDED.message, created_at = now()`,
    [input.email, input.company, input.name, input.phone, input.city, input.teamSize, input.studioType, input.message],
  );
  await sendAccessRequestNotice({ ...input, url: `${appUrl.replace(/\/$/, '')}/#platform` });
}

/** Every request, the waiting ones first, then the newest. */
export async function listAccessRequests(db: Db = database()) {
  await ensureTable(db);
  const rows = await db.query<Row>("SELECT * FROM access_requests ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 300");
  return rows.map(fromRow);
}

export const pendingAccessRequests = async (db: Db = database()) => {
  await ensureTable(db);
  return Number((await db.query<{ n: number | string }>("SELECT count(*) AS n FROM access_requests WHERE status = 'pending'"))[0]?.n ?? 0);
};

async function pending(id: number, db: Db) {
  await ensureTable(db);
  const row = (await db.query<Row>('SELECT * FROM access_requests WHERE id = $1', [id]))[0];
  if (!row) throw new AccessRequestError('Demande introuvable.', 404);
  if (row.status !== 'pending') throw new AccessRequestError('Cette demande a déjà été traitée.', 409);
  return fromRow(row);
}

/**
 * Opens the agency's space: account, workspace (owner: the person who asked), its studio's process, its plan,
 * and the link to choose a password, e-mailed — or, in local development without e-mail, handed back.
 */
export async function approveAccessRequest(id: number, grant: AccessGrant, actor: string, appUrl: string, db: Db = database()) {
  if (grant.plan === 'trial' ? !Number.isInteger(grant.trialDays) || grant.trialDays < 1 || grant.trialDays > 90
    : !isPaidPlanId(grant.plan) || !Number.isInteger(grant.months) || grant.months < 1 || grant.months > 36) {
    throw new AccessRequestError('Plan ou durée invalide.');
  }
  const request = await pending(id, db);
  const userId = randomUUID();
  const workspaceId = `ws:org:${randomUUID()}`;
  // Nobody knows this password: the person sets theirs through the e-mailed link.
  const unusable = await hashPassword(randomBytes(32).toString('base64url'));
  const created = await db.transaction(async (tx) => {
    if ((await tx.query('SELECT 1 FROM users WHERE email = $1', [request.email])).length) return false;
    await tx.query('INSERT INTO users (id, name, email, password_hash, must_change_password) VALUES ($1, $2, $3, $4, false)', [userId, request.name, request.email, unusable]);
    await tx.query('INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)', [workspaceId, request.company, userId]);
    await tx.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, $2, 'owner', $3, $4)", [workspaceId, userId, request.name, request.email]);
    if (request.studioType && isPresetId(request.studioType) && request.studioType !== 'one-core') {
      await tx.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1)",
        [processKey(workspaceId), userId, workspaceId, JSON.stringify(presetProcess(request.studioType))]);
    }
    const done = await tx.query("UPDATE access_requests SET status = 'approved', decided_at = now(), decided_by = $2, workspace_id = $3 WHERE id = $1 AND status = 'pending' RETURNING id", [id, actor, workspaceId]);
    if (!done.length) throw new AccessRequestError('Cette demande a déjà été traitée.', 409);
    return true;
  });
  if (!created) throw new AccessRequestError('Cette adresse a déjà un compte : ajoutez-la depuis l’équipe d’un espace, ou écartez la demande.', 409);

  const trial = await startTrial(workspaceId, db);
  if (grant.plan === 'trial') await updateSubscription(workspaceId, { trialEndsAt: new Date(Date.now() + grant.trialDays * 86_400_000).toISOString() }, db);
  else await updateSubscription(workspaceId, { plan: grant.plan, paidUntil: extendPaid({ ...trial, paidUntil: null }, grant.months) }, db);

  const link = await issuePasswordLink(userId, appUrl, accessRules.linkDays, db);
  const mail = await sendAccessGranted({ to: request.email, name: request.name, company: request.company, link, days: accessRules.linkDays });
  // The answer goes to the platform owner only: when the e-mail didn't leave (no provider, a refused login), the link
  // comes back so it can be passed on another way (WhatsApp) instead of leaving a space nobody can enter.
  const devLink = mail.sent ? undefined : link;
  return { workspaceId, email: request.email, company: request.company, mailed: mail.sent, ...(devLink ? { devLink } : {}) };
}

/** Not now: the request stays on file, marked declined. */
export async function declineAccessRequest(id: number, actor: string, db: Db = database()) {
  const request = await pending(id, db);
  await db.query("UPDATE access_requests SET status = 'declined', decided_at = now(), decided_by = $2 WHERE id = $1", [id, actor]);
  return request;
}
