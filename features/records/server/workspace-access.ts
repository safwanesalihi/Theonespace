// Who is asking, and in which workspace: membership resolution, the roster, job titles and the brand.
// Shared by every /api/records action; workspace isolation starts here (every query is scoped by id).
import { getAppUser, type AppUser } from '@/lib/auth';
import { batch, database } from '@/lib/database';
import { brandId, isHexColor, logoOnDarkModes, type Brand, type LogoOnDark } from '@/lib/branding';
import { isOwnerEmail } from '@/lib/password-auth';
import {
  cleanTitles, isCompanyWorkspaceId, isWorkspaceRole,
  type WorkspaceContext, type WorkspaceMember, type WorkspaceSummary,
} from '@/lib/workspace';
import { NoWorkspaceError, WorkspaceAccessError } from './http';
import { one, upsertMeta } from './store';

export async function identity(req?: Request) {
  return await getAppUser(req);
}

const workspaceIdFor = (owner: string) => `ws:${owner}`;

type MembershipRow = { id: string; name: string; role: string; clientId: string | null; memberName: string | null; memberEmail: string | null };
const membershipSelect = 'SELECT w.id, w.name, wm.role, wm.client_id AS "clientId", wm.name AS "memberName", wm.email AS "memberEmail"';

async function ensureWorkspaceRecord(id: string, owner: string, name: string): Promise<WorkspaceContext> {
  const now = new Date().toISOString();
  await batch(database(), [
    { text: 'INSERT INTO workspaces (id, name, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) ON CONFLICT (id) DO NOTHING', params: [id, name, owner, now] },
    { text: `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
             SELECT $1, $2, 'owner', $3 WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND created_by = $2)
             ON CONFLICT (workspace_id, user_id) DO NOTHING`, params: [id, owner, now] },
  ]);
  const workspace = await one<MembershipRow>(
    `${membershipSelect} FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id WHERE w.id = $1 AND wm.user_id = $2`,
    [id, owner],
  );
  if (!workspace || !isWorkspaceRole(workspace.role)) throw new WorkspaceAccessError();
  return { id: workspace.id, name: workspace.name, role: workspace.role, clientId: workspace.clientId };
}
const ensureWorkspace = (owner: string, name: string) => ensureWorkspaceRecord(workspaceIdFor(owner), owner, name);

const membershipOrder = 'ORDER BY CASE WHEN w.created_by = wm.user_id THEN 1 ELSE 0 END, wm.created_at ASC, w.id ASC';
// The studio's own workspace is created for the owner (OWNER_EMAIL) only: one left over on any other
// account (from the old Google sign-in) is never offered. A company workspace made through sign-up
// (lib/signup.ts, id « ws:org:… ») belongs to whoever created it. The print workspace (« …:print »)
// was retired: one made before keeps its rows in the database but is never offered or opened.
const hideOwnWorkspace = (user: AppUser) => !isOwnerEmail(user.email);
const membershipFilter = "AND ($2::boolean IS NOT TRUE OR w.created_by <> wm.user_id OR w.id LIKE 'ws:org:%') AND w.id NOT LIKE '%:print'";

export async function workspacesFor(user: AppUser): Promise<WorkspaceSummary[]> {
  const rows = await database().query<WorkspaceSummary>(
    `SELECT w.id, w.name, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = $1 ${membershipFilter} ${membershipOrder}`,
    [user.userId, hideOwnWorkspace(user)],
  );
  return rows.filter((w) => isWorkspaceRole(w.role));
}

export async function workspaceFor(user: AppUser, requestedId?: string | null): Promise<WorkspaceContext> {
  // A member lands in the studio that invited them; only the owner gets a workspace created for them.
  const membership = await one<MembershipRow>(
    `${membershipSelect} FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1 AND ($3::text IS NULL OR w.id = $3) ${membershipFilter} ${membershipOrder} LIMIT 1`,
    [user.userId, hideOwnWorkspace(user), requestedId ?? null],
  );
  if ((membership && !isWorkspaceRole(membership.role)) || (!membership && requestedId)) {
    throw new WorkspaceAccessError();
  }
  if (!membership && !isOwnerEmail(user.email)) throw new NoWorkspaceError();
  const workspace: WorkspaceContext = membership
    ? { id: membership.id, name: membership.name, role: membership.role as WorkspaceContext['role'], clientId: membership.clientId }
    : await ensureWorkspace(user.userId, 'The One Space');
  // Only trust profile details from authenticated identity, never a membership-edit request.
  // Skipped when the stored ones already match: that's every request but the first after a change.
  const identityName = user.fullName || user.displayName;
  if (!membership || membership.memberName !== identityName || membership.memberEmail !== user.email) {
    await database().query(
      `UPDATE workspace_members SET name = $1, email = $2 WHERE workspace_id = $3 AND user_id = $4
       AND (name IS DISTINCT FROM $1 OR email IS DISTINCT FROM $2)`,
      [identityName, user.email, workspace.id, user.userId],
    );
  }
  // Self-heals a workspace named before the current branding (the owner's own account name from
  // before workspaces had a fixed name) — no rename UI exists, and the studio has one correct name.
  const expectedName = 'The One Space';
  if (!isCompanyWorkspaceId(workspace.id) && workspace.name !== expectedName) {
    await database().query('UPDATE workspaces SET name = $1, updated_at = now() WHERE id = $2', [expectedName, workspace.id]);
    workspace.name = expectedName;
  }
  return workspace;
}

