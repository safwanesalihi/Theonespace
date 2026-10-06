// E-mail + password sign-in, first-login password change, and account creation by invitation.
// There is no self sign-up: accounts exist because the studio invited someone or because the owner is seeded.
import { z } from 'zod';
import { database, type Db } from '@/lib/database';
import { recordFailure, recordSuccess, waitMinutes } from '@/lib/login-throttle';
import { env } from '@/lib/env';
import { hashToken, sessionLifetimeSeconds } from '@/lib/session-token';
import { hashPassword, passwordPolicy, verifyPassword } from '@/lib/password';


export const signInInput = z.object({
  action: z.literal('sign-in'),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(200),
  password: z.string().min(1, 'Saisissez votre mot de passe.').max(passwordPolicy.maxLength),
});
export const forgotPasswordInput = z.object({
  action: z.literal('forgot'),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(200),
});
export const resetPasswordInput = z.object({
  action: z.literal('reset'),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Ce lien a expiré ou a déjà servi : demandez-en un nouveau.'),
  newPassword: z.string().min(passwordPolicy.minLength, `Choisissez un mot de passe d’au moins ${passwordPolicy.minLength} caractères.`).max(passwordPolicy.maxLength),
});
export const changePasswordInput = z.object({
  action: z.literal('change-password'),
  currentPassword: z.string().min(1, 'Saisissez votre mot de passe actuel.').max(passwordPolicy.maxLength),
  newPassword: z.string().min(passwordPolicy.minLength, `Choisissez un mot de passe d’au moins ${passwordPolicy.minLength} caractères.`).max(passwordPolicy.maxLength),
});

/**
 * Explicit local development only: not production, and AUTH_URL names this machine. Only then may a
 * reset link or sign-up code be handed back in the response instead of being e-mailed (callers also
 * require that no mail is configured). Any deployed host, even a staging one, never gets them.
 */
export function localDevelopment() {
  if (env.NODE_ENV === 'production') return false;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.AUTH_URL ?? '').hostname); } catch { return false; }
}

export class PasswordAuthError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type UserRow = { id: string; name: string | null; email: string; password_hash: string; must_change_password: boolean; failed_logins: number; locked_until: Date | string | null };

const ownerEmail = () => (env.OWNER_EMAIL ?? '').trim().toLowerCase();
export const isOwnerEmail = (email: string) => !!ownerEmail() && email.trim().toLowerCase() === ownerEmail();

/** A readable temporary password: 3 groups of 4, no ambiguous characters. */
export function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

export async function openSession(db: Db, userId: string) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const expires = new Date(Date.now() + sessionLifetimeSeconds * 1000);
  await db.query('INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, $3)', [await hashToken(token), userId, expires]);
  return { token, expires };
}

/**
 * The owner account comes from the environment: created on first sign-in, or re-armed when its stored
 * hash is the 'reset' marker left by a migration. Changing the password later in the app takes precedence.
 */
async function seedOwner(db: Db, email: string, password: string) {
  if (!isOwnerEmail(email) || !env.OWNER_PASSWORD || password !== env.OWNER_PASSWORD) return null;
  const passwordHash = await hashPassword(password);
  const existing = (await db.query<UserRow>('SELECT id, password_hash FROM users WHERE email = $1', [email]))[0];
  if (existing && existing.password_hash !== 'reset') return null;
  if (existing) {
    await db.query('UPDATE users SET password_hash = $2, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = $1', [existing.id, passwordHash]);
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [id, 'The One Core', email, passwordHash]);
  return id;
}

export async function signIn(input: z.infer<typeof signInInput>, address = 'unknown') {
  const db = database();
  const email = input.email;
  const invalid = () => new PasswordAuthError('E-mail ou mot de passe incorrect.', 401);
  // Throttled per network address and e-mail, never per account alone (lib/login-throttle.ts): a
  // stranger can't lock anyone out, and a real e-mail and an unknown one get the very same answers.
  const wait = await waitMinutes(db, address, email);
  if (wait) throw new PasswordAuthError(`Trop de tentatives. Réessayez dans ${wait} min.`, 429);
  let user = (await db.query<UserRow>('SELECT id, name, email, password_hash, must_change_password, failed_logins, locked_until FROM users WHERE email = $1', [email]))[0];
  if (!user || user.password_hash === 'reset') {
    const seeded = await seedOwner(db, email, input.password);
    if (!seeded) {
      await verifyPassword(input.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AA==');
      await recordFailure(db, address, email);
      throw invalid();
    }
    user = (await db.query<UserRow>('SELECT id, name, email, password_hash, must_change_password, failed_logins, locked_until FROM users WHERE id = $1', [seeded]))[0];
  }
  const ok = await verifyPassword(input.password, user.password_hash);
  if (!ok) {
    await recordFailure(db, address, email);
    throw invalid();
  }
  await recordSuccess(db, address, email);
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  const session = await openSession(db, user.id);
  return { userId: user.id, mustChangePassword: user.must_change_password, ...session };
}

/** Sets a new password for the signed-in user; ends the temporary-password state. Other sessions are closed. */
export async function changePassword(userId: string, currentToken: string, input: z.infer<typeof changePasswordInput>) {
  const db = database();
  const user = (await db.query<UserRow>('SELECT id, password_hash FROM users WHERE id = $1', [userId]))[0];
  if (!user || !(await verifyPassword(input.currentPassword, user.password_hash))) throw new PasswordAuthError('Mot de passe actuel incorrect.', 401);
  if (input.currentPassword === input.newPassword) throw new PasswordAuthError('Choisissez un mot de passe différent de l’actuel.');
  await db.transaction(async (tx) => {
    await tx.query('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [userId, await hashPassword(input.newPassword)]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1 AND session_token <> $2', [userId, await hashToken(currentToken)]);
    // An outstanding reset link must not outlive the password change. The table is created lazily
    // (lib/password-reset.ts), so look before deleting: a missing table can't abort the transaction.
    if ((await tx.query<{ t: string | null }>("SELECT to_regclass('password_resets') AS t", []))[0]?.t) {
      await tx.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    }
  });
}

/**
 * Creates (or re-arms) an account with a temporary password the person must change at first login.
 * Returns the temporary password so the caller can send it — by e-mail when configured, otherwise by hand.
 */
export async function provisionAccount(db: Db, email: string, name: string) {
  const temp = temporaryPassword();
  const passwordHash = await hashPassword(temp);
  const existing = (await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]))[0];
  if (existing) {
    await db.transaction(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, invited_at = now(), name = COALESCE(NULLIF($3, \'\'), name) WHERE id = $1', [existing.id, passwordHash, name]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [existing.id]);
    });
    return { userId: existing.id, temporaryPassword: temp, existed: true };
  }
  const id = crypto.randomUUID();
  await db.query('INSERT INTO users (id, name, email, password_hash, must_change_password, invited_at) VALUES ($1, $2, $3, $4, true, now())', [id, name || null, email, passwordHash]);
  return { userId: id, temporaryPassword: temp, existed: false };
}
