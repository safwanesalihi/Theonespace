// The Plateforme page's support tools (app/api/platform/route.ts, platform owner only): look inside a
// company (its team and invitations), help it (a password-reset link for its owner, or read-only
// support access that shows in its team list and that the company can remove), and delete it for good.
import { database } from '@/lib/database';
import { loadRecords } from '@/lib/flow-server';
import { removeMedia } from '@/lib/media-storage';
import { mediaOf } from '@/lib/social';
import { isCompanyWorkspaceId } from '@/lib/workspace';

/** How the platform owner appears in a company's team while giving support. */
export const supportName = 'Support The One Core';

export type CompanyMember = {
  userId: string; name: string | null; email: string | null; role: string;
  joinedAt: string; lastLoginAt: string | null; pending: boolean; support: boolean;
};

export async function companyDetails(workspaceId: string, platformUserId: string) {
  if (!isCompanyWorkspaceId(workspaceId)) return null;
  const db = database();
  const workspace = (await db.query<{ id: string; name: string; created_by: string }>('SELECT id, name, created_by FROM workspaces WHERE id = $1', [workspaceId]))[0];
  if (!workspace) return null;
  const rows = await db.query<{ user_id: string; name: string | null; email: string | null; role: string; created_at: Date | string; last_login_at: Date | string | null; must_change_password: boolean | null }>(
    `SELECT wm.user_id, coalesce(wm.name, u.name) AS name, coalesce(wm.email, u.email) AS email, wm.role, wm.created_at, u.last_login_at, u.must_change_password
     FROM workspace_members wm LEFT JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = $1
     ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'client' THEN 3 ELSE 2 END, wm.created_at`,
    [workspaceId],
  );
  const members: CompanyMember[] = rows.map((r) => ({
    userId: r.user_id, name: r.name, email: r.email, role: r.role,
    joinedAt: new Date(r.created_at).toISOString(),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    pending: !!r.must_change_password,
    support: r.user_id === platformUserId,
  }));
  return { id: workspace.id, name: workspace.name, members, supportAccess: members.some((m) => m.support) };
}

/** The company's owner, for the password-reset link. */
export async function companyOwner(workspaceId: string) {
  return (await database().query<{ email: string; name: string | null }>(
    "SELECT coalesce(wm.email, u.email) AS email, coalesce(wm.name, u.name) AS name FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = $1 AND wm.role = 'owner' LIMIT 1",
    [workspaceId],
  ))[0] ?? null;
}

/** Read-only support access: the platform owner joins as an observer, visibly, until they leave. */
export async function setSupportAccess(workspaceId: string, user: { userId: string; email: string }, on: boolean) {
  const db = database();
  if (on) {
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, name, email, created_at) VALUES ($1, $2, 'viewer', $3, $4, now())
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, user.userId, supportName, user.email],
    );
  } else {
    await db.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'viewer'", [workspaceId, user.userId]);
  }
}

/**
 * Deletes a company for good: its workspace (members, records, files — they cascade), its plan and AI
 * counter, the post media in storage, and the accounts that belonged only to it (with their sessions).
 * Accounts that also belong to another workspace keep their other access. Never The One Core's own.
 */
export async function deleteCompany(workspaceId: string, platformUserId: string) {
  if (!isCompanyWorkspaceId(workspaceId)) throw new Error('Seul l’espace d’une entreprise peut être supprimé.');
  const db = database();
  const media = (await loadRecords(workspaceId).catch(() => []))
    .filter((r) => r.kind === 'editorial_post')
    .flatMap((r) => mediaOf(r).map((m) => m.path).filter((p): p is string => !!p));
  const gone = await db.transaction(async (tx) => {
    const members = (await tx.query<{ user_id: string }>('SELECT user_id FROM workspace_members WHERE workspace_id = $1', [workspaceId])).map((r) => r.user_id);
    const deleted = await tx.query('DELETE FROM workspaces WHERE id = $1 RETURNING id', [workspaceId]);
    if (!deleted.length) return null;
    await tx.query('DELETE FROM subscriptions WHERE workspace_id = $1', [workspaceId]);
    await tx.query('DELETE FROM ai_usage WHERE workspace_id = $1', [workspaceId]);
    const candidates = members.filter((id) => id !== platformUserId);
    const orphans = candidates.length
      ? (await tx.query<{ id: string }>(
        'SELECT u.id FROM users u WHERE u.id = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.user_id = u.id)', [candidates],
      )).map((r) => r.id)
      : [];
    if (orphans.length) await tx.query('DELETE FROM users WHERE id = ANY($1::text[])', [orphans]);
    return { accounts: orphans };
  });
  if (!gone) return null;
  // Tables created on first use may not exist yet on a young database.
  if (gone.accounts.length && (await db.query<{ t: string | null }>("SELECT to_regclass('password_resets')::text AS t"))[0]?.t) {
    await db.query('DELETE FROM password_resets WHERE user_id = ANY($1::text[])', [gone.accounts]);
  }
  await removeMedia(media);
  return { accountsDeleted: gone.accounts.length, filesDeleted: media.length };
}
