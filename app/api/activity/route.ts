// POST: a beat from the signed-in person's browser (see lib/activity.ts). GET: the owner's report.
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { membershipOf } from '@/lib/membership';
import { activityReport, recordBeat } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const isDay = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

async function roleIn(workspaceId: string | null, userId: string) {
  if (!workspaceId || workspaceId.length > 200) return null;
  const row = await membershipOf(workspaceId, userId);
  return row?.role ?? null;
}

export async function POST(req: Request) {
  const user = await getAppUser(req);
  if (!user || user.mustChangePassword) return json({ error: 'Connexion requise.' }, 401);
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const workspaceId = req.headers.get('x-workspace-id');
  if (!(await roleIn(workspaceId, user.userId))) return json({ error: 'Accès non autorisé.' }, 403);
  const body = (await req.json().catch(() => null)) as { active?: unknown } | null;
  await recordBeat(workspaceId!, user.userId, body?.active === true);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: Request) {
  const user = await getAppUser(req);
  if (!user || user.mustChangePassword) return json({ error: 'Connexion requise.' }, 401);
  const workspaceId = req.headers.get('x-workspace-id');
  if ((await roleIn(workspaceId, user.userId)) !== 'owner') return json({ error: 'Réservé au propriétaire.' }, 403);
  const url = new URL(req.url);
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!isDay(from) || !isDay(to) || from > to || Date.parse(to) - Date.parse(from) > 92 * 86_400_000) {
    return json({ error: 'Période invalide.' }, 400);
  }
  return json(await activityReport(workspaceId!, from, to));
}
