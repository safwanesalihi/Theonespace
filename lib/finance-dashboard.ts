// The owner's finance dashboard: a self-contained HTML export (TheOneCore_Dashboard_2026.html, generated
// from TheOneCore_Finance_2026.xlsx), shown at /admin/finance to the owner and to nobody else.
//
// Where the file lives: in the database, as a 'meta' row of the owner's own workspace — never in git,
// because this repository is public, and never under /public, which Next serves to anyone. A 'meta'
// row is never part of the records any page loads (see loadRecords), so no other role can reach it.
//
// Updating the numbers: export a new HTML from the workbook, open /admin/finance and use
// "Remplacer le fichier". The page never computes anything itself.
import { getAppUser, type AppUser } from '@/lib/auth';
import { database } from '@/lib/database';
import { isOwnerEmail } from '@/lib/password-auth';

export const financeLimits = { bytes: 2 * 1024 * 1024 };
export type DashboardInfo = { name: string; size: number; updatedAt: string };
type Stored = DashboardInfo & { html: string };

const workspaceOf = (user: AppUser) => `ws:${user.userId}`;
const rowId = (user: AppUser) => `finance-dashboard:${workspaceOf(user)}`;

/**
 * The signed-in owner (OWNER_EMAIL), or null for anyone else — no session, another account, or the
 * owner still on a temporary password. Callers answer null with a plain 404, never a login prompt.
 */
export async function financeOwner(req?: Request): Promise<AppUser | null> {
  const user = await getAppUser(req).catch(() => null);
  return user && !user.mustChangePassword && isOwnerEmail(user.email) ? user : null;
}

async function stored(user: AppUser): Promise<Stored | null> {
  const row = (await database().query<{ data: unknown }>(
    "SELECT data FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [rowId(user), workspaceOf(user)],
  ))[0];
  if (!row) return null;
  const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Partial<Stored>;
  return typeof data.html === 'string' ? { html: data.html, name: data.name || 'dashboard.html', size: data.size || data.html.length, updatedAt: data.updatedAt || '' } : null;
}

export async function readDashboard(user: AppUser) {
  return stored(user);
}

export async function dashboardInfo(user: AppUser): Promise<DashboardInfo | null> {
  const found = await stored(user);
  return found ? { name: found.name, size: found.size, updatedAt: found.updatedAt } : null;
}

export async function saveDashboard(user: AppUser, file: { html: string; name: string }): Promise<DashboardInfo | { error: string }> {
  const workspace = (await database().query('SELECT id FROM workspaces WHERE id = $1', [workspaceOf(user)]))[0];
  if (!workspace) return { error: 'Ouvrez d’abord votre espace une fois, puis réessayez.' };
  const info: DashboardInfo = { name: file.name, size: new TextEncoder().encode(file.html).length, updatedAt: new Date().toISOString() };
  await database().query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
    [rowId(user), user.userId, workspaceOf(user), JSON.stringify({ ...info, html: file.html })],
  );
  return info;
}
