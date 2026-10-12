// The platform's answer after « Connecter ». Checks it belongs to this session, turns it into the
// client's account(s), and goes back to the client's Social tab. A Facebook login can bring several
// Pages: the person then picks the one that belongs to this client (lib/social-accounts.ts, pending).
// A client contact lands back on their portal, and only ever connects their own client.
import { getAppUser } from '@/lib/auth';
import { accountsAccess, activeClient, appOrigin, backToApp } from '@/lib/social-access';
import { oauthCookie, oauthProviders, readState, saveAccount, savePending, type OAuthProvider } from '@/lib/social-accounts';
import { metaPages, providerLabels, redirectUri, refreshConnectedPages, tiktokAccount, youtubeAccount } from '@/lib/social-oauth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const cookieOf = (req: Request) => (req.headers.get('cookie') ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${oauthCookie}=`))?.slice(oauthCookie.length + 1) ?? null;
const clearCookie = (secure: boolean) => `${oauthCookie}=; Path=/api/social/callback; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const secure = appOrigin(req).startsWith('https:');
  let portal = false;
  const go = (clientId: string | null, query: Record<string, string>) =>
    new Response(null, { status: 303, headers: { Location: backToApp(req, clientId, query, portal), 'Set-Cookie': clearCookie(secure), 'Cache-Control': 'no-store' } });
  if (!oauthProviders.includes(provider as OAuthProvider)) return go(null, { social_error: 'Réseau inconnu.' });
  const p = provider as OAuthProvider;
  const state = readState(url.searchParams.get('state'), cookieOf(req), p);
  if (!state) return go(null, { social_error: 'Connexion expirée ou interrompue : recommencez depuis « Connecter ».' });
  const user = await getAppUser(req);
  if (!user || user.userId !== state.u) return go(state.c, { social_error: 'Connectez-vous avec le compte qui a lancé la connexion.' });
  const access = await accountsAccess(req, state.w, { write: true });
  if ('error' in access) return go(state.c, { social_error: access.error });
  portal = !!access.clientId;
  if (access.clientId && access.clientId !== state.c) return go(access.clientId, { social_error: 'Client introuvable.' });
  const client = await activeClient(state.w, state.c);
  if (!client) return go(null, { social_error: 'Client introuvable.' });
  if (url.searchParams.get('error') || !url.searchParams.get('code')) {
    return go(client.id, { social_error: `Connexion ${providerLabels[p]} annulée.` });
  }
  const code = url.searchParams.get('code')!;
  const redirect = redirectUri(appOrigin(req), p);
  const by = user.fullName || user.displayName;
  try {
    if (p === 'meta') {
      const pages = await metaPages(code, redirect);
      if (!pages.length) return go(client.id, { social_error: 'Aucune Page Facebook sur ce compte : connectez-vous avec un compte qui gère la Page du client.' });
      // The other clients' Pages take their fresh tokens; one this login left unticked is reported.
      const lost = await refreshConnectedPages(state.w, pages).catch((error) => { console.error('social refresh pages', (error as Error).message); return [] as string[]; });
      await savePending(state.w, state.n, { clientId: client.id, userId: user.userId, pages });
      return go(client.id, { social_pick: state.n, ...(lost.length ? { social_lost: lost.join(', ') } : {}) });
    }
    if (p === 'tiktok') {
      const a = await tiktokAccount(code, redirect);
      await saveAccount(state.w, { clientId: client.id, network: 'tiktok', externalId: a.externalId, name: a.name, picture: a.picture, token: a.token, refreshToken: a.refreshToken, expiresAt: a.expiresAt, refreshExpiresAt: a.refreshExpiresAt, connectedBy: by });
      return go(client.id, { social_connected: 'tiktok' });
    }
    const a = await youtubeAccount(code, redirect);
    await saveAccount(state.w, { clientId: client.id, network: 'youtube', externalId: a.externalId, name: a.name, username: a.username, picture: a.picture, token: a.token, refreshToken: a.refreshToken, expiresAt: a.expiresAt, connectedBy: by });
    return go(client.id, { social_connected: 'youtube' });
  } catch (error) {
    // The provider's own message stays in the server log: it is not for the address bar.
    console.error('social callback', p, (error as Error).message);
    return go(client.id, { social_error: `${providerLabels[p]} a refusé la connexion : réessayez ou reconnectez le compte.` });
  }
}
