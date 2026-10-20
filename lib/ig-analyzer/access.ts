// Who may use the IG Analyzer: the owner and the administrators of a content workspace, signed in.
import { getAppUser } from '@/lib/auth';
import { membershipOf } from '@/lib/membership';
import { isManager, isWorkspaceRole } from '@/lib/workspace';

export async function igAccess(req: Request): Promise<{ workspaceId: string; userId: string } | { error: string; status: number }> {
  const user = await getAppUser(req);
  if (!user) return { error: 'Connexion requise.', status: 401 };
  if (user.mustChangePassword) return { error: 'Choisissez votre mot de passe pour continuer.', status: 403 };
  const workspaceId = req.headers.get('X-Workspace-Id') || new URL(req.url).searchParams.get('ws');
  if (!workspaceId) return { error: 'Espace inconnu.', status: 400 };
  const role = (await membershipOf(workspaceId, user.userId))?.role;
  if (!role || !isWorkspaceRole(role) || !isManager(role)) return { error: 'L’analyse Instagram est réservée au propriétaire et aux administrateurs.', status: 403 };
  return { workspaceId, userId: user.userId };
}
