// Public sign-up (PUBLIC_SIGNUP=on): a company creates its own account and its own workspace, and
// its first person becomes that workspace's owner. Off by default.
//
// Two steps, so nobody can claim an address that isn't theirs: « start » keeps the request (password
// already hashed) and e-mails a 6-digit code; « verify » checks the code and only then creates the
// account, the workspace and the session. Without it, someone could register a future team member's
// or client's address and walk into that studio the day they are invited.
// The answers never reveal whether an address is registered: an existing one gets the same « code
// sent » reply, and an e-mail telling its owner to sign in instead.
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { database, type Db } from '@/lib/database';
import { env } from '@/lib/env';
import { withinLimit } from '@/lib/login-throttle';
import { mailConfigured, sendSignupCode } from '@/lib/mail';
import { hashPassword, passwordPolicy } from '@/lib/password';
import { openSession } from '@/lib/password-auth';

export const signupEnabled = () => (env.PUBLIC_SIGNUP ?? '').trim().toLowerCase() === 'on';
export const signupRules = { codeMinutes: 30, codeAttempts: 5, startsPerAddress: 10, startsPerEmail: 3, verifiesPerAddress: 30, windowMinutes: 60 };

const email = z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(200);
export const signupStartInput = z.object({
  action: z.literal('start'),
  company: z.string().trim().min(2, 'Donnez le nom de votre entreprise.').max(80, 'Nom d’entreprise trop long (80 caractères au plus).'),
  name: z.string().trim().min(2, 'Donnez votre nom.').max(80, 'Nom trop long (80 caractères au plus).'),
  email,
  password: z.string().min(passwordPolicy.minLength, `Choisissez un mot de passe d’au moins ${passwordPolicy.minLength} caractères.`).max(passwordPolicy.maxLength),
});
export const signupVerifyInput = z.object({
  action: z.literal('verify'),
  email,
  code: z.string().trim().regex(/^\d{6}$/, 'Saisissez les 6 chiffres reçus par e-mail.'),
});

export class SignupError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const secret = () => env.AUTH_SECRET || (env.NODE_ENV === 'production' ? '' : 'local-development-only-secret-000000');
const codeHash = (address: string, code: string) => createHmac('sha256', secret()).update(`signup:${address}:${code}`).digest('base64url');

// Created on first use, like login_throttle: no manual migration to forget.
let ready: Promise<void> | null = null;
function ensureTable(db: Db) {
  ready ??= db.query(
    `CREATE TABLE IF NOT EXISTS signup_requests (
       email text PRIMARY KEY, code_hash text NOT NULL, password_hash text NOT NULL, name text NOT NULL, company text NOT NULL,
       attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
     )`,
  ).then(() => undefined).catch((error) => { ready = null; throw error; });
  return ready;
}

/** Step 1: keeps the request and e-mails the code. `devCode` only when no mail is set up outside production. */
export async function startSignup(input: z.infer<typeof signupStartInput>, address: string, url: string): Promise<{ devCode?: string }> {
  if (!signupEnabled()) throw new SignupError('La création de compte n’est pas ouverte.', 404);
  const production = env.NODE_ENV === 'production';
  if (production && (!mailConfigured() || secret().length < 32)) throw new SignupError('La création de compte est momentanément indisponible.', 503);
  const db = database();
  await ensureTable(db);
  const perAddress = await withinLimit(db, `signup-start:${address}`, signupRules.startsPerAddress, signupRules.windowMinutes);
  const perEmail = await withinLimit(db, `signup-start-email:${input.email}`, signupRules.startsPerEmail, signupRules.windowMinutes);
  if (!perAddress || !perEmail) throw new SignupError('Trop de demandes : réessayez dans une heure.', 429);

  const existing = (await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [input.email]))[0];
  if (existing) {
    // Same answer as a new address (and about the same time: the password is hashed all the same);
    // the e-mail tells its owner to sign in instead.
    await hashPassword(input.password);
    const mail = await sendSignupCode({ to: input.email, name: input.name, company: input.company, code: '', url, existing: true });
    if (production && !mail.sent) throw new SignupError(mail.error ?? 'L’e-mail n’a pas pu être envoyé.', 502);
    return {};
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.now() + signupRules.codeMinutes * 60_000);
  await db.query(
    `INSERT INTO signup_requests (email, code_hash, password_hash, name, company, attempts, expires_at) VALUES ($1, $2, $3, $4, $5, 0, $6)
     ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, password_hash = EXCLUDED.password_hash, name = EXCLUDED.name,
       company = EXCLUDED.company, attempts = 0, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [input.email, codeHash(input.email, code), await hashPassword(input.password), input.name, input.company, expires],
  );
  const mail = await sendSignupCode({ to: input.email, name: input.name, company: input.company, code, url, existing: false });
  if (mail.sent) return {};
  if (production) throw new SignupError(mail.error ?? 'L’e-mail n’a pas pu être envoyé.', 502);
  return { devCode: code };
}

type Pending = { email: string; code_hash: string; password_hash: string; name: string; company: string; attempts: number; expires_at: Date | string };

/**
 * Step 2: the code creates the account, the company's workspace (its own id, its own name) with this
 * person as owner, and a session. Five wrong codes, or 30 minutes, and the request is gone.
 */
export async function verifySignup(input: z.infer<typeof signupVerifyInput>, address: string) {
  if (!signupEnabled()) throw new SignupError('La création de compte n’est pas ouverte.', 404);
  const db = database();
  await ensureTable(db);
  if (!(await withinLimit(db, `signup-verify:${address}`, signupRules.verifiesPerAddress, signupRules.windowMinutes))) {
    throw new SignupError('Trop de demandes : réessayez dans une heure.', 429);
  }
  const gone = () => new SignupError('Code expiré ou inconnu : recommencez la création du compte.', 400);
  const pending = (await db.query<Pending>('SELECT * FROM signup_requests WHERE email = $1', [input.email]))[0];
  if (!pending || new Date(pending.expires_at).getTime() < Date.now() || pending.attempts >= signupRules.codeAttempts) {
    if (pending) await db.query('DELETE FROM signup_requests WHERE email = $1', [input.email]);
    throw gone();
  }
  const a = Buffer.from(codeHash(input.email, input.code)), b = Buffer.from(pending.code_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await db.query('UPDATE signup_requests SET attempts = attempts + 1 WHERE email = $1', [input.email]);
    const left = signupRules.codeAttempts - pending.attempts - 1;
    throw new SignupError(left > 0 ? `Code incorrect (${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}).` : 'Code incorrect : recommencez la création du compte.', 400);
  }
  const userId = randomUUID();
  const workspaceId = `ws:org:${randomUUID()}`;
  const created = await db.transaction(async (tx) => {
    // The address may have been invited somewhere between the two steps: that account wins.
    if ((await tx.query('SELECT 1 FROM users WHERE email = $1', [input.email])).length) return false;
    await tx.query('INSERT INTO users (id, name, email, password_hash, must_change_password) VALUES ($1, $2, $3, $4, false)', [userId, pending.name, input.email, pending.password_hash]);
    await tx.query('INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)', [workspaceId, pending.company, userId]);
    await tx.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, $2, 'owner', $3, $4)", [workspaceId, userId, pending.name, input.email]);
    await tx.query('DELETE FROM signup_requests WHERE email = $1', [input.email]);
    return true;
  });
  if (!created) {
    await db.query('DELETE FROM signup_requests WHERE email = $1', [input.email]);
    throw new SignupError('Un compte existe déjà pour cette adresse : connectez-vous.', 409);
  }
  const session = await openSession(db, userId);
  return { userId, workspaceId, ...session };
}
