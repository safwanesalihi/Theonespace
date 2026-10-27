// Who may upload media for, or publish, the Plan éditorial — shared by its routes. Same rules as the
// rest of the app: a signed-in member of the workspace, Origin checked, never the print workspace.
import { planRefusal } from '@/lib/subscription';
import { getAppUser, type AppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { membershipOf } from '@/lib/membership';
import type { Permission } from '@/lib/roles';
import { isWorkspaceRole, type WorkspaceRole } from '@/lib/workspace';

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

type Who = { role: WorkspaceRole; permissions: Permission[] };
export async function editorialAccess(req: Request, allowed: (who: Who) => boolean, denied: string):
  Promise<{ user: AppUser; workspaceId: string; role: WorkspaceRole; permissions: Permission[] } | { response: Response }> {
  const user = await getAppUser(req);
  if (!user) return { response: json({ error: 'Connexion requise.' }, 401) };
  if (user.mustChangePassword) return { response: json({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403) };
  if (!sameOrigin(req)) return { response: json({ error: 'Origine non autorisée.' }, 403) };
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId) return { response: json({ error: 'Espace inconnu.' }, 400) };
  const membership = await membershipOf(workspaceId, user.userId);
  if (!membership || !isWorkspaceRole(membership.role)) return { response: json({ error: 'Vous n’avez pas accès à cet espace.' }, 403) };
  const who: Who = { role: membership.role, permissions: membership.permissions };
  if (!allowed(who)) return { response: json({ error: denied }, 403) };
  // A company past its trial or paid period is read-only (lib/subscription.ts).
  const refusal = await planRefusal(workspaceId);
  if (refusal) return { response: json(refusal, refusal.status) };
  return { user, workspaceId, ...who };
}
