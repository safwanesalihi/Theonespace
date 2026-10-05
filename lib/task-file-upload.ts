import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { database } from '@/lib/database';
import { isWorkspaceRole } from '@/lib/workspace';

export const uploadJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function taskUploadAccess(req: Request) {
  const user = await getAppUser(req);
  if (!user) return uploadJson({ error: 'Connexion requise.' }, 401);
  if (user.mustChangePassword) return uploadJson({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403);
  if (!sameOrigin(req)) return uploadJson({ error: 'Origine non autorisée.' }, 403);
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId) return uploadJson({ error: 'Espace inconnu.' }, 400);
  const membership = (await database().query<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.userId]))[0];
  if (!membership || !isWorkspaceRole(membership.role) || membership.role === 'viewer') return uploadJson({ error: 'Votre rôle est en lecture seule.' }, 403);
  return { userId: user.userId, workspaceId };
}
