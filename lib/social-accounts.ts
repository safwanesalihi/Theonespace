// A client's connected social accounts: made by « Connecter » (the person logs into Facebook, TikTok
// or YouTube and allows The One Core to post), used by the publisher, never shown to the browser
// beyond a name and a picture. One account per network per client.
//
// Stored as 'meta' rows — never part of the records the app loads — with every token encrypted
// (lib/secret-box.ts).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { database } from '@/lib/database';
import { env } from '@/lib/env';
import { open, seal } from '@/lib/secret-box';
import type { Network } from '@/lib/social';

export type AccountSummary = {
  clientId: string; network: Network; name: string; username?: string; picture?: string;
  connectedAt: string; connectedBy: string; expiresAt?: string; status: 'ok' | 'expired';
};
type Stored = AccountSummary & { externalId: string; token: string; refreshToken?: string; refreshExpiresAt?: string; pageId?: string };
export type Account = Omit<Stored, 'token' | 'refreshToken'> & { token: string; refreshToken?: string };

const rowId = (workspaceId: string, clientId: string, network: Network) => `social-account:${workspaceId}:${clientId}:${network}`;
const parse = <T,>(data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as T;

function summary(a: Stored, now = Date.now()): AccountSummary {
  const dead = a.refreshToken ? !!a.refreshExpiresAt && Date.parse(a.refreshExpiresAt) < now : !!a.expiresAt && Date.parse(a.expiresAt) < now;
  return {
    clientId: a.clientId, network: a.network, name: a.name, ...(a.username ? { username: a.username } : {}), ...(a.picture ? { picture: a.picture } : {}),
    connectedAt: a.connectedAt, connectedBy: a.connectedBy, ...(a.expiresAt ? { expiresAt: a.expiresAt } : {}), status: dead ? 'expired' : 'ok',
  };
}

export async function listAccounts(workspaceId: string): Promise<AccountSummary[]> {
  const rows = await database().query<{ data: unknown }>(
    "SELECT data FROM records WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2)", [workspaceId, `social-account:${workspaceId}:`],
  );
  return rows.map((r) => summary(parse<Stored>(r.data)));
}

export async function getAccount(workspaceId: string, clientId: string, network: Network): Promise<Account | null> {
  const row = (await database().query<{ data: unknown }>(
    "SELECT data FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [rowId(workspaceId, clientId, network), workspaceId],
  ))[0];
  if (!row) return null;
  const stored = parse<Stored>(row.data);
  return { ...stored, token: open(stored.token), ...(stored.refreshToken ? { refreshToken: open(stored.refreshToken) } : {}) };
}

export type NewAccount = Omit<Stored, 'token' | 'refreshToken' | 'status' | 'connectedAt'> & { token: string; refreshToken?: string };

export async function saveAccount(workspaceId: string, account: NewAccount, now = new Date().toISOString()) {
  const stored: Stored = {
    ...account, status: 'ok', connectedAt: now, token: seal(account.token),
    ...(account.refreshToken ? { refreshToken: seal(account.refreshToken) } : {}),
  };
  await database().query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
    [rowId(workspaceId, account.clientId, account.network), workspaceId, JSON.stringify(stored)],
  );
}

/** After a refresh: new tokens, same account. */
export async function updateTokens(workspaceId: string, account: Account, tokens: { token: string; refreshToken?: string; expiresAt?: string; refreshExpiresAt?: string }) {
  const { token, refreshToken, ...rest } = account;
  void token; void refreshToken;
  await saveAccount(workspaceId, { ...rest, token: tokens.token, refreshToken: tokens.refreshToken ?? account.refreshToken, expiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt ?? account.refreshExpiresAt }, account.connectedAt);
}

export async function removeAccount(workspaceId: string, clientId: string, network: Network) {
  await database().query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [rowId(workspaceId, clientId, network), workspaceId]);
}

export async function removeClientAccounts(workspaceId: string, clientId: string) {
  await database().query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2)", [workspaceId, `social-account:${workspaceId}:${clientId}:`]);
}

// ---------------------------------------------------------------- the login round trip

export const oauthProviders = ['meta', 'tiktok', 'google'] as const;
export type OAuthProvider = (typeof oauthProviders)[number];
export const oauthCookie = 'the-one.social-login';

type State = { n: string; w: string; c: string; u: string; p: OAuthProvider; e: number };
const stateKey = () => {
  const secret = env.AUTH_SECRET || (env.NODE_ENV === 'production' ? '' : 'local-development-only-secret-000000');
  if (secret.length < 32) throw new Error('AUTH_SECRET manquant.');
  return secret;
};
const sign = (payload: string) => createHmac('sha256', stateKey()).update(`social-state:${payload}`).digest('base64url');

/** A signed, 15-minute state for the provider's login page, and the nonce the browser keeps in a cookie. */
export function newState(workspaceId: string, clientId: string, userId: string, provider: OAuthProvider, now = Date.now()) {
  const nonce = randomBytes(18).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ n: nonce, w: workspaceId, c: clientId, u: userId, p: provider, e: now + 15 * 60_000 } satisfies State)).toString('base64url');
  return { state: `${payload}.${sign(payload)}`, nonce };
}

export function readState(state: string | null, nonce: string | null, provider: OAuthProvider, now = Date.now()): State | null {
  if (!state || !nonce) return null;
  const [payload, mac] = state.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload)), given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let data: State;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (data.p !== provider || data.e < now || data.n !== nonce) return null;
  return data;
}

// ---------------------------------------------------------------- choosing a Page after a Meta login

export type PendingPage = { id: string; name: string; picture?: string; token: string; instagram?: { id: string; username?: string; picture?: string } };
const pendingId = (workspaceId: string, nonce: string) => `social-pending:${workspaceId}:${nonce}`;

export async function savePending(workspaceId: string, nonce: string, data: { clientId: string; userId: string; pages: PendingPage[] }, now = Date.now()) {
  const pages = data.pages.map((p) => ({ ...p, token: seal(p.token) }));
  await database().query(
    "INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1) ON CONFLICT (id) DO NOTHING",
    [pendingId(workspaceId, nonce), workspaceId, JSON.stringify({ ...data, pages, expiresAt: new Date(now + 15 * 60_000).toISOString() })],
  );
}

export async function readPending(workspaceId: string, nonce: string, now = Date.now()) {
  if (!/^[\w-]{10,60}$/.test(nonce)) return null;
  const row = (await database().query<{ data: unknown }>(
    "SELECT data FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [pendingId(workspaceId, nonce), workspaceId],
  ))[0];
  if (!row) return null;
  const data = parse<{ clientId: string; userId: string; pages: PendingPage[]; expiresAt: string }>(row.data);
  if (Date.parse(data.expiresAt) < now) { await dropPending(workspaceId, nonce); return null; }
  return data;
}

export const dropPending = (workspaceId: string, nonce: string) =>
  database().query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [pendingId(workspaceId, nonce), workspaceId]);

export const pageToken = (page: PendingPage) => open(page.token);
