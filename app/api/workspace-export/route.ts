// GET: the agency's data in one JSON file (lib/workspace-export.ts), for its owner only. Works whatever the
// plan's state: a suspended agency can still take its data with it.
import { getAppUser } from '@/lib/auth';
import { membershipOf } from '@/lib/membership';
import { workspaceExport } from '@/lib/workspace-export';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const user = await getAppUser(req);
  if (!user || user.mustChangePassword) return json({ error: 'Connexion requise.' }, 401);
  const workspaceId = req.headers.get('x-workspace-id');
  if (!workspaceId || workspaceId.length > 200) return json({ error: 'Espace inconnu.' }, 400);
  if ((await membershipOf(workspaceId, user.userId))?.role !== 'owner') return json({ error: 'Seul le propriétaire exporte les données de l’espace.' }, 403);
  const data = await workspaceExport(workspaceId);
  const day = data.exportedAt.slice(0, 10);
  const name = String(data.workspace.name ?? 'espace').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'espace';
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="the-one-space-${name}-${day}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
