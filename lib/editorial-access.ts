// Who may upload media for, or publish, the Plan éditorial — shared by its routes. Same rules as the
// rest of the app: a signed-in member of the workspace, Origin checked, never the print workspace.
import { planRefusal } from '@/lib/subscription';
import { getAppUser, type AppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { database } from '@/lib/database';
import { isPrintWorkspaceId, isWorkspaceRole, type WorkspaceRole } from '@/lib/workspace';

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function editorialAccess(req: Request, allowed: (role: WorkspaceRole) => boolean, denied: string):
  Promise<{ user: AppUser; workspaceId: string; role: WorkspaceRole } | { response: Response }> {
  const user = await getAppUser(req);
  if (!user) return { response: json({ error: 'Connexion requise.' }, 401) };
  if (user.mustChangePassword) return { response: json({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403) };
  if (!sameOrigin(req)) return { response: json({ error: 'Origine non autorisée.' }, 403) };
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId || isPrintWorkspaceId(workspaceId)) return { response: json({ error: 'Espace inconnu.' }, 400) };
  const membership = (await database().query<{ role: string }>(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.userId],
  ))[0];
  if (!membership || !isWorkspaceRole(membership.role)) return { response: json({ error: 'Vous n’avez pas accès à cet espace.' }, 403) };
  if (!allowed(membership.role)) return { response: json({ error: denied }, 403) };
  // A company past its trial or paid period is read-only (lib/subscription.ts).
  const refusal = await planRefusal(workspaceId);
  if (refusal) return { response: json(refusal, refusal.status) };
  return { user, workspaceId, role: membership.role };
}
