// One person's membership in one workspace, read the same way by every route that checks access.
// Workspace isolation rests on this lookup: a request names a workspace (X-Workspace-Id), and only a
// membership row for that workspace and that signed-in user lets it through. Callers then apply their
// own rule: a permission (lib/roles.ts can), or the built-in role (lib/workspace.ts).
import { database } from '@/lib/database';
import { readProcess } from '@/lib/process';
import { permissionsOf, studioRoleOf, type Permission } from '@/lib/roles';
import { isWorkspaceRole } from '@/lib/workspace';

export type MembershipRow = { role: string; client_id: string | null; studioRoleId: string | null; permissions: Permission[] };

/**
 * What a member may do: their built-in role, changed by the studio role they hold (a « member-role »
 * meta row, defined in the studio's process). Shared with /api/records (workspace-access.ts) so every
 * route reads the same permissions.
 */
export function resolvePermissions(role: string, studioRoleId: string | null | undefined, processData: unknown) {
  if (!isWorkspaceRole(role)) return { studioRoleId: null, permissions: [] as Permission[] };
  // Most requests: no studio role to look up, so the process (read on every call) is never parsed.
  if (!studioRoleId || role === 'owner' || role === 'client') return { studioRoleId: null, permissions: [...permissionsOf(role, null)] };
  const raw = typeof processData === 'string' ? (() => { try { return JSON.parse(processData); } catch { return null; } })() : processData;
  const held = studioRoleOf(readProcess(raw).roles, studioRoleId);
  return { studioRoleId: held && held.base === role ? held.id : null, permissions: [...permissionsOf(role, held)] };
}

/** The person's role, client, studio role and permissions in this workspace; null when they are not a member. */
export async function membershipOf(workspaceId: string, userId: string): Promise<MembershipRow | null> {
  const rows = await database().query<{ role: string; client_id: string | null; studio_role_id: string | null; process_data: unknown }>(
    // The retired print workspace (« …:print ») is never opened, whatever memberships remain in it.
    `SELECT wm.role, wm.client_id, mr.data->>'roleId' AS studio_role_id, pr.data AS process_data
     FROM workspace_members wm
     LEFT JOIN records mr ON mr.kind = 'meta' AND mr.workspace_id = wm.workspace_id AND mr.id = 'member-role:' || wm.workspace_id || ':' || wm.user_id
     LEFT JOIN records pr ON pr.kind = 'meta' AND pr.workspace_id = wm.workspace_id AND pr.id = 'process:' || wm.workspace_id
     WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.workspace_id NOT LIKE '%:print'`,
    [workspaceId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { role: row.role, client_id: row.client_id, ...resolvePermissions(row.role, row.studio_role_id, row.process_data) };
}
