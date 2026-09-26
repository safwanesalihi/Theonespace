// « Connecter »: sends the person to the platform's own login page, with a signed state and a
// matching cookie, so the answer can only land back in the session that asked for it.
import { activeClient, appOrigin, backToApp, socialAccess } from '@/lib/social-access';
import { newState, oauthCookie, oauthProviders, type OAuthProvider } from '@/lib/social-accounts';
import { authorizeUrl, providerConfigured, providerLabels, redirectUri } from '@/lib/social-oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  if (!oauthProviders.includes(provider as OAuthProvider)) return Response.redirect(backToApp(req, clientId, { social_error: 'Réseau inconnu.' }), 303);
  const p = provider as OAuthProvider;
  const access = await socialAccess(req, url.searchParams.get('workspace'));
  if ('error' in access) return Response.redirect(backToApp(req, clientId, { social_error: access.error }), 303);
  const client = await activeClient(access.workspaceId, clientId);
  if (!client) return Response.redirect(backToApp(req, null, { social_error: 'Client introuvable.' }), 303);
  if (!providerConfigured(p)) {
    return Response.redirect(backToApp(req, client.id, { social_error: `La connexion ${providerLabels[p]} n’est pas encore activée pour le studio (réglage unique, voir le guide).` }), 303);
  }
  const { state, nonce } = newState(access.workspaceId, client.id, access.user.userId, p);
  const secure = appOrigin(req).startsWith('https:');
  return new Response(null, {
    status: 303,
    headers: {
      Location: authorizeUrl(p, redirectUri(appOrigin(req), p), state),
      'Set-Cookie': `${oauthCookie}=${nonce}; Path=/api/social/callback; Max-Age=900; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
      'Cache-Control': 'no-store',
    },
  });
}
