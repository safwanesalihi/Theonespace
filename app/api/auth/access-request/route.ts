// « Demander un accès » (lib/access-requests.ts): the public form an agency fills in to be called back.
// Open to anyone, same-origin, throttled; the answer never says whether the address has an account.
import { sameOrigin } from '@/lib/auth-settings';
import { accessRequestInput, AccessRequestError, submitAccessRequest } from '@/lib/access-requests';
import { env } from '@/lib/env';
import { clientAddress } from '@/lib/login-throttle';

export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  if (!req.headers.get('content-type')?.includes('application/json')) return json({ error: 'Format invalide.' }, 415);
  const body = await req.json().catch(() => null);
  const parsed = accessRequestInput.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0].message, field: parsed.error.issues[0].path.join('.') }, 400);
  try {
    await submitAccessRequest(parsed.data, clientAddress(req.headers), env.AUTH_URL ?? new URL(req.url).origin);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof AccessRequestError) return json({ error: error.message }, error.status);
    console.error('access request', error);
    return json({ error: 'Envoi impossible pour le moment. Réessayez dans un instant.' }, 503);
  }
}
