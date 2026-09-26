// Social statistics (lib/social-insights.ts). GET: follower history for the reports — every client's for
// the studio, their own for a client contact. POST: « Actualiser les statistiques » — the studio reads the
// latest numbers from the platforms now, for one client or all.
import { sameOrigin } from '@/lib/auth-settings';
import { followerHistories, refreshInsights } from '@/lib/social-insights';
import { accountsAccess, activeClient } from '@/lib/social-access';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const access = await accountsAccess(req, req.headers.get('x-workspace-id'));
  if ('error' in access) return json({ error: access.error }, access.status);
  // A client contact always gets their own client, whatever the URL asks for.
  const asked = new URL(req.url).searchParams.get('clientId') || undefined;
  const clientId = access.clientId ?? asked;
  return json({ histories: await followerHistories(access.workspaceId, clientId) });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const access = await accountsAccess(req, req.headers.get('x-workspace-id'));
  if ('error' in access) return json({ error: access.error }, access.status);
  if (access.clientId) return json({ error: 'Les statistiques sont actualisées par le studio.' }, 403);
  const body = (await req.json().catch(() => ({}))) as { clientId?: unknown };
  const clientId = typeof body.clientId === 'string' && body.clientId ? body.clientId : undefined;
  if (clientId && !(await activeClient(access.workspaceId, clientId))) return json({ error: 'Client introuvable.' }, 404);
  const summary = await refreshInsights(access.workspaceId, { clientId, force: true });
  return json({ ok: true, ...summary, histories: await followerHistories(access.workspaceId, clientId) });
}
