// The clients' connected accounts, as the Social hub shows them (name and picture — never a token),
// which platforms the studio has switched on, and the two changes: choosing the Page after a
// Facebook login, and disconnecting an account.
import { activeClient, socialAccess } from '@/lib/social-access';
import { dropPending, listAccounts, pageToken, readPending, removeAccount, saveAccount } from '@/lib/social-accounts';
import { providerConfigured } from '@/lib/social-oauth';
import { sameOrigin } from '@/lib/auth-settings';
import { networks, type Network } from '@/lib/social';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const access = await socialAccess(req, req.headers.get('x-workspace-id'));
  if ('error' in access) return json({ error: access.error }, access.status);
  const pick = new URL(req.url).searchParams.get('pick');
  const pending = pick ? await readPending(access.workspaceId, pick) : null;
  return json({
    accounts: await listAccounts(access.workspaceId),
    available: { meta: providerConfigured('meta'), tiktok: providerConfigured('tiktok'), google: providerConfigured('google') },
    ...(pending && pending.userId === access.user.userId
      ? { pending: { clientId: pending.clientId, pages: pending.pages.map((p) => ({ id: p.id, name: p.name, picture: p.picture, instagram: p.instagram })) } }
      : {}),
  });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const access = await socialAccess(req, req.headers.get('x-workspace-id'));
  if ('error' in access) return json({ error: access.error }, access.status);
  const body = (await req.json().catch(() => ({}))) as { action?: string; nonce?: string; pageId?: string; instagram?: boolean; clientId?: string; network?: string };
  const by = access.user.fullName || access.user.displayName;

  if (body.action === 'pick') {
    const pending = typeof body.nonce === 'string' ? await readPending(access.workspaceId, body.nonce) : null;
    if (!pending || pending.userId !== access.user.userId) return json({ error: 'Choix expiré : relancez « Connecter ».' }, 410);
    const page = pending.pages.find((p) => p.id === body.pageId);
    if (!page) return json({ error: 'Page introuvable.' }, 400);
    if (!(await activeClient(access.workspaceId, pending.clientId))) return json({ error: 'Client introuvable.' }, 404);
    const token = pageToken(page);
    await saveAccount(access.workspaceId, { clientId: pending.clientId, network: 'facebook', externalId: page.id, name: page.name, picture: page.picture, token, connectedBy: by });
    if (page.instagram && body.instagram !== false) {
      await saveAccount(access.workspaceId, {
        clientId: pending.clientId, network: 'instagram', externalId: page.instagram.id, name: page.instagram.username ? `@${page.instagram.username}` : page.name,
        username: page.instagram.username, picture: page.instagram.picture, token, pageId: page.id, connectedBy: by,
      });
    }
    await dropPending(access.workspaceId, body.nonce!);
    return json({ accounts: await listAccounts(access.workspaceId), clientId: pending.clientId });
  }

  if (body.action === 'disconnect') {
    if (typeof body.clientId !== 'string' || !networks.includes(body.network as Network)) return json({ error: 'Compte introuvable.' }, 400);
    await removeAccount(access.workspaceId, body.clientId, body.network as Network);
    return json({ accounts: await listAccounts(access.workspaceId) });
  }
  return json({ error: 'Action inconnue.' }, 400);
}
