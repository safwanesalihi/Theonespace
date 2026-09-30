// POST { url } → the page's title, site name, icon and description, for the Bibliothèque's « Ajouter »
// dialog (lib/link-preview.ts). Studio members only; the address must be a public web page.
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { database } from '@/lib/database';
import { json } from '@/lib/editorial-access';
import { linkPreview } from '@/lib/link-preview';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const user = await getAppUser(req);
  if (!user) return json({ error: 'Connexion requise.' }, 401);
  const workspaceId = req.headers.get('X-Workspace-Id');
  const member = workspaceId ? (await database().query<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.userId]))[0] : undefined;
  if (!member || member.role === 'client') return json({ error: 'Réservé au studio.' }, 403);
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== 'string' || body.url.length > 2000) return json({ error: 'Lien invalide.' }, 400);
  const preview = await linkPreview(body.url.trim());
  return preview ? json(preview) : json({ error: 'Ce lien ne peut pas être lu.' }, 422);
}
