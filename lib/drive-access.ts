import { getAppUser, type AppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { database } from '@/lib/database';
import { membershipOf } from '@/lib/membership';
import { can } from '@/lib/roles';
import { isWorkspaceRole, type WorkspaceRole } from '@/lib/workspace';
import { planRefusal } from '@/lib/subscription';
import { DriveError } from '@/lib/drive-store';
import type { RecordItem } from '@/lib/model';

export async function driveAccess(req: Request, workspaceId = req.headers.get('X-Workspace-Id'), ownerOnly = false): Promise<{ user: AppUser; workspaceId: string; role: WorkspaceRole }> {
  const user = await getAppUser(req);
  if (!user || user.mustChangePassword) throw new DriveError('Connexion requise.', 401);
  if (!workspaceId || workspaceId.length > 200) throw new DriveError('Espace inconnu.', 400);
  if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) throw new DriveError('Origine non autorisée.', 403);
  const member = await membershipOf(workspaceId, user.userId);
  if (!member || !isWorkspaceRole(member.role) || !can({ role: member.role, permissions: member.permissions }, 'clients') || (ownerOnly && member.role !== 'owner')) throw new DriveError(ownerOnly ? 'Seul le propriétaire peut connecter le Drive de l’agence.' : 'Les fichiers Drive sont réservés au propriétaire et aux administrateurs.', 403);
  if (!['GET', 'HEAD'].includes(req.method)) { const refusal = await planRefusal(workspaceId); if (refusal) throw new DriveError(refusal.error, refusal.status, refusal.code); }
  return { user, workspaceId, role: member.role };
}
export async function driveClient(w: string, id: string, writing = false): Promise<RecordItem> {
  const row = (await database().query<{ data: RecordItem; revision: number }>("SELECT data,revision FROM records WHERE id=$1 AND workspace_id=$2 AND kind='client'", [id, w]))[0];
  if (!row) throw new DriveError('Client introuvable.', 404);
  if (writing && row.data.archived) throw new DriveError('Restaurez ce client avant de modifier ses fichiers.', 409);
  return { ...row.data, id, kind: 'client', revision: row.revision };
}
export const driveJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export function driveFailure(e: unknown) {
  if (e instanceof DriveError) return driveJson({ error: e.message, code: e.code }, e.status);
  if (e instanceof SyntaxError) return driveJson({ error: 'JSON invalide.', code: 'invalid-body' }, 400);
  console.error('drive', e instanceof Error ? e.name : 'unknown');
  return driveJson({ error: 'Drive ne répond pas pour le moment. Réessayez.', code: 'unavailable' }, 503);
}
