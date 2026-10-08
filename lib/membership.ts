// One person's membership in one workspace, read the same way by every route that checks access.
// Workspace isolation rests on this lookup: a request names a workspace (X-Workspace-Id), and only a
// membership row for that workspace and that signed-in user lets it through. Callers then apply their
// own role rule (lib/workspace.ts).
import { database } from '@/lib/database';

export type MembershipRow = { role: string; client_id: string | null };

/** The person's role (and client, for a client access) in this workspace; null when they are not a member. */
export async function membershipOf(workspaceId: string, userId: string): Promise<MembershipRow | null> {
  const rows = await database().query<MembershipRow>(
    'SELECT role, client_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  return rows[0] ?? null;
}
