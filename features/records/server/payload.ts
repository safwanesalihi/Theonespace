// What a workspace's page receives: its rows (after the due sweeps), cut down to what this person may
// see, with the roster, settings, brand and plan. GET answers it; most actions answer it after writing.
import type { AppUser } from '@/lib/auth';
import { dayIn, memberView, portalView } from '@/lib/flow';
import { applySweep, closeStaleClocks, ensurePlatforms, loadRecords, purgeDemoRecords } from '@/lib/flow-server';
import { mailConfigured } from '@/lib/mail';
import { mediaStorageConfigured } from '@/lib/media-storage';
import type { RecordItem } from '@/lib/model';
import { isOwnerEmail } from '@/lib/password-auth';
import { subscriptionState } from '@/lib/plans';
import { printVisible } from '@/lib/printing';
import { planView, subscriptionOf } from '@/lib/subscription';
import { loadWorkflowState } from '@/lib/workflow-settings-server';
import { canManageMembers, isCompanyWorkspaceId, isMemberRole, isPrintWorkspaceId, type WorkspaceContext, type WorkspaceMember } from '@/lib/workspace';
import { brandOf, members, workspacesFor } from './workspace-access';

/** Loads the workspace, applies any due clocks, and returns the fresh rows. */
export async function all(workspaceId: string) {
  let rows = await loadRecords(workspaceId);
  if (await purgeDemoRecords(workspaceId, rows)) rows = await loadRecords(workspaceId);
  const swept = await applySweep(workspaceId, rows);
  const seeded = await ensurePlatforms(workspaceId, rows);
  const repaired = swept ? 0 : await closeStaleClocks(workspaceId, rows);
  return swept || seeded || repaired ? loadRecords(workspaceId) : rows;
}

export const canWrite = (role: WorkspaceContext['role']) => role !== 'viewer' && role !== 'client';

export const identitiesOf = (user: AppUser) => [user.fullName ?? '', user.displayName, user.email];
/** A member's reach: tasks assigned to them, or not assigned to anyone yet. */
export const isMine = (user: AppUser, task: RecordItem) =>
  task.assigneeId ? task.assigneeId === user.userId : !task.assignee?.trim() || identitiesOf(user).some((v) => v.trim().toLowerCase() === task.assignee!.trim().toLowerCase());

// Events are notifications and the activity feed; the ones worth showing are recent. Older ones
// stay in the database (nothing is deleted) but no longer travel with every poll.
const eventHorizonDays = 90;
// A task's full history stays server-side (updates never take it from the browser); the task page
// shows the latest entries, so that is all that ships with every poll.
const historyEntriesSent = 30;
function trimForTransport(rows: RecordItem[], now = Date.now()) {
  const horizon = new Date(now - eventHorizonDays * 86_400_000).toISOString();
  return rows
    .filter((r) => r.kind !== 'event' || r.createdAt >= horizon)
    .map((r) => (r.history && r.history.length > historyEntriesSent ? { ...r, history: r.history.slice(-historyEntriesSent) } : r));
}

/** The rows this person may see in this workspace (print, portal, member and manager views). */
export function visibleTo(workspace: WorkspaceContext, rows: RecordItem[], user: AppUser) {
  rows = trimForTransport(rows);
  if (isPrintWorkspaceId(workspace.id)) return printVisible(workspace, rows, user.userId);
  if (workspace.role === 'client') return portalView(rows, workspace.clientId!, user.userId);
  if (isMemberRole(workspace.role)) return memberView(rows, identitiesOf(user), user.userId, workspace.role === 'social');
  // Devis/factures/contrats are owner + client only — admin and viewer never see that they exist.
  if (workspace.role !== 'owner') return rows.filter((r) => r.kind !== 'document').map(({ serviceScope, ...row }) => { void serviceScope; return row; });
  return rows;
}

export async function payload(workspace: WorkspaceContext, user: AppUser, rows?: RecordItem[]) {
  const [loaded, roster, workspaces, workflowState] = await Promise.all([
    rows ? Promise.resolve(rows) : all(workspace.id),
    workspace.role === 'client' ? Promise.resolve([] as WorkspaceMember[]) : members(workspace.id, canManageMembers(workspace.role), user.userId),
    workspacesFor(user),
    loadWorkflowState(workspace.id),
  ]);
  return {
    records: visibleTo(workspace, loaded, user),
    workflowSettings: workflowState.settings,
    workflowRevision: workflowState.revision,
    user: { id: user.userId, name: user.fullName || user.displayName, email: user.email, avatar: user.avatar },
    workspace,
    // Members get the roster for display only: no e-mails but their own.
    members: canManageMembers(workspace.role) ? roster : roster.map((m) => ({ ...m, email: m.userId === user.userId ? m.email : null, whatsapp: m.userId === user.userId ? m.whatsapp : null })),
    workspaces,
    today: dayIn(new Date()),
    mailConfigured: mailConfigured(),
    mediaStorage: mediaStorageConfigured(),
    // The studio's owner (OWNER_EMAIL): the print workspace and the finance page are theirs alone.
    platformOwner: isOwnerEmail(user.email),
    brand: await brandOf(workspace),
    ...(await planPayload(workspace)),
  };
}

/**
 * A company's plan (lib/plans.ts): the owner and administrators see it with its usage (Équipe page);
 * everyone learns when the workspace has become read-only, for the banner.
 */
async function planPayload(workspace: WorkspaceContext) {
  if (!isCompanyWorkspaceId(workspace.id)) return {};
  if (canManageMembers(workspace.role)) {
    const view = await planView(workspace.id);
    return view ? { plan: view } : {};
  }
  const sub = await subscriptionOf(workspace.id);
  return sub ? { plan: { state: subscriptionState(sub) } } : {};
}

/** A client-portal person is only served while their client exists and is active. */
export function clientContextValid(workspace: WorkspaceContext, rows: RecordItem[]) {
  if (workspace.role !== 'client') return true;
  return !!workspace.clientId && rows.some((r) => r.kind === 'client' && r.id === workspace.clientId && !r.archived);
}