// A member's job titles live in a 'meta' row (never part of the records payload) rather than a new
// workspace_members column, so they need no database migration.
export const titlesId = (workspaceId: string, userId: string) => `titles:${workspaceId}:${userId}`;
/** Stores a member's trades (an empty list removes them). `titles` must already be clean (cleanTitles). */
export async function storeTitles(workspaceId: string, userId: string, titles: string[], actor: string) {
  const id = titlesId(workspaceId, userId);
  if (!titles.length) {
    await database().query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [id, workspaceId]);
    return;
  }
  await upsertMeta(database(), id, actor, workspaceId, { userId, titles });
}

/** The workspace's brand (lib/branding.ts): its name, and the logo and colour its managers chose. */
export async function brandOf(workspace: WorkspaceContext): Promise<Brand> {
  const row = await one<{ data: unknown }>("SELECT data FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [brandId(workspace.id), workspace.id]);
  const data = (row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : {}) as Record<string, unknown>;
  const logo = typeof data.logo === 'string' && data.logo ? data.logo : undefined;
  return {
    name: workspace.name,
    ...(logo ? { logo } : {}),
    ...(logo && typeof data.logoLight === 'string' && data.logoLight ? { logoLight: data.logoLight } : {}),
    ...(logo && (data.logoTone === 'dark' || data.logoTone === 'light') ? { logoTone: data.logoTone } : {}),
    ...(logo && logoOnDarkModes.includes(data.logoOnDark as LogoOnDark) && data.logoOnDark !== 'auto' ? { logoOnDark: data.logoOnDark as LogoOnDark } : {}),
    ...(isHexColor(data.color) ? { color: data.color } : {}),
  };
}
/** The brand's logo as PNG bytes (logos are stored as PNG, lib/image.ts), for the invitation PDF. */
export async function brandLogoPng(brand: Brand, workspaceId: string): Promise<Uint8Array | null> {
  // On a white PDF: the dark twin of a light logo, else the logo itself.
  const id = brand.logoLight ?? brand.logo;
  if (!id) return null;
  const row = await one<{ bytes: Uint8Array; content_type: string }>("SELECT bytes, content_type FROM assets WHERE id = $1 AND workspace_id = $2", [id, workspaceId]);
  return row && row.content_type === 'image/png' ? new Uint8Array(row.bytes) : null;
}

/**
 * The workspace's roster with each member's titles and WhatsApp number. `withState` adds what only
 * managers see: who has not signed in yet and the last sign-in.
 */
export async function members(workspaceId: string, withState = false) {
  const rows = await database().query<WorkspaceMember & { titles: unknown }>(
    `SELECT wm.user_id AS "userId", wm.role, COALESCE(NULLIF(wm.name, ''), u.name) AS name, wm.email, wm.client_id AS "clientId", wm.created_at AS "createdAt", u.avatar,
            t.data->'titles' AS titles, c.data->>'whatsapp' AS whatsapp${withState
      ? ', (u.must_change_password AND u.last_login_at IS NULL) AS "pending", u.last_login_at AS "lastLoginAt"' : ''}
     FROM workspace_members wm LEFT JOIN users u ON u.id = wm.user_id
     LEFT JOIN records t ON t.kind = 'meta' AND t.workspace_id = wm.workspace_id AND t.id = 'titles:' || wm.workspace_id || ':' || wm.user_id
     LEFT JOIN records c ON c.kind = 'meta' AND c.workspace_id = wm.workspace_id AND c.id = 'whatsapp:' || wm.workspace_id || ':' || wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY CASE WHEN wm.role = 'owner' THEN 0 WHEN wm.role = 'client' THEN 2 ELSE 1 END, wm.created_at ASC, wm.user_id ASC`,
    [workspaceId],
  );
  return rows.map((row) => {
    const raw = typeof row.titles === 'string' ? JSON.parse(row.titles) : row.titles;
    return {
      ...row, titles: row.role === 'client' ? [] : cleanTitles(raw ?? []) ?? [],
    } as WorkspaceMember;
  });
}
