// Who may connect or use a client's social accounts: a signed-in owner, admin or social media manager
// of the workspace. Shared by the /api/social routes.
import { getAppUser, type AppUser } from '@/lib/auth';
import { database } from '@/lib/database';
import { env } from '@/lib/env';
import { loadRecords } from '@/lib/flow-server';
import { canSocial, isPrintWorkspaceId, isWorkspaceRole } from '@/lib/workspace';

export async function socialAccess(req: Request, workspaceId: string | null): Promise<{ user: AppUser; workspaceId: string } | { error: string; status: number }> {
  const user = await getAppUser(req);
  if (!user || user.mustChangePassword) return { error: 'Connexion requise.', status: 401 };
  if (!workspaceId || isPrintWorkspaceId(workspaceId)) return { error: 'Espace inconnu.', status: 400 };
  const role = (await database().query<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, user.userId]))[0]?.role;
  if (!role || !isWorkspaceRole(role) || !canSocial(role)) return { error: 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.', status: 403 };
  return { user, workspaceId };
}

export async function activeClient(workspaceId: string, clientId: string | null) {
  if (!clientId) return null;
  if (clientId === 'internal') return { id: 'internal', name: 'Agence' };
  const client = (await loadRecords(workspaceId)).find((r) => r.kind === 'client' && r.id === clientId && !r.archived);
  return client ? { id: client.id, name: client.name } : null;
}

export const appOrigin = (req: Request) => env.AUTH_URL?.replace(/\/$/, '') || new URL(req.url).origin;

/** Back into the app, on the client's Social tab, with what happened for the page to say. */
export function backToApp(req: Request, clientId: string | null, params: Record<string, string>) {
  const hash = clientId && clientId !== 'internal' ? `#client/${encodeURIComponent(clientId)}/editorial` : '#social';
  return `${appOrigin(req)}/?${new URLSearchParams(params)}${hash}`;
}
