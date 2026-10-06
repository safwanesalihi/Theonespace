// « Mot de passe oublié ? »: an e-mailed link to choose a new password — needed once companies sign
// up on their own, with no studio above them to renew their access.
//
// The link carries a random 32-byte token; only its SHA-256 is stored, it works once, for 30 minutes,
// and asking again replaces the previous one. Using it sets the new password, ends every other session
// and signs the person in. The request answers the same whether or not the address has an account.
import { lockTable } from '@/lib/lock-table';
import { createHash, randomBytes } from 'node:crypto';
import { database, type Db } from '@/lib/database';
import { env } from '@/lib/env';
import { withinLimit } from '@/lib/login-throttle';
import { mailConfigured, sendPasswordReset } from '@/lib/mail';
import { hashPassword } from '@/lib/password';
import { localDevelopment, openSession, PasswordAuthError } from '@/lib/password-auth';

export const resetRules = { minutes: 30, requestsPerAddress: 10, requestsPerEmail: 3, usesPerAddress: 20, windowMinutes: 60 };

const digest = (token: string) => createHash('sha256').update(`password-reset:${token}`).digest('base64url');

// Created on first use, like login_throttle: no manual migration to forget.
let ready: Promise<void> | null = null;
function ensureTable(db: Db) {
  ready ??= db.query(
    `CREATE TABLE IF NOT EXISTS password_resets (
       token_hash text PRIMARY KEY, user_id text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
     )`,
  ).then(() => lockTable(db, 'password_resets')).catch((error) => { ready = null; throw error; });
  return ready;
}

/**
 * Step 1: e-mails a link when the address has an account; answers the same when it hasn't.
 * `devLink` only in explicit local development (not production, AUTH_URL on localhost) with no e-mail set up.
 */
export async function requestPasswordReset(email: string, address: string, url: string): Promise<{ devLink?: string }> {
  const production = env.NODE_ENV === 'production';
  if (production && !mailConfigured()) throw new PasswordAuthError('La réinitialisation par e-mail n’est pas disponible : demandez à votre studio de renouveler votre accès.', 503);
  const db = database();
  await ensureTable(db);
  const perAddress = await withinLimit(db, `reset-request:${address}`, resetRules.requestsPerAddress, resetRules.windowMinutes);
  const perEmail = await withinLimit(db, `reset-request-email:${email}`, resetRules.requestsPerEmail, resetRules.windowMinutes);
  if (!perAddress || !perEmail) throw new PasswordAuthError('Trop de demandes : réessayez dans une heure.', 429);
  const user = (await db.query<{ id: string; name: string | null }>('SELECT id, name FROM users WHERE email = $1', [email]))[0];
  if (!user) return {};
  const token = randomBytes(32).toString('base64url');
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM password_resets WHERE user_id = $1 OR expires_at < now()', [user.id]);
    await tx.query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [digest(token), user.id, new Date(Date.now() + resetRules.minutes * 60_000)]);
  });
  const link = `${url.replace(/\/$/, '')}/login?reset=${token}`;
  const mail = await sendPasswordReset({ to: email, name: user.name || '', link });
  if (mail.sent) return {};
  if (!mailConfigured() && localDevelopment()) return { devLink: link };
  console.error('password reset mail', mail.error);
  return {}; // same answer: the person can ask again
}

/** Step 2: the link's token sets the new password, closes every session and opens a fresh one. */
export async function resetPassword(token: string, newPassword: string, address: string) {
  const db = database();
  await ensureTable(db);
  if (!(await withinLimit(db, `reset-use:${address}`, resetRules.usesPerAddress, resetRules.windowMinutes))) {
    throw new PasswordAuthError('Trop de demandes : réessayez dans une heure.', 429);
  }
  const hash = await hashPassword(newPassword);
  const userId = await db.transaction(async (tx) => {
    const row = (await tx.query<{ user_id: string }>('DELETE FROM password_resets WHERE token_hash = $1 AND expires_at > now() RETURNING user_id', [digest(token)]))[0];
    if (!row) return null;
    await tx.query('UPDATE users SET password_hash = $2, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = $1', [row.user_id, hash]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
    await tx.query('DELETE FROM password_resets WHERE user_id = $1', [row.user_id]);
    return row.user_id;
  });
  if (!userId) throw new PasswordAuthError('Ce lien a expiré ou a déjà servi : demandez-en un nouveau.', 400);
  return openSession(db, userId);
}
