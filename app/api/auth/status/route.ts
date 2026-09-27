import { sessionSettings } from '@/lib/auth';
import { env } from '@/lib/env';
import { mailConfigured } from '@/lib/mail';
import { signupEnabled } from '@/lib/signup';
export const dynamic = 'force-dynamic';
// Public, secret-free health check for the sign-in setup: which pieces of configuration are present.
export function GET() {
  return Response.json({
    passwordConfigured: !!sessionSettings(),
    ownerConfigured: !!(env.OWNER_EMAIL ?? '').trim() && !!(env.OWNER_PASSWORD ?? ''),
    mailConfigured: mailConfigured(),
    // Whether the sign-in page offers « Créer un compte » (PUBLIC_SIGNUP=on).
    signupEnabled: signupEnabled(),
    // Not a secret — it's the exact address every invitation e-mail and PDF already prints.
    authUrl: env.AUTH_URL ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
