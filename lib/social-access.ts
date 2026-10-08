// Who may connect or use a client's social accounts: a signed-in owner, admin or social media manager
// of the workspace, for every client. Shared by the /api/social routes. A client contact may also
// connect, see and disconnect their own accounts from the portal (`accountsAccess`), nobody else's.
import { getAppUser, type AppUser } from '@/lib/auth';
import { membershipOf } from '@/lib/membership';
import { env } from '@/lib/env';
import { loadRecords } from '@/lib/flow-server';
import { planRefusal } from '@/lib/subscription';
import { canSocial, isPrintWorkspaceId, isWorkspaceRole } from '@/lib/workspace';

const studioOnly = 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.';

async function membership(req: Request, workspaceId: string | null) {
  const user = await getAppUser(req);
  if (!user || user.mustChangePassword) return { error: 'Connexion requise.', status: 401 };
  if (!workspaceId || isPrintWorkspaceId(workspaceId)) return { error: 'Espace inconnu.', status: 400 };
  const member = await membershipOf(workspaceId, user.userId);
  if (!member || !isWorkspaceRole(member.role)) return { error: studioOnly, status: 403 };
  return { user, workspaceId, role: member.role, clientId: member.client_id };
}

/**
 * Connecting accounts: the studio for any client (`clientId` null), or a client contact for their own
 * client only (`clientId` set: every route holds them to it, whatever the request asks for).
 * A change (`write`, by default any request that is not GET/HEAD; the connect and callback GET routes pass it
 * explicitly) is refused with 402 once the company's trial or paid period is over, like editorialAccess.
 * A route that wants to let some change through anyway (disconnecting) passes `write: false` and checks itself.
 */
export async function accountsAccess(req: Request, workspaceId: string | null, opts: { write?: boolean } = {}): Promise<{ user: AppUser; workspaceId: string; clientId: string | null } | { error: string; status: number }> {
  const found = await membership(req, workspaceId);
  if ('error' in found) return found;
  if (opts.write ?? !['GET', 'HEAD'].includes(req.method)) {
    const refusal = await planRefusal(found.workspaceId);
    if (refusal) return { error: refusal.error, status: refusal.status };
  }
  if (canSocial(found.role)) return { user: found.user, workspaceId: found.workspaceId, clientId: null };
  if (found.role === 'client' && found.clientId) return { user: found.user, workspaceId: found.workspaceId, clientId: found.clientId };
  return { error: studioOnly, status: 403 };
}

export async function activeClient(workspaceId: string, clientId: string | null) {
  if (!clientId) return null;
  if (clientId === 'internal') return { id: 'internal', name: 'Agence' };
  const client = (await loadRecords(workspaceId)).find((r) => r.kind === 'client' && r.id === clientId && !r.archived);
  return client ? { id: client.id, name: client.name } : null;
}

export const appOrigin = (req: Request) => env.AUTH_URL?.replace(/\/$/, '') || new URL(req.url).origin;

/** Back into the app, on the client's Social tab (a client contact: their portal's accounts), with what happened for the page to say. */
export function backToApp(req: Request, clientId: string | null, params: Record<string, string>, portal = false) {
  const hash = portal && clientId ? `#portal/${encodeURIComponent(clientId)}/accounts`
    : clientId && clientId !== 'internal' ? `#client/${encodeURIComponent(clientId)}/editorial` : '#social';
  return `${appOrigin(req)}/?${new URLSearchParams(params)}${hash}`;
}
