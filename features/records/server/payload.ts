// What a workspace's page receives: its rows (after the due sweeps), cut down to what this person may
// see, with the roster, settings, brand and plan. GET answers it; most actions answer it after writing.
import { can } from '@/lib/roles';
import type { Process } from '@/lib/process';
import { rulesOf } from '@/lib/process';
import { loadProcess, loadProcessState } from '@/lib/process-server';
import type { AppUser } from '@/lib/auth';
import { dayIn, memberView, portalView } from '@/lib/flow';
import { applySweep, closeStaleClocks, ensurePlatforms, loadRecords, purgeDemoRecords } from '@/lib/flow-server';
import { mailConfigured } from '@/lib/mail';
import { mediaStorageConfigured } from '@/lib/media-storage';
import type { RecordItem } from '@/lib/model';
import { isOwnerEmail } from '@/lib/password-auth';
import { subscriptionState } from '@/lib/plans';
import { planView, subscriptionOf } from '@/lib/subscription';
import { loadWorkflowState } from '@/lib/workflow-settings-server';
import { canManageMembers, isCompanyWorkspaceId, isMemberRole, type WorkspaceContext, type WorkspaceMember } from '@/lib/workspace';
import { brandOf, members, workspacesFor } from './workspace-access';

/**
 * A client contact's rows: only their slice (lib/flow-server.ts clientSliceQuery), with its due clocks
 * applied so a tacit approval still lands while only the client is online. The studio-wide upkeep
 * (demo purge, platforms, stale clocks) is left to the studio's own requests and the daily cron.
 */
export async function clientRows(workspaceId: string, clientId: string) {
  const [rows, workspaceProcess] = await Promise.all([loadRecords(workspaceId, clientId), loadProcess(workspaceId)]);
  return (await applySweep(workspaceId, rows, undefined, workspaceProcess)) ? loadRecords(workspaceId, clientId) : rows;
}

/** The rows this request needs: a client contact's slice, else the whole workspace. */
export const rowsFor = (workspace: WorkspaceContext) =>
  workspace.role === 'client' && workspace.clientId ? clientRows(workspace.id, workspace.clientId) : all(workspace.id);

/** Loads the workspace, applies any due clocks, and returns the fresh rows. */
export async function all(workspaceId: string) {
  const loaded = await Promise.all([loadRecords(workspaceId), loadProcess(workspaceId)]);
  let rows = loaded[0];
  const workspaceProcess = loaded[1];
  if (await purgeDemoRecords(workspaceId, rows)) rows = await loadRecords(workspaceId);
  const swept = await applySweep(workspaceId, rows, undefined, workspaceProcess);
  const seeded = await ensurePlatforms(workspaceId, rows);
  const repaired = swept ? 0 : await closeStaleClocks(workspaceId, rows, undefined, workspaceProcess);
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

/** The rows this person may see in this workspace (portal, member and manager views). */
export function visibleTo(workspace: WorkspaceContext, rows: RecordItem[], user: AppUser, studioProcess?: Process) {
  rows = trimForTransport(rows);
  if (workspace.role === 'client') return portalView(rows, workspace.clientId!, user.userId, studioProcess);
  // A member reads their own tasks, unless their studio role lets them see all of them (lib/roles.ts).
  if (isMemberRole(workspace.role) && !can(workspace, 'tasks.all')) return memberView(rows, identitiesOf(user), user.userId, can(workspace, 'social'));
  // Devis/factures/contrats are owner + client only — admin and viewer never see that they exist.
  // The CRM's prospects (lib/crm.ts) are the owner's and the administrators' — a read-only viewer never sees them.
  // Devis, factures, contrats and the commercial scope: the owner, and an administrator-based role allowed the money (lib/roles.ts).
  if (!can(workspace, 'money')) return rows.filter((r) => r.kind !== 'document' && (r.kind !== 'prospect' || workspace.role === 'admin')).map(({ serviceScope, ...row }) => { void serviceScope; return row; });
  return rows;
}

export async function payload(workspace: WorkspaceContext, user: AppUser, rows?: RecordItem[]) {
  // Everything the page needs is read at once: each sequential database round trip used to add its
  // full latency to every poll and every click.
  const [loaded, roster, workspaces, workflowState, brand, plan, processState] = await Promise.all([
    rows ? Promise.resolve(rows) : rowsFor(workspace),
    workspace.role === 'client' ? Promise.resolve([] as WorkspaceMember[]) : members(workspace.id, can(workspace, 'team')),
    workspacesFor(user),
    loadWorkflowState(workspace.id),
    brandOf(workspace),
    planPayload(workspace),
    loadProcessState(workspace.id),
  ]);
  return {
    records: visibleTo(workspace, loaded, user, processState.process),
    workflowSettings: workflowState.settings,
    workflowRevision: workflowState.revision,
    // The studio's statuses and pages (lib/process.ts); the portal reads statuses already put in its words.
    // A client contact gets only the studio's calendar numbers (the freeze before publishing), never its process.
    ...(workspace.role === 'client' ? { rules: rulesOf(processState.process) } : { process: processState.process, processRevision: processState.revision }),
    user: { id: user.userId, name: user.fullName || user.displayName, email: user.email, avatar: user.avatar },
    workspace,
    // Members get the roster for display only: no e-mails but their own.
    members: can(workspace, 'team') ? roster : roster.map((m) => ({ ...m, email: m.userId === user.userId ? m.email : null, whatsapp: m.userId === user.userId ? m.whatsapp : null })),
    workspaces,
    today: dayIn(new Date()),
    mailConfigured: mailConfigured(),
    mediaStorage: mediaStorageConfigured(),
    // The studio's owner (OWNER_EMAIL): the finance page is theirs alone.
    platformOwner: isOwnerEmail(user.email),
    brand,
    ...plan,
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
