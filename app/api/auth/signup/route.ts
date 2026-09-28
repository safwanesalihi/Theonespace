// Public sign-up (lib/signup.ts): « start » e-mails a code, « verify » creates the account and the
// company's workspace and signs the person in. 404 unless PUBLIC_SIGNUP=on.
import { sessionCookie, sessionSettings } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { env } from '@/lib/env';
import { clientAddress } from '@/lib/login-throttle';
import { signupEnabled, SignupError, signupStartInput, signupVerifyInput, startSignup, verifySignup } from '@/lib/signup';

export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function POST(req: Request) {
  if (!signupEnabled()) return json({ error: 'La création de compte n’est pas ouverte.' }, 404);
  const settings = sessionSettings();
  if (!settings) return json({ error: 'La connexion n’est pas encore configurée.' }, 503);
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  if (!req.headers.get('content-type')?.includes('application/json')) return json({ error: 'Format invalide.' }, 415);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const action = typeof body === 'object' && body ? (body as { action?: unknown }).action : undefined;
  const address = clientAddress(req.headers);
  try {
    if (action === 'start') {
      const parsed = signupStartInput.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
      const url = `${(env.AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')}/login`;
      const started = await startSignup(parsed.data, address, url);
      return json({ ok: true, ...started });
    }
    if (action === 'verify') {
      const parsed = signupVerifyInput.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
      const done = await verifySignup(parsed.data, address);
      return json({ ok: true, workspaceId: done.workspaceId }, 200, { 'Set-Cookie': sessionCookie(settings.secure, done.token) });
    }
    return json({ error: 'Action invalide.' }, 400);
  } catch (error) {
    if (error instanceof SignupError) return json({ error: error.message }, error.status);
    console.error('signup', error);
    return json({ error: 'Création de compte indisponible. Réessayez.' }, 503);
  }
}
