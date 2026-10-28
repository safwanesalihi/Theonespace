// An agency's own data, in one file its owner downloads (/api/workspace-export): to keep a copy, to leave,
// or to answer a data request (law 09-08). Everything the agency made — clients, sub-projects, tasks,
// comments, posts, plans, quotes and invoices, requests, prospects, its process, settings and brand, its
// team — and never what only makes the platform run: login tokens for Facebook, TikTok, YouTube or Drive
// (stored encrypted as meta rows), password hashes, sign-up and reset codes, retry queues. Uploaded logos
// and banners are listed, not embedded.
import { database } from '@/lib/database';

/** Settings rows that are the agency's own (by id prefix); every other meta row is the platform's or a secret. */
const ownSettings = ['process:', 'workflow-settings:', 'brand:', 'titles:', 'member-role:', 'whatsapp:', 'content-plan:'];
export const isExportable = (row: { id: string; kind: string }) =>
  row.kind !== 'meta' || ownSettings.some((prefix) => row.id.startsWith(prefix));

export const exportVersion = 1;

export async function workspaceExport(workspaceId: string, now = new Date()) {
  const db = database();
  const [workspace] = await db.query<{ id: string; name: string; createdAt: string }>(
    'SELECT id, name, created_at AS "createdAt" FROM workspaces WHERE id = $1', [workspaceId]);
  const rows = await db.query<{ id: string; kind: string; data: unknown; revision: number }>(
    'SELECT id, kind, data, revision FROM records WHERE workspace_id = $1 ORDER BY kind, id', [workspaceId]);
  const team = await db.query<{ userId: string; role: string; name: string | null; email: string | null; clientId: string | null; joinedAt: string }>(
    `SELECT wm.user_id AS "userId", wm.role, COALESCE(NULLIF(wm.name, ''), u.name) AS name, wm.email, wm.client_id AS "clientId", wm.created_at AS "joinedAt"
     FROM workspace_members wm LEFT JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = $1 ORDER BY wm.created_at`, [workspaceId]);
  const files = await db.query<{ id: string; kind: string; contentType: string; size: number; createdAt: string }>(
    'SELECT id, kind, content_type AS "contentType", size, created_at AS "createdAt" FROM assets WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]);
  const records = rows.filter(isExportable).map((r) => ({ id: r.id, kind: r.kind, revision: r.revision, data: r.data }));
  const counts = Object.fromEntries([...records.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map<string, number>())]);
  return { format: 'the-one-space-export', version: exportVersion, exportedAt: now.toISOString(), workspace: workspace ?? { id: workspaceId }, counts, team, files, records };
}
