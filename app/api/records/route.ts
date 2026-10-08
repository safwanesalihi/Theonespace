import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { getAppUser, type AppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { batch, database, type Statement } from '@/lib/database';
import { env } from '@/lib/env';
import { nextRepeatDay, normalizeRepeat, repeatsOn } from '@/lib/social-repeat';
import { isMediaSource } from '@/lib/media-source';
import { canManageEntry, cleanTags, linkKey } from '@/lib/library';
import { acceptFields, fields, inviteFields, requestFields, requestUpdateFields, libraryFields, documentFields, platformFields, editorialPostFields, whatsappNumber } from '@/lib/validation';
import { RecordItem, safeLink, channels as taskChannels, type Attachment, type DocStatus } from '@/lib/model';
import { mediaOf, networkLabels, targetsOf } from '@/lib/social';
import { docPrefixes, docStatusesFor, docStatusLabels, nextDocNumber, nextDocStatuses } from '@/lib/documents';
import { canonical, activeContract, scopeReadiness, scopeUsage, workflowSnapshot } from '@/lib/client-pipeline';

class CommercialError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
import {
  canManageMembers, canSocial, cleanTitles, invitableRolesFor, isManager, memberName, isMemberRole, isStudioRole, isWorkspaceRole, roleLabels, titleLimits,
  type WorkspaceContext, type WorkspaceMember, type WorkspaceRole, type WorkspaceSummary,
} from '@/lib/workspace';
import {
  approve, dayIn, flow, isEventRecipient, isEventUnreadFor, lockApplies, memberView, portalView, publish, requestChanges, sendForValidation, stopClocks,
} from '@/lib/flow';
import { applySweep, closeStaleClocks, ensurePlatforms, purgeDemoRecords, insertRecord, loadRecords } from '@/lib/flow-server';
import { isOwnerEmail, provisionAccount } from '@/lib/password-auth';
import { mailConfigured, sendClientNotice, sendInvitation } from '@/lib/mail';
import { messageNoticeConfigured, sendMessageNotice } from '@/lib/whatsapp';
import { mediaStorageConfigured, removeMedia } from '@/lib/media-storage';
import { removeClientAccounts } from '@/lib/social-accounts';
import { isCompanyWorkspaceId, isPrintWorkspaceId } from '@/lib/workspace';
import { brandId, isHexColor, logoOnDarkModes, type Brand, type LogoOnDark } from '@/lib/branding';
import { printVisible } from '@/lib/printing';
import { canManageMeeting, canPlanMeetings, meetingCapReached, meetingFields } from '@/lib/meetings';
import { lockedMeeting } from '@/lib/meeting-server';
import { finishRoom } from '@/lib/daily';
import { mutatePrinting } from '@/lib/printing-server';
import { isPaidPlanId, plans, subscriptionState } from '@/lib/plans';
import { planRefusal, planView, requestPlan, subscriptionOf } from '@/lib/subscription';
import { sendPlanRequest } from '@/lib/mail';
import { notifyOwnerOfApproval } from '@/lib/approval-notice';
import { storeMemberWhatsapp } from '@/lib/member-whatsapp';
import { notifyTaskApproval, notifyTaskApprovedByClient, notifyTaskAssignment, notifyTaskChanges, notifyTaskReminder } from '@/lib/task-whatsapp';
import { taskMentionCandidates, validateMentions } from '@/lib/task-mentions';
import { loadTaskThread } from '@/lib/task-chat-server';
import { taskWorkflowSettings, workflowSettingsSchema } from '@/lib/workflow-settings';
import { loadWorkflowState, workflowSettingsKey } from '@/lib/workflow-settings-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The sign-in page (AUTH_URL, else this request's origin): e-mails and WhatsApp link there, since the
 *  site's home is the public landing page for anyone signed out. */
const signInUrl = (req: Request) => `${(env.AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')}/login`;

class WorkspaceAccessError extends Error {}
class NoWorkspaceError extends Error {}

const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Server-Time': new Date().toISOString() } });

function conditionalResponse(req: Request, data: unknown) {
  const text = JSON.stringify(data);
  const etag = `W/"${createHash('sha1').update(text).digest('base64url')}"`;
  const headers = { 'Cache-Control': 'no-store', ETag: etag, 'X-Server-Time': new Date().toISOString() };
  return req.headers.get('if-none-match') === etag
    ? new Response(null, { status: 304, headers })
    : new Response(text, { headers: { ...headers, 'Content-Type': 'application/json' } });
}

async function identity(req?: Request) {
  return await getAppUser(req);
}

const workspaceIdFor = (owner: string) => `ws:${owner}`;
// The print side of the business: a second, independent workspace for the same owner — its own
// cash movements/orders/tasks, reached by the existing workspace switcher once it exists. Detecting one
// from a bare id (no DB round-trip) lives in lib/workspace.ts as `isPrintWorkspaceId`.
const printWorkspaceIdFor = (owner: string) => `${workspaceIdFor(owner)}:print`;

async function one<T>(text: string, params: unknown[] = []) {
  return (await database().query<T>(text, params))[0] ?? null;
}

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
// Only ever called from the owner-gated 'create-print-workspace' action, never auto-provisioned.
const ensurePrintWorkspace = (owner: string, name: string) => ensureWorkspaceRecord(printWorkspaceIdFor(owner), owner, name);

const membershipOrder = 'ORDER BY CASE WHEN w.created_by = wm.user_id THEN 1 ELSE 0 END, wm.created_at ASC, w.id ASC';
// The studio's own workspace (and its print side) is created for the owner (OWNER_EMAIL) only: one
// left over on any other account (from the old Google sign-in) is never offered. A company workspace
// made through sign-up (lib/signup.ts, id « ws:org:… ») belongs to whoever created it.
const hideOwnWorkspace = (user: AppUser) => !isOwnerEmail(user.email);
const membershipFilter = "AND ($2::boolean IS NOT TRUE OR w.created_by <> wm.user_id OR w.id LIKE 'ws:org:%')";

async function workspacesFor(user: AppUser): Promise<WorkspaceSummary[]> {
  const rows = await database().query<WorkspaceSummary>(
    `SELECT w.id, w.name, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = $1 ${membershipFilter} ${membershipOrder}`,
    [user.userId, hideOwnWorkspace(user)],
  );
  return rows.filter((w) => isWorkspaceRole(w.role));
}

async function workspaceFor(user: AppUser, requestedId?: string | null): Promise<WorkspaceContext> {
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
  // Self-heals a workspace named before the current branding (e.g. still "Impression", or the
  // owner's own account name from before workspaces had a fixed name) — no rename UI exists, these
  // two are the only workspace kinds this app has, each with one correct name.
  const expectedName = isPrintWorkspaceId(workspace.id) ? 'The One Print' : 'The One Space';
  if (!isCompanyWorkspaceId(workspace.id) && workspace.name !== expectedName) {
    await database().query('UPDATE workspaces SET name = $1, updated_at = now() WHERE id = $2', [expectedName, workspace.id]);
    workspace.name = expectedName;
  }
  return workspace;
}

// A member's job titles live in a 'meta' row (never part of the records payload) rather than a new
// workspace_members column, so they need no database migration.
const titlesId = (workspaceId: string, userId: string) => `titles:${workspaceId}:${userId}`;
/** Stores a member's trades (an empty list removes them). `titles` must already be clean (cleanTitles). */
async function storeTitles(workspaceId: string, userId: string, titles: string[], actor: string) {
  const id = titlesId(workspaceId, userId);
  if (!titles.length) {
    await database().query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [id, workspaceId]);
    return;
  }
  await database().query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
    [id, actor, workspaceId, JSON.stringify({ userId, titles })],
  );
}

/** The workspace's brand (lib/branding.ts): its name, and the logo and colour its managers chose. */
async function brandOf(workspace: WorkspaceContext): Promise<Brand> {
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
async function brandLogoPng(brand: Brand, workspaceId: string): Promise<Uint8Array | null> {
  // On a white PDF: the dark twin of a light logo, else the logo itself.
  const id = brand.logoLight ?? brand.logo;
  if (!id) return null;
  const row = await one<{ bytes: Uint8Array; content_type: string }>("SELECT bytes, content_type FROM assets WHERE id = $1 AND workspace_id = $2", [id, workspaceId]);
  return row && row.content_type === 'image/png' ? new Uint8Array(row.bytes) : null;
}

/** A studio member's access to the print workspace, shown to whoever manages both (owner, print admins). */
async function printRoles(workspaceId: string, actorId?: string) {
  if (!actorId || isPrintWorkspaceId(workspaceId)) return null;
  const rows = await database().query<{ userId: string; role: string }>(
    'SELECT user_id AS "userId", role FROM workspace_members WHERE workspace_id = $1', [`${workspaceId}:print`],
  );
  const actor = rows.find((r) => r.userId === actorId);
  if (!actor || !isWorkspaceRole(actor.role) || !isManager(actor.role)) return null;
  return new Map(rows.filter((r) => isWorkspaceRole(r.role)).map((r) => [r.userId, r.role as WorkspaceRole]));
}

async function members(workspaceId: string, withState = false, actorId?: string) {
  const print = withState ? await printRoles(workspaceId, actorId) : null;
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
      ...(print && row.role !== 'client' ? { printRole: print.get(row.userId) ?? null } : {}),
    } as WorkspaceMember;
  });
}

/** Loads the workspace, applies any due clocks, and returns the fresh rows. */
async function all(workspaceId: string) {
  let rows = await loadRecords(workspaceId);
  if (await purgeDemoRecords(workspaceId, rows)) rows = await loadRecords(workspaceId);
  const swept = await applySweep(workspaceId, rows);
  const seeded = await ensurePlatforms(workspaceId, rows);
  const repaired = swept ? 0 : await closeStaleClocks(workspaceId, rows);
  return swept || seeded || repaired ? loadRecords(workspaceId) : rows;
}

const canWrite = (role: WorkspaceContext['role']) => role !== 'viewer' && role !== 'client';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const identitiesOf = (user: AppUser) => [user.fullName ?? '', user.displayName, user.email];
// A member's reach: tasks assigned to them, or not assigned to anyone yet.
const isMine = (user: AppUser, task: RecordItem) =>
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

function visibleTo(workspace: WorkspaceContext, rows: RecordItem[], user: AppUser) {
  rows = trimForTransport(rows);
  if (isPrintWorkspaceId(workspace.id)) return printVisible(workspace, rows, user.userId);
  if (workspace.role === 'client') return portalView(rows, workspace.clientId!, user.userId);
  if (isMemberRole(workspace.role)) return memberView(rows, identitiesOf(user), user.userId, workspace.role === 'social');
  // Devis/factures/contrats are owner + client only — admin and viewer never see that they exist.
  if (workspace.role !== 'owner') return rows.filter((r) => r.kind !== 'document').map(({ serviceScope, ...row }) => { void serviceScope; return row; });
  return rows;
}

async function payload(workspace: WorkspaceContext, user: AppUser, rows?: RecordItem[]) {
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

function clientContextValid(workspace: WorkspaceContext, rows: RecordItem[]) {
  if (workspace.role !== 'client') return true;
  return !!workspace.clientId && rows.some((r) => r.kind === 'client' && r.id === workspace.clientId && !r.archived);
}

export async function GET(req: Request) {
  try {
    const user = await identity(req);
    if (!user) return response({ error: 'Connectez-vous pour accéder à votre espace.' }, 401);
    if (user.mustChangePassword) return response({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403);
    const workspace = await workspaceFor(user, req?.headers.get('X-Workspace-Id'));
    const params = new URL(req.url).searchParams;
    const chatTaskId = params.get('chatTaskId');
    const threadTaskId = params.get('threadTaskId');
    const conversationId = threadTaskId ?? chatTaskId;
    if (conversationId !== null && (!conversationId || conversationId.length > 200)) return response({ error: 'Tâche introuvable.' }, 404);
    const rows = conversationId !== null ? await loadTaskThread(workspace.id, conversationId, workspace.clientId) : await all(workspace.id);
    if (!clientContextValid(workspace, rows)) {
      return response({ error: 'Votre accès client n’est plus actif. Contactez le studio.' }, 403);
    }
    if (conversationId !== null) {
      const visible = visibleTo(workspace, rows, user);
      const task = visible.find(r => r.id === conversationId && (r.kind === 'task' || r.kind === 'plan_item'));
      if (!task || task.archived || rows.some(r => (r.id === task.clientId || r.id === task.projectId) && r.archived)) {
        return response({ error: 'Tâche introuvable.' }, 404);
      }
      if (threadTaskId !== null) return conditionalResponse(req, { messages: visible.filter(r => r.kind === 'comment' && r.taskId === task.id) });
      // Only this task's people; the client portal never receives the workspace directory.
      return response({ people: taskMentionCandidates(rows.find(r => r.id === task.id)!, await members(workspace.id)) });
    }
    // The page polls every few seconds: when nothing changed, a 304 with no body spares the download
    // and the re-render (the ETag is a hash of exactly what would have been sent).
    return conditionalResponse(req, await payload(workspace, user, rows));
  } catch (error) {
    if (error instanceof NoWorkspaceError) return response({ error: 'Aucun espace ne vous est attribué. Demandez une invitation au studio.', code: 'no-workspace' }, 403);
    if (error instanceof WorkspaceAccessError) return response({ error: 'Vous n’avez plus accès à cet espace.' }, 403);
    console.error('load records', error);
    return response({ error: 'Impossible de charger votre espace. Réessayez.' }, 503);
  }
}

export async function POST(req: Request) {
  try {
    const user = await identity(req);
    if (!user) return response({ error: 'Connexion requise.' }, 401);
    if (user.mustChangePassword) return response({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403);

    // Same rule as the sign-in routes: the browser's Origin must be present and must be the origin
    // this request was served on. A missing header used to pass, which left the door open to any
    // caller that can suppress it while the session cookie rides along.
    if (!sameOrigin(req)) {
      return response({ error: 'Origine non autorisée.' }, 403);
    }
    if (!req.headers.get('content-type')?.includes('application/json')) {
      return response({ error: 'Format invalide.' }, 415);
    }

    const raw = await req.text();
    if (raw.length > 300000) return response({ error: 'Le contenu est trop long.' }, 413);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return response({ error: 'Requête invalide.' }, 400);
    }
    if (!isObject(parsedBody)) return response({ error: 'Requête invalide.' }, 400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- action dispatch reads loosely typed fields, each validated below
    const body = parsedBody as Record<string, any>;
    // A structured client brief contains several bounded sections; other mutations keep their cap.
    if (raw.length > 25000 && !(['create', 'update'].includes(body.action) && ['client', 'document'].includes(body.kind) && isObject(body.data) && (isObject(body.data.brief) || isObject(body.data.serviceScope)))) {
      return response({ error: 'Le contenu est trop long.' }, 413);
    }

    const db = database();
    const owner = user.userId;
    const workspace = await workspaceFor(user, req.headers.get('X-Workspace-Id'));
    const now = new Date().toISOString();
    const today = dayIn(new Date());
    const actor = user.fullName || user.displayName;
    const result = async (extra: Record<string, unknown> = {}) => response({ ...(await payload(workspace, user)), ...extra });

    const compactComment = body.action === 'comment' && body.chatOnly === true;
    const compactChat = compactComment || body.action === 'chat-receipt';
    if (compactChat && (typeof body.taskId !== 'string' || !body.taskId || body.taskId.length > 200)) return response({ error: 'Tâche introuvable.' }, 404);
    const rowsNow = compactChat ? await loadTaskThread(workspace.id, body.taskId, workspace.clientId) : await all(workspace.id);
    if (!clientContextValid(workspace, rowsNow)) return response({ error: 'Votre accès client n’est plus actif. Contactez le studio.' }, 403);

    // A company past its trial or paid period is read-only: it can still look, export, stop a
    // running clock, update its own profile and ask for a plan (lib/subscription.ts).
    if (!['update-profile', 'stop-timer', 'meeting-end', 'request-plan', 'chat-receipt'].includes(body.action)) {
      const refusal = await planRefusal(workspace.id);
      if (refusal) return response(refusal, refusal.status);
    }

    if (body.action === 'request-plan') {
      if (!isCompanyWorkspaceId(workspace.id)) return response({ error: 'Action invalide.' }, 400);
      if (workspace.role !== 'owner') return response({ error: 'Seul le propriétaire peut choisir le plan.' }, 403);
      if (!isPaidPlanId(body.plan)) return response({ error: 'Plan inconnu.' }, 400);
      await requestPlan(workspace.id, body.plan);
      const mail = await sendPlanRequest({ company: workspace.name, plan: plans[body.plan].name, priceMad: plans[body.plan].priceMad, email: user.email, name: actor });
      return result({ planRequest: { sent: mail.sent } });
    }

    if (isPrintWorkspaceId(workspace.id)) {
      if (workspace.role === 'client') return response({ error: 'Accès non autorisé.' }, 403);
      if (['print-save', 'print-task-status', 'print-delete'].includes(body.action)) {
        const changed = await mutatePrinting(workspace, owner, actor, body, rowsNow, new URL(req.url).origin);
        if ('error' in changed) return response({ error: changed.error }, changed.status);
        return result({ id: changed.id, ...('assignmentWhatsapp' in changed ? { assignmentWhatsapp: changed.assignmentWhatsapp } : {}) });
      }
      const shared = ['invite-member', 'renew-invitation', 'set-member-role', 'remove-member', 'set-member-titles', 'set-member-whatsapp', 'update-profile', 'start-timer', 'stop-timer'];
      if (!shared.includes(body.action)) return response({ error: 'Cette action n’est pas disponible dans Impression.' }, 403);
    }

    if (body.action === 'set-workflow-settings') {
      if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent modifier les règles de validation.' }, 403);
      const parsed = workflowSettingsSchema.safeParse(body.data);
      if (!parsed.success) return response({ error: 'Indiquez un délai entre 1 minute et 365 jours et un nombre entier de tours entre 0 et 10 000.' }, 400);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) return response({ error: 'Actualisez les paramètres avant de réessayer.' }, 400);
      const saved = body.revision === 0
        ? await db.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1) ON CONFLICT (id) DO NOTHING RETURNING id", [workflowSettingsKey(workspace.id), owner, workspace.id, JSON.stringify(parsed.data)])
        : await db.query("UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND kind = 'meta' AND revision = $4 RETURNING id", [JSON.stringify(parsed.data), workflowSettingsKey(workspace.id), workspace.id, body.revision]);
      if (!saved.length) return response({ error: 'Ces règles ont changé. Fermez et rouvrez les paramètres avant de réessayer.' }, 409);
      return result();
    }

    const parentArchived = (rows: RecordItem[], task: RecordItem) =>
      !!task.archived || !!rows.find((r) => r.id === task.clientId)?.archived || !!rows.find((r) => r.id === task.projectId)?.archived;

    const findTask = (rows: RecordItem[], id: unknown, kind?: 'plan_item') => {
      const task = rows.find((r) => r.id === id && r.kind === (kind ?? 'task'));
      if (!task || parentArchived(rows, task)) return null;
      if (workspace.role === 'client' && task.clientId !== workspace.clientId) return null;
      if (isMemberRole(workspace.role) && kind === 'plan_item' && !task.assigneeId && !task.assignee?.trim()) return null;
      if (isMemberRole(workspace.role) && !isMine(user, task)) return null;
      return task;
    };

    // A voice message on a comment: an 'audio' asset this very user uploaded to this workspace.
    // Returns the id to store, null when none was sent, or an error message.
    const voiceMessage = async (): Promise<string | null | { error: string }> => {
      if (body.audio === undefined || body.audio === null || body.audio === '') return null;
      if (typeof body.audio !== 'string' || !/^[0-9a-f-]{36}$/.test(body.audio)) return { error: 'Message vocal invalide.' };
      const owned = await one<{ id: string }>(
        "SELECT id FROM assets WHERE id = $1 AND workspace_id = $2 AND kind = 'audio' AND created_by = $3",
        [body.audio, workspace.id, user.userId],
      );
      return owned ? body.audio : { error: 'Message vocal introuvable. Réenregistrez-le.' };
    };

    // Files in a message: 'file' assets this very user uploaded to this workspace, with the name they
    // had on the sender's device. Returns what to store on the comment, or an error message.
    const messageFiles = async (): Promise<Attachment[] | { error: string }> => {
      if (body.attachments === undefined || body.attachments === null) return [];
      if (!Array.isArray(body.attachments) || body.attachments.length > 10) return { error: 'Jusqu’à 10 fichiers par message.' };
      const wanted = body.attachments as { id?: unknown; name?: unknown }[];
      if (!wanted.every((a) => a && typeof a.id === 'string' && /^[0-9a-f-]{36}$/.test(a.id))) return { error: 'Fichier invalide.' };
      const ids = [...new Set(wanted.map((a) => a.id as string))];
      const found = await database().query<{ id: string; content_type: string; size: number }>(
        "SELECT id, content_type, size FROM assets WHERE id = ANY($1::text[]) AND workspace_id = $2 AND kind = 'file' AND created_by = $3",
        [ids, workspace.id, user.userId],
      );
      if (found.length !== ids.length) return { error: 'Fichier introuvable. Joignez-le à nouveau.' };
      return ids.map((id) => {
        const row = found.find((f) => f.id === id)!;
        const raw = wanted.find((a) => a.id === id)?.name;
        const name = (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\\/]+/g, ' ').trim().slice(0, 120) || (row.content_type === 'application/pdf' ? 'document.pdf' : 'fichier');
        return { id, name, type: row.content_type, size: Number(row.size) };
      });
    };

    const saveTask = async (before: RecordItem, after: RecordItem) => {
      const changed = await db.query(
        'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
        [JSON.stringify(after), before.id, workspace.id, before.revision],
      );
      return changed.length > 0;
    };

    const insert = (record: RecordItem, ignoreConflict = false) => {
      const statement = insertRecord(record, record.kind === 'event' ? 'system' : owner, workspace.id, ignoreConflict);
      return db.query(statement.text, statement.params);
    };

    // A client-portal member's profile picture always mirrors their client's logo. The logo's
    // bytes are copied into a fresh 'avatar' asset per member rather than shared, so replacing or
    // clearing the client's logo later (which drops that old asset) never orphans a member's avatar.
    const syncMemberAvatar = async (userId: string, logoAssetId: string | null | undefined) => {
      const current = (await db.query<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [userId]))[0];
      let avatarId: string | null = null;
      if (logoAssetId) {
        avatarId = crypto.randomUUID();
        const inserted = await db.query(
          `INSERT INTO assets (id, workspace_id, kind, content_type, size, bytes, created_by)
           SELECT $1, workspace_id, 'avatar', content_type, size, bytes, created_by FROM assets WHERE id = $2
           RETURNING id`,
          [avatarId, logoAssetId],
        );
        if (!inserted.length) avatarId = null;
      }
      await db.query('UPDATE users SET avatar = $2 WHERE id = $1', [userId, avatarId]);
      if (current?.avatar) await db.query('DELETE FROM assets WHERE id = $1 AND workspace_id = $2 AND kind = $3', [current.avatar, workspace.id, 'avatar']);
    };
    const syncClientAvatars = async (clientId: string, logoAssetId: string | null | undefined) => {
      const linked = await db.query<{ userId: string }>(
        'SELECT user_id AS "userId" FROM workspace_members WHERE workspace_id = $1 AND role = $2 AND client_id = $3',
        [workspace.id, 'client', clientId],
      );
      for (const { userId } of linked) await syncMemberAvatar(userId, logoAssetId);
    };

    // ----- membership -----

    const studioName = workspace.name;
    // The canonical address (AUTH_URL) if set, otherwise whichever origin served this request —
    // returned to the caller too, so the on-screen address and the PDF match what the e-mail says
    // rather than drifting to whatever domain the studio's browser happens to be on.
    const deliver = async (email: string, name: string, roleLabel: string, temporaryPassword: string, renewal: boolean) => {
      const url = signInUrl(req);
      const brand = await brandOf(workspace);
      const logoPng = await brandLogoPng(brand, workspace.id);
      const mail = await sendInvitation({ to: email, name, temporaryPassword, studio: studioName, url, roleLabel, renewal, ...(logoPng || isCompanyWorkspaceId(workspace.id) ? { logoPng } : {}) });
      // The temporary password is returned only when the studio has to pass it on by hand.
      return { email, sent: mail.sent, error: mail.error, temporaryPassword: mail.sent ? undefined : temporaryPassword, url };
    };

    // ----- the workspace's brand: name (a company's own workspace), logo, main colour -----
    if (body.action === 'set-brand') {
      if (!canManageMembers(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent changer la marque.' }, 403);
      if (isPrintWorkspaceId(workspace.id)) return response({ error: 'L’espace Impression garde la marque The One Print.' }, 400);
      const current = await brandOf(workspace);
      const next: Brand = { ...current };
      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!isCompanyWorkspaceId(workspace.id)) {
          if (name && name !== workspace.name) return response({ error: 'Le nom de l’espace du studio ne change pas.' }, 400);
        } else {
          if (name.length < 2 || name.length > 80) return response({ error: 'Nom de l’espace : de 2 à 80 caractères.' }, 400);
          await database().query('UPDATE workspaces SET name = $1, updated_at = now() WHERE id = $2', [name, workspace.id]);
          workspace.name = name; next.name = name;
        }
      }
      // A logo is the workspace's own upload; with it come its light-surface twin and its measured tone.
      const ownLogo = async (id: unknown) => typeof id === 'string' && id
        ? (await one<{ id: string }>("SELECT id FROM assets WHERE id = $1 AND workspace_id = $2 AND kind = 'logo'", [id, workspace.id]))?.id ?? null
        : null;
      if (body.logo !== undefined) {
        delete next.logo; delete next.logoLight; delete next.logoTone; delete next.logoOnDark;
        if (body.logo !== null && body.logo !== '') {
          const logo = await ownLogo(body.logo);
          if (!logo) return response({ error: 'Logo introuvable : envoyez-le à nouveau.' }, 400);
          next.logo = logo;
          if (body.logoLight) {
            const twin = await ownLogo(body.logoLight);
            if (!twin) return response({ error: 'Logo introuvable : envoyez-le à nouveau.' }, 400);
            next.logoLight = twin;
          }
          if (body.logoTone === 'dark' || body.logoTone === 'light') next.logoTone = body.logoTone;
        }
      }
      if (body.logoOnDark !== undefined) {
        if (!logoOnDarkModes.includes(body.logoOnDark)) return response({ error: 'Affichage du logo invalide.' }, 400);
        if (body.logoOnDark === 'auto') delete next.logoOnDark; else next.logoOnDark = body.logoOnDark;
      }
      if (body.color !== undefined) {
        if (body.color === null || body.color === '') delete next.color;
        else if (!isHexColor(body.color)) return response({ error: 'Couleur invalide.' }, 400);
        else next.color = (body.color as string).toLowerCase();
      }
      await database().query(
        `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
        [brandId(workspace.id), owner, workspace.id, JSON.stringify({ logo: next.logo ?? null, logoLight: next.logoLight ?? null, logoTone: next.logoTone ?? null, logoOnDark: next.logoOnDark ?? null, color: next.color ?? null })],
      );
      return result();
    }

    if (body.action === 'invite-member') {
      if (!canManageMembers(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent inviter.' }, 403);
      const parsed = inviteFields.safeParse(body);
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      const { email, role, name } = parsed.data;
      if (isOwnerEmail(email)) return response({ error: 'Cette adresse est celle du propriétaire.' }, 400);
      if (!invitableRolesFor(workspace.id).includes(role)) return response({ error: 'Ce rôle n’est pas proposé dans cet espace.' }, 400);
      // Trades can be picked right in the invitation; a client access never carries any.
      const inviteTitles = role === 'client' ? [] : cleanTitles(body.titles ?? []);
      if (!inviteTitles) return response({ error: `Jusqu’à ${titleLimits.count} métiers de ${titleLimits.length} caractères au plus.` }, 400);
      let clientId: string | null = null;
      let clientLogo: string | undefined;
      if (role === 'client') {
        const client = rowsNow.find((r) => r.kind === 'client' && r.id === parsed.data.clientId && !r.archived);
        if (!client) return response({ error: 'Choisissez un client actif pour cet accès portail.' }, 400);
        clientId = client.id;
        clientLogo = client.logo;
      }
      const duplicate = await one<{ userId: string }>(
        'SELECT user_id AS "userId" FROM workspace_members WHERE workspace_id = $1 AND lower(email) = $2', [workspace.id, email],
      );
      if (duplicate) return response({ error: 'Cette adresse est déjà membre de l’espace. Utilisez « Renvoyer l’invitation » pour un nouveau mot de passe temporaire.' }, 409);
      if (role !== 'client') {
        const full = await planRefusal(workspace.id, 'members');
        if (full) return response(full, full.status);
      }
      const attachMembership = (userId: string) => db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, client_id = EXCLUDED.client_id, name = COALESCE(EXCLUDED.name, workspace_members.name)`,
        [workspace.id, userId, role, name || null, email, clientId, now],
      );
      // Someone who already has an account (e.g. via another workspace, like a designer gaining
      // print-operator access too) just gets attached here — provisioning a fresh temporary password
      // would silently reset the one they already use and sign them out everywhere, which is exactly
      // wrong for a person who already knows how to log in.
      const existingAccount = await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
      if (existingAccount) {
        await attachMembership(existingAccount.id);
        if (inviteTitles.length) await storeTitles(workspace.id, existingAccount.id, inviteTitles, owner);
        if (role !== 'client' && parsed.data.whatsapp) await storeMemberWhatsapp(workspace.id, existingAccount.id, parsed.data.whatsapp, owner);
        if (role === 'client' && clientLogo) await syncMemberAvatar(existingAccount.id, clientLogo);
        const url = signInUrl(req);
        return response({ workspace, members: await members(workspace.id, true, user.userId), invitation: { email, sent: false, url } });
      }
      const account = await provisionAccount(db, email, name ?? '');
      await attachMembership(account.userId);
      if (inviteTitles.length) await storeTitles(workspace.id, account.userId, inviteTitles, owner);
      if (role !== 'client' && parsed.data.whatsapp) await storeMemberWhatsapp(workspace.id, account.userId, parsed.data.whatsapp, owner);
      if (role === 'client' && clientLogo) await syncMemberAvatar(account.userId, clientLogo);
      const invitation = await deliver(email, name ?? '', roleLabels[role], account.temporaryPassword, false);
      return response({ workspace, members: await members(workspace.id, true, user.userId), invitation });
    }

    if (body.action === 'create-print-workspace') {
      if (!isOwnerEmail(user.email)) return response({ error: 'Seul le propriétaire peut créer l’espace Impression.' }, 403);
      const printWorkspace = await ensurePrintWorkspace(owner, 'The One Print');
      // Full payload scoped to the new workspace (not `workspace`, the current request's context) —
      // same shape `result()` returns, so the client can drop straight into it, already switched.
      return response(await payload(printWorkspace, user));
    }

    if (body.action === 'renew-invitation') {
      if (!canManageMembers(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent renvoyer une invitation.' }, 403);
      const target = await one<WorkspaceMember>('SELECT user_id AS "userId", role, name, email FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId]);
      if (!target || !target.email) return response({ error: 'Membre introuvable.' }, 404);
      if (target.role === 'owner' || target.userId === user.userId) return response({ error: 'Le propriétaire change son mot de passe depuis son compte.' }, 400);
      // Renewing resets the person's password. An administrator can't do that to another
      // administrator, and never sees the temporary password: only the owner may be handed one to
      // pass on — otherwise the administrator could sign in as someone else.
      // Accounts are global: never reset the credential of someone who also belongs to another
      // workspace (the studio and its print twin excepted) — a manager here has no authority over them.
      const base = workspace.id.replace(/:print$/, '');
      const elsewhere = await one<{ workspaceId: string }>(
        'SELECT workspace_id AS "workspaceId" FROM workspace_members WHERE user_id = $1 AND workspace_id NOT IN ($2, $3) LIMIT 1',
        [target.userId, base, `${base}:print`],
      );
      if (elsewhere) return response({ error: 'Cette personne a un compte dans un autre espace : elle doit utiliser « Mot de passe oublié ».' }, 403);
      const byOwner = workspace.role === 'owner';
      if (!byOwner && target.role === 'admin') return response({ error: 'Seul le propriétaire peut renouveler l’accès d’un administrateur.' }, 403);
      if (!byOwner && !mailConfigured()) return response({ error: 'L’e-mail n’est pas configuré : seul le propriétaire peut renouveler un accès et transmettre le mot de passe temporaire.' }, 403);
      const account = await provisionAccount(db, target.email.toLowerCase(), target.name ?? '');
      const delivered = await deliver(target.email.toLowerCase(), target.name ?? '', roleLabels[target.role], account.temporaryPassword, true);
      const invitation = byOwner || delivered.sent ? delivered
        : { ...delivered, temporaryPassword: undefined, error: `${delivered.error ?? 'E-mail non envoyé.'} Demandez au propriétaire de renouveler l’accès.` };
      return response({ workspace, members: await members(workspace.id, true, user.userId), invitation });
    }

    if (body.action === 'remind-assignee-whatsapp') {
      if (!canManageMembers(workspace.role)) return response({ error: 'Seuls les responsables peuvent envoyer un rappel à l’assigné.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task) return response({ error: 'Tâche introuvable.' }, 404);
      if (task.status === 'Validé' || task.publishedAt) return response({ error: 'Cette tâche est terminée. Aucun rappel à envoyer.' }, 409);
      if (!task.assigneeId) return response({ error: 'Assignez cette tâche avant d’envoyer un rappel.' }, 409);
      if (body.revision !== task.revision) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
      const claimed = await db.query(
        `INSERT INTO records (id, owner, workspace_id, kind, data, revision)
         VALUES ($1, $2, $3, 'meta', jsonb_build_object('retryAfter', now() + interval '60 seconds'), 1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1
         WHERE records.workspace_id = EXCLUDED.workspace_id AND (records.data->>'retryAfter')::timestamptz <= now() RETURNING id`,
        [`whatsapp-assignee-reminder:${task.id}`, owner, workspace.id],
      );
      if (!claimed.length) return response({ error: 'Une demande WhatsApp vient d’être effectuée. Réessayez dans une minute.' }, 429);
      const whatsapp = await notifyTaskReminder(workspace.id, task, actor, new URL(req.url).origin);
      return result({ whatsapp });
    }

    if (body.action === 'retry-approval-whatsapp') {
      if (!canManageMembers(workspace.role)) return response({ error: 'Seuls les responsables peuvent renvoyer cette notification.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task || task.status !== 'À valider') return response({ error: 'Cette tâche n’est plus en attente de validation.' }, 409);
      if (body.revision !== task.revision) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
      // Atomic lease: double-clicks and concurrent requests send at most once in 60 seconds.
      const claim = `whatsapp-retry:${task.id}`;
      const claimed = await db.query(
        `INSERT INTO records (id, owner, workspace_id, kind, data, revision)
         VALUES ($1, $2, $3, 'meta', jsonb_build_object('retryAfter', now() + interval '60 seconds'), 1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1
         WHERE records.workspace_id = EXCLUDED.workspace_id AND (records.data->>'retryAfter')::timestamptz <= now() RETURNING id`,
        [claim, owner, workspace.id],
      );
      if (!claimed.length) return response({ error: 'Une demande WhatsApp vient d’être effectuée. Réessayez dans une minute.' }, 429);
      const whatsapp = await notifyTaskApproval(workspace.id, task, rowsNow, new URL(req.url).origin);
      return result({ whatsapp });
    }

    if (body.action === 'set-member-whatsapp') {
      if (!canManageMembers(workspace.role) && (body.userId !== user.userId || workspace.role === 'client')) return response({ error: 'Seuls les responsables peuvent modifier le numéro d’un autre membre.' }, 403);
      if (typeof body.userId !== 'string' || !body.userId || body.userId.length > 200) return response({ error: 'Identifiant de membre invalide.' }, 400);
      const number = whatsappNumber.safeParse(body.whatsapp);
      if (!number.success) return response({ error: number.error.issues[0].message }, 400);
      const target = await one<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId]);
      if (!target) return response({ error: 'Membre introuvable.' }, 404);
      if (target.role === 'client') return response({ error: 'Le numéro WhatsApp du client se modifie depuis sa fiche client.' }, 400);
      await storeMemberWhatsapp(workspace.id, body.userId, number.data, owner);
      return result();
    }

    if (body.action === 'set-member-titles') {
      if (!canManageMembers(workspace.role)) {
        return response({ error: 'Seuls le propriétaire et les administrateurs peuvent attribuer les métiers.' }, 403);
      }
      if (typeof body.userId !== 'string' || !body.userId || body.userId.length > 200) return response({ error: 'Identifiant de membre invalide.' }, 400);
      const titles = cleanTitles(body.titles);
      if (!titles) return response({ error: `Jusqu’à ${titleLimits.count} métiers de ${titleLimits.length} caractères au plus.` }, 400);
      const target = await one<Pick<WorkspaceMember, 'role'>>(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId],
      );
      if (!target) return response({ error: 'Membre introuvable.' }, 404);
      if (target.role === 'client') return response({ error: 'Un accès client n’a pas de métier.' }, 400);
      await storeTitles(workspace.id, body.userId, titles, owner);
      return response({ workspace, members: await members(workspace.id, true, user.userId) });
    }

    // « Accès Impression »: a person already in the studio gets a role in the print workspace (or loses
    // it) without a new invitation — same account, same password, one more workspace in their switcher.
    if (body.action === 'set-print-access') {
      if (isPrintWorkspaceId(workspace.id) || !canManageMembers(workspace.role)) {
        return response({ error: 'Seuls le propriétaire et les administrateurs peuvent gérer les accès.' }, 403);
      }
      if (typeof body.userId !== 'string' || !body.userId || body.userId.length > 200) return response({ error: 'Identifiant de membre invalide.' }, 400);
      const printRole = body.role === null ? null : body.role === 'print_operator' || body.role === 'admin' ? body.role as WorkspaceRole : undefined;
      if (printRole === undefined) return response({ error: 'Rôle invalide.' }, 400);
      const printId = `${workspace.id}:print`;
      if (!(await one('SELECT 1 FROM workspaces WHERE id = $1', [printId]))) return response({ error: 'L’espace Impression n’existe pas encore.' }, 404);
      const actorPrint = await one<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [printId, user.userId]);
      if (!actorPrint || !isWorkspaceRole(actorPrint.role) || !isManager(actorPrint.role)) {
        return response({ error: 'Seuls les responsables de l’espace Impression donnent cet accès.' }, 403);
      }
      const target = await one<{ role: string; name: string | null; email: string | null }>(
        'SELECT role, name, email FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId],
      );
      if (!target) return response({ error: 'Membre introuvable.' }, 404);
      if (target.role === 'client') return response({ error: 'Un accès client ne peut pas recevoir l’accès Impression.' }, 400);
      if (target.role === 'owner' || body.userId === user.userId) return response({ error: 'Vous ne pouvez pas modifier cet accès.' }, 400);
      const current = await one<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [printId, body.userId]);
      if (current?.role === 'owner') return response({ error: 'Le propriétaire ne peut pas être modifié ou retiré.' }, 400);
      if (printRole) {
        await db.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, $2, $3, $4, $5, NULL, $6)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, client_id = NULL`,
          [printId, body.userId, printRole, target.name, target.email, now],
        );
      } else {
        await db.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role != $3', [printId, body.userId, 'owner']);
        await db.query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [titlesId(printId, body.userId), printId]);
        await storeMemberWhatsapp(printId, body.userId, '', owner);
      }
      return response({ workspace, members: await members(workspace.id, true, user.userId) });
    }

    if (body.action === 'set-member-role' || body.action === 'remove-member') {
      if (!canManageMembers(workspace.role)) {
        return response({ error: 'Seuls le propriétaire et les administrateurs peuvent gérer les membres.' }, 403);
      }
      if (typeof body.userId !== 'string' || !body.userId || body.userId !== body.userId.trim() || body.userId.length > 200) {
        return response({ error: 'Identifiant de membre invalide.' }, 400);
      }
      if (body.action === 'set-member-role' && (!isWorkspaceRole(body.role) || body.role === 'owner')) {
        return response({ error: 'Rôle invalide.' }, 400);
      }
      if (body.action === 'set-member-role' && !invitableRolesFor(workspace.id).includes(body.role) && body.role !== 'viewer') {
        return response({ error: 'Ce rôle n’est pas proposé dans cet espace.' }, 400);
      }
      if (!isWorkspaceRole(body.expectedRole)) return response({ error: 'Actualisez la liste des membres avant de réessayer.' }, 400);
      let clientId: string | null = null;
      let clientLogo: string | undefined;
      if (body.action === 'set-member-role' && body.role === 'client') {
        const client = rowsNow.find((r) => r.kind === 'client' && r.id === body.clientId && !r.archived);
        if (!client) return response({ error: 'Choisissez un client actif pour cet accès portail.' }, 400);
        clientId = client.id;
        clientLogo = client.logo;
      }
      const existing = await one<Pick<WorkspaceMember, 'role'>>(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspace.id, body.userId],
      );
      if (!existing) return response({ error: 'Membre introuvable.' }, 404);
      if (existing.role === 'owner') return response({ error: 'Le propriétaire ne peut pas être modifié ou retiré.' }, 400);
      if (body.userId === user.userId) return response({ error: 'Vous ne pouvez pas modifier votre propre accès.' }, 400);
      // An administrator can't change or remove another administrator: only the owner may.
      if (workspace.role !== 'owner' && existing.role === 'admin') return response({ error: 'Seul le propriétaire peut modifier ou retirer un administrateur.' }, 403);
      if (body.action === 'set-member-role' && existing.role === 'client' && body.role !== 'client') {
        const full = await planRefusal(workspace.id, 'members');
        if (full) return response(full, full.status);
      }
      // Check both the target's current role and the actor's authority in the write itself.
      const condition = `workspace_id = $1 AND user_id = $2 AND role = $3 AND role != 'owner'
        AND EXISTS (SELECT 1 FROM workspace_members actor
                    WHERE actor.workspace_id = $1 AND actor.user_id = $4 AND actor.role IN ('owner','admin'))`;
      const values = [workspace.id, body.userId, body.expectedRole, user.userId];
      const changed = body.action === 'set-member-role'
        ? await db.query(`UPDATE workspace_members SET role = $5, client_id = $6 WHERE ${condition} RETURNING user_id`, [...values, body.role, clientId])
        : await db.query(`DELETE FROM workspace_members WHERE ${condition} RETURNING user_id`, values);
      if (!changed.length) return response({ error: 'Les accès ont changé. Actualisez la liste avant de réessayer.' }, 409);
      // Job titles belong to studio members: they go with the person, and with a switch to a client access.
      if (body.action === 'remove-member' || body.role === 'client') {
        await db.query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [titlesId(workspace.id, body.userId), workspace.id]);
        await storeMemberWhatsapp(workspace.id, body.userId, '', owner);
      }
      if (body.action === 'set-member-role' && body.role === 'client' && clientLogo) await syncMemberAvatar(body.userId, clientLogo);
      // A client access never works in the print workspace: one given from here goes with the switch.
      // Removing someone from the studio also removes them from its print twin.
      if ((body.action === 'remove-member' || (body.action === 'set-member-role' && body.role === 'client')) && !isPrintWorkspaceId(workspace.id)) {
        await db.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role != 'owner'", [`${workspace.id}:print`, body.userId]);
      }
      const refreshedWorkspace = await workspaceFor(user, workspace.id);
      return response({ workspace: refreshedWorkspace, members: await members(workspace.id, true, user.userId) });
    }


    // ----- the single channel -----

    if (body.action === 'chat-receipt') {
      const visible = visibleTo(workspace, rowsNow, user);
      const task = visible.find(r => r.id === body.taskId && (r.kind === 'task' || r.kind === 'plan_item'));
      if (!task || task.archived || rowsNow.some(r => (r.id === task.clientId || r.id === task.projectId) && r.archived)) return response({ error: 'Tâche introuvable.' }, 404);
      const validIds = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 200 && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 300);
      if (!validIds(body.delivered) || !validIds(body.seen)) return response({ error: 'Accusé de réception invalide.' }, 400);
      const delivered = [...new Set<string>([...body.delivered, ...body.seen])], seen = [...new Set<string>(body.seen)];
      if (delivered.some(id => !visible.some(r => r.kind === 'comment' && r.id === id && r.taskId === task.id))) return response({ error: 'Message introuvable.' }, 404);
      // A workspace viewer can browse a task without falsely acknowledging it for its actual people.
      if (!taskMentionCandidates(task, await members(workspace.id)).some(p => p.userId === user.userId)) return response({ received: true });
      // Merge receipts atomically into the current JSON, never a stale comment snapshot. Self-reads,
      // tombstones and repeated acknowledgements cannot change a receipt or its server timestamp.
      await db.query(`UPDATE records SET data = data || jsonb_build_object('deliveredAt', COALESCE(data->>'deliveredAt', $5))
        || CASE WHEN id = ANY($4::text[]) THEN jsonb_build_object('seenAt', COALESCE(data->>'seenAt', GREATEST(data->>'deliveredAt', $5))) ELSE '{}'::jsonb END,
        revision = revision + 1
        WHERE workspace_id = $1 AND kind = 'comment' AND data->>'taskId' = $2 AND id = ANY($3::text[])
        AND data->>'authorId' IS DISTINCT FROM $6 AND NOT (data ? 'deletedAt')
        AND (NOT (data ? 'deliveredAt') OR (id = ANY($4::text[]) AND NOT (data ? 'seenAt')))`, [workspace.id, task.id, delivered, seen, now, user.userId]);
      return response({ received: true });
    }

    if (body.action === 'comment') {
      if (workspace.role === 'viewer') return response({ error: 'Votre rôle est en lecture seule.' }, 403);
      // A plan idea not yet sent to the tasks has a comment thread too (lib/content-plan-server.ts);
      // a client reaches it only once its plan is shared.
      const idea = findTask(rowsNow, body.taskId, 'plan_item');
      const task = findTask(rowsNow, body.taskId) ?? (idea && (workspace.role !== 'client' || idea.planShared) ? idea : null);
      if (!task) return response({ error: 'Tâche introuvable.' }, 404);
      if (workspace.role === 'client' && !portalView(rowsNow, workspace.clientId!, user.userId).some(r => r.id === task.id)) return response({ error: 'Tâche introuvable.' }, 404);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const people = body.mentions !== undefined ? taskMentionCandidates(task, await members(workspace.id)) : [];
      const mentions = validateMentions(body.mentions, text, people);
      if (!Array.isArray(mentions)) return response(mentions, 400);
      const voice = await voiceMessage();
      if (voice && typeof voice === 'object') return response(voice, 400);
      const files = await messageFiles();
      if (!Array.isArray(files)) return response(files, 400);
      // A reply quotes one earlier message of this same conversation, one the sender can see.
      let replyTo: string | undefined;
      if (body.replyTo !== undefined && body.replyTo !== null && body.replyTo !== '') {
        if (typeof body.replyTo !== 'string' || body.replyTo.length > 200) return response({ error: 'Message à citer introuvable.' }, 400);
        const quoted = visibleTo(workspace, rowsNow, user).find((r) => r.kind === 'comment' && r.id === body.replyTo && r.taskId === task.id);
        if (!quoted) return response({ error: 'Message à citer introuvable.' }, 400);
        replyTo = quoted.id;
      }
      if ((!text && !voice && !files.length) || text.length > 5000) {
        return response({ error: 'Écrivez un message de 1 à 5 000 caractères, enregistrez un message vocal ou joignez un fichier.' }, 400);
      }
      if (body.submissionId !== undefined && (typeof body.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId))) return response({ error: 'Identifiant de message invalide.' }, 400);
      const comment: RecordItem = {
        id: body.submissionId ? `chat:${workspace.id}:${user.userId}:${body.submissionId}` : crypto.randomUUID(), kind: 'comment', revision: 1, name: text, taskId: task.id,
        clientId: task.clientId, author: actor, authorId: user.userId, createdAt: now,
        ...(voice ? { audio: voice } : {}),
        ...(files.length ? { attachments: files } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(workspace.role === 'client' ? { audience: 'client' as const } : {}),
      };

      const reply = (saved: RecordItem) => compactComment
        ? response({ message: visibleTo(workspace, [...rowsNow.filter(r => r.id !== saved.id), saved], user).find(r => r.id === saved.id) })
        : result();
      const previous = rowsNow.find(r => r.id === comment.id && r.kind === 'comment');
      if (previous) {
        if (previous.taskId !== task.id || previous.authorId !== user.userId || (!previous.deletedAt && (previous.name !== comment.name || previous.audio !== comment.audio || JSON.stringify(previous.attachments ?? []) !== JSON.stringify(comment.attachments ?? []) || JSON.stringify(previous.mentions ?? []) !== JSON.stringify(comment.mentions ?? []) || previous.replyTo !== comment.replyTo))) return response({ error: 'Ce message a déjà été envoyé avec un autre contenu.' }, 409);
        return reply(previous);
      }

      const statements: Statement[] = [insertRecord(comment, owner, workspace.id)];

      // Who this comment is actually for: the task's assignee plus everyone who's already
      // commented on it — never the person who just wrote it.
      const priorAuthorIds = rowsNow
        .filter((r): r is RecordItem & { authorId: string } => r.kind === 'comment' && r.taskId === task.id && !!r.authorId)
        .map((r) => r.authorId);
      // A client's message always reaches the studio's owner too: owner, client and assignee share the thread.
      const studioOwner = workspace.role === 'client'
        ? (await one<{ userId: string }>("SELECT user_id AS \"userId\" FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'", [workspace.id]))?.userId
        : undefined;
      const mentionIds = [...new Set(mentions.map(m => m.userId))].filter(id => id !== user.userId);
      const recipients = [...new Set([task.assigneeId, studioOwner, ...priorAuthorIds].filter((id): id is string => !!id && id !== user.userId && !mentionIds.includes(id)))];
      const preview = text
        ? `${actor} a commenté : « ${text.substring(0, 30)}${text.length > 30 ? '...' : ''} » sur la tâche « ${task.name} ».`
        : files.length
          ? `${actor} a envoyé ${files.length > 1 ? `${files.length} fichiers` : `« ${files[0].name} »`} sur la tâche « ${task.name} ».`
          : `${actor} a laissé un message vocal sur la tâche « ${task.name} ».`;

      if (workspace.role === 'client') {
        // The client's own comment: notify studio, targeted at whoever's actually on this task.
        if (recipients.length) statements.push(insertRecord({
          id: `evt:${task.id}:comment:${comment.id}`, kind: 'event', revision: 1, type: 'comment', audience: 'studio',
          name: preview, taskId: task.id, clientId: task.clientId, createdAt: now, recipients, readBy: [],
        }, 'system', workspace.id, true));
      } else {
        // The client still hears about every studio comment (unchanged, broadcast). Teammates on
        // this task now also get a targeted notification, which didn't exist before at all.
        statements.push(insertRecord({
          id: `evt:${task.id}:comment:${comment.id}`, kind: 'event', revision: 1, type: 'comment', audience: 'client',
          name: preview, taskId: task.id, clientId: task.clientId, createdAt: now,
        }, 'system', workspace.id, true));
        if (recipients.length) statements.push(insertRecord({
          id: `evt:${task.id}:comment:studio:${comment.id}`, kind: 'event', revision: 1, type: 'comment', audience: 'studio',
          name: preview, taskId: task.id, clientId: task.clientId, createdAt: now, recipients, readBy: [],
        }, 'system', workspace.id, true));
      }

      for (const recipient of mentionIds) {
        const person = people.find(p => p.userId === recipient)!;
        statements.push(insertRecord({
          id: `evt:${task.id}:mention:${comment.id}:${recipient}`, kind: 'event', revision: 1, type: 'comment',
          audience: person.role === 'client' ? 'client' : 'studio', recipients: [recipient], readBy: [],
          name: `${actor} vous a mentionné sur la tâche « ${task.name} ».`,
          taskId: task.id, clientId: task.clientId, createdAt: now,
        }, 'system', workspace.id, true));
      }

      const inserted = await db.transaction(async tx => {
        const first = insertRecord(comment, owner, workspace.id, true);
        if (!(await tx.query(first.text + ' RETURNING id', first.params)).length) return false;
        for (const statement of statements.slice(1)) await tx.query(statement.text, statement.params);
        return true;
      });
      if (!inserted) {
        const stored = await loadTaskThread(workspace.id, task.id, workspace.clientId);
        const saved = stored.find(r => r.id === comment.id && r.kind === 'comment');
        if (!saved || saved.taskId !== task.id || saved.authorId !== user.userId || (!saved.deletedAt && (saved.name !== comment.name || saved.audio !== comment.audio || JSON.stringify(saved.attachments ?? []) !== JSON.stringify(comment.attachments ?? []) || JSON.stringify(saved.mentions ?? []) !== JSON.stringify(comment.mentions ?? []) || saved.replyTo !== comment.replyTo))) return response({ error: 'Ce message a déjà été envoyé avec un autre contenu.' }, 409);
        return reply(saved);
      }

      // The client hears on WhatsApp that the studio wrote to them (when the « nouveau message » template
      // is set up and their file has a number) — once per task every 2 hours, not at every message.
      if (workspace.role !== 'client' && messageNoticeConfigured()) {
        const taskClient = rowsNow.find((r) => r.kind === 'client' && r.id === task.clientId && !r.archived);
        const since = new Date(Date.now() - 2 * 3600_000).toISOString();
        const recent = rowsNow.some((r) => r.kind === 'event' && r.type === 'whatsapp' && r.taskId === task.id && r.id.includes(':whatsapp-message:') && r.createdAt >= since && r.name.startsWith('WhatsApp envoyé'));
        if (taskClient?.whatsapp && !recent) {
          const url = signInUrl(req);
          after(async () => {
            try {
              // Recheck the cooldown: the compact send does not load the workspace's activity feed.
              const last = await db.query(`SELECT id FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'taskId' = $2 AND data->>'type' = 'whatsapp' AND id LIKE '%:whatsapp-message:%' AND data->>'createdAt' >= $3 AND starts_with(data->>'name', 'WhatsApp envoyé') LIMIT 1`, [workspace.id, task.id, since]);
              if (last.length) return;
              const sent = await sendMessageNotice({ to: taskClient.whatsapp!, clientName: taskClient.name, from: actor, taskName: task.name, url });
              await insert({
                id: `evt:${task.id}:whatsapp-message:${comment.id}`, kind: 'event', revision: 1, type: 'whatsapp', audience: 'studio',
                name: sent.sent ? `WhatsApp envoyé à ${taskClient.name} : nouveau message sur « ${task.name} ».` : `WhatsApp non envoyé à ${taskClient.name} pour le message sur « ${task.name} » — ${sent.error}`,
                taskId: task.id, clientId: taskClient.id, createdAt: new Date().toISOString(),
              }, true);
            } catch (error) { console.error('chat WhatsApp notice', error); }
          });
        }
      }
      return reply(comment);
    }

    // Deleting a message: the owner and admins only. The bubble stays, as « Message supprimé » with who
    // removed it and when, so the thread still reads right; its text, voice note and files are gone.
    if (body.action === 'comment-delete') {
      if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs suppriment des messages.' }, 403);
      const comment = rowsNow.find((r) => r.kind === 'comment' && r.id === body.id);
      if (!comment) return response({ error: 'Message introuvable.' }, 404);
      if (comment.deletedAt) return result();
      const files = [comment.audio, ...(comment.attachments ?? []).map((a) => a.id)].filter((id): id is string => !!id);
      const { audio, attachments, mentions, ...kept } = comment;
      void audio; void attachments; void mentions;
      if (!(await saveTask(comment, { ...kept, name: '', deletedAt: now, deletedBy: actor }))) return response({ error: 'Ce message a changé. Actualisez avant de réessayer.' }, 409);
      if (files.length) await db.query("DELETE FROM assets WHERE workspace_id = $1 AND kind IN ('audio', 'file') AND id = ANY($2::text[])", [workspace.id, files]);
      // Notification events created for this message carry a preview of its text: redact it too.
      await db.query(
        "UPDATE records SET data = jsonb_set(data, '{name}', to_jsonb($3::text)) WHERE workspace_id = $1 AND kind = 'event' AND id LIKE 'evt:%' AND strpos(id, $2) > 0 AND (id LIKE '%:comment:%' OR id LIKE '%:mention:%' OR id LIKE '%:whatsapp-message:%')",
        [workspace.id, comment.id, 'Message supprimé.'],
      );
      return result();
    }

    // ----- validation: explicit approval, request for changes, publication -----

    if (body.action === 'approve') {
      // Same rule as the update path: only the client, the owner or an administrator may validate.
      if (workspace.role !== 'client' && !isManager(workspace.role)) return response({ error: 'Seuls le client, le propriétaire ou un administrateur peuvent valider un livrable.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task) return response({ error: 'Livrable introuvable.' }, 404);
      if (task.status !== 'À valider') return response({ error: 'Ce livrable n’est pas en attente de validation.' }, 409);
      const mode = workspace.role === 'client' ? 'explicit' : 'studio';
      const approved = approve(task, { mode, by: actor, email: user.email, at: now, round: task.revisionRound ?? 0 });
      if (!(await saveTask(task, approved))) return response({ error: 'Ce livrable a changé. Actualisez avant de réessayer.' }, 409);
      await insert({ id: `evt:${task.id}:decision:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
        name: `« ${task.name} » validé par ${actor}${mode === 'studio' ? ' (depuis le studio)' : ''}.`, taskId: task.id, clientId: task.clientId, createdAt: now }, true);
      const approvedClient = rowsNow.find((r) => r.kind === 'client' && r.id === task.clientId)?.name;
      after(() => notifyOwnerOfApproval(workspace.id, approved, new URL(req.url).origin, approvedClient));
      if (mode === 'explicit') after(() => notifyTaskApprovedByClient(workspace.id, approved, approvedClient || actor, new URL(req.url).origin));
      return result({ id: task.id });
    }

    if (body.action === 'request-changes') {
      if (workspace.role !== 'client' && !isManager(workspace.role)) return response({ error: 'Seuls le client, le propriétaire ou un administrateur peuvent demander des modifications.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task) return response({ error: 'Livrable introuvable.' }, 404);
      if (task.status !== 'À valider') return response({ error: 'Ce livrable n’est pas en attente de validation.' }, 409);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const voice = await voiceMessage();
      if (voice && typeof voice === 'object') return response(voice, 400);
      if ((!text && !voice) || text.length > 5000) {
        return response({ error: 'Précisez les modifications demandées (1 à 5 000 caractères), ou enregistrez un message vocal.' }, 400);
      }
      const settings = taskWorkflowSettings(task);
      if (task.clientId && (task.revisionRound || 0) >= settings.maxRevisionRounds) {
        const request: RecordItem = { id: crypto.randomUUID(), kind: 'request', revision: 1, name: `Tour supplémentaire : ${task.name}`.slice(0, 160), clientId: task.clientId, projectId: task.projectId,
          due: task.due, description: text || 'Retours vocaux dans la conversation du livrable.', requestStatus: 'new', revisionTaskId: task.id, commercialTreatment: 'extra', scopeFormat: 'other', scopeUnits: 1,
          request: { by: actor, email: user.email, at: now }, createdAt: now };
        const changedTask: RecordItem = { ...stopClocks(task, now), status: 'En pause', approvalDueAt: undefined, pendingExtraRequestId: request.id,
          history: [...(task.history || []), { text: 'Tour hors forfait : en attente de devis et d’accord explicite.', date: now }].slice(-100) };
        await db.transaction(async tx => {
          const saved = await tx.query('UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id', [JSON.stringify(changedTask), task.id, workspace.id, task.revision]);
          if (!saved.length) throw new CommercialError('Ce livrable a changé. Actualisez avant de réessayer.');
          for (const statement of [insertRecord(request, owner, workspace.id), insertRecord({ id: crypto.randomUUID(), kind: 'comment', revision: 1, name: `[Tour hors forfait demandé] ${text}`, taskId: task.id, clientId: task.clientId, author: actor, authorId: user.userId, createdAt: now, ...(voice ? { audio: voice } : {}), ...(workspace.role === 'client' ? { audience: 'client' as const } : {}) }, owner, workspace.id),
            insertRecord({ id: `evt:${request.id}:request`, kind: 'event', revision: 1, type: 'request', audience: 'studio', requestId: request.id, taskId: task.id, clientId: task.clientId, name: `Tour hors forfait demandé sur « ${task.name} » : chiffrer avant de reprendre.`, createdAt: now }, 'system', workspace.id, true)]) await tx.query(statement.text, statement.params);
        });
        after(async () => { await notifyTaskChanges(workspace.id, changedTask, rowsNow.find(r => r.kind === 'client' && r.id === task.clientId)?.name || actor, new URL(req.url).origin); });
        return result({ id: task.id, extraRequestId: request.id });
      }
      const changedTask = requestChanges(task, actor, now);
      const round = changedTask.revisionRound!;
      const tag = round > settings.maxRevisionRounds ? `Retours client — tour ${round} · hors forfait` : `Retours client — tour ${round}`;
      const comment: RecordItem = { id: crypto.randomUUID(), kind: 'comment', revision: 1, name: text ? `[${tag}] ${text}` : `[${tag}]`, taskId: task.id,
        clientId: task.clientId, author: actor, authorId: user.userId, createdAt: now, ...(voice ? { audio: voice } : {}),
        ...(workspace.role === 'client' ? { audience: 'client' as const } : {}) };
      const event: RecordItem = { id: `evt:${task.id}:round:${round}:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
        name: `${tag} sur « ${task.name} » (${actor}).`, taskId: task.id, clientId: task.clientId, createdAt: now };
      await db.transaction(async tx => {
        const saved = await tx.query('UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id', [JSON.stringify(changedTask), task.id, workspace.id, task.revision]);
        if (!saved.length) throw new CommercialError('Ce livrable a changé. Actualisez avant de réessayer.');
        for (const statement of [insertRecord(comment, owner, workspace.id), insertRecord(event, 'system', workspace.id, true)]) await tx.query(statement.text, statement.params);
      });
      after(async () => { await notifyTaskChanges(workspace.id, changedTask, rowsNow.find(r => r.kind === 'client' && r.id === task.clientId)?.name || actor, new URL(req.url).origin); });
      return result({ id: task.id });
    }

    if (body.action === 'publish') {
      if (!canWrite(workspace.role)) return response({ error: 'Votre rôle ne peut pas publier.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task) return response({ error: 'Tâche introuvable.' }, 404);
      if (task.publishable === false) return response({ error: 'Cette tâche est un travail interne, elle ne se publie pas.' }, 409);
      if (task.status !== 'Validé') return response({ error: 'Un contenu se publie une fois validé.' }, 409);
      if (task.publishedAt) return response({ error: 'Déjà publié.' }, 409);
      const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
      const publishedAt = day ? new Date(`${day}T12:00:00.000Z`).toISOString() : now;
      const after = publish(task, publishedAt, actor);
      if (!(await saveTask(task, after))) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
      return result({ id: task.id });
    }

    // ----- time tracking: per-person, at most one running clock per user across the workspace -----

    if (body.action === 'start-timer' || body.action === 'stop-timer') {
      if (!canWrite(workspace.role)) return response({ error: 'Votre rôle ne peut pas suivre le temps.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task) return response({ error: 'Tâche introuvable.' }, 404);
      const entries = task.timeEntries || [];
      const myOpenIndex = entries.findIndex((e) => e.userId === user.userId && !e.end);

      if (body.action === 'stop-timer') {
        if (myOpenIndex === -1) return response({ error: 'Aucun chronomètre en cours pour cette tâche.' }, 409);
        const after = { ...task, timeEntries: entries.map((e, i) => (i === myOpenIndex ? { ...e, end: now } : e)) };
        if (!(await saveTask(task, after))) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
        return result({ id: task.id });
      }

      if (myOpenIndex !== -1) return response({ error: 'Le chronomètre est déjà en cours pour cette tâche.' }, 409);
      if (task.status !== 'En cours') return response({ error: 'Le chronomètre ne tourne que sur une tâche « En cours ».' }, 409);
      const newEntry = { userId: user.userId, name: actor, start: now };
      // Nobody runs two clocks at once: find any other task where this user's clock is still running.
      const otherOpenTask = rowsNow.find(
        (r) => r.kind === 'task' && r.id !== task.id && r.timeEntries?.some((e) => e.userId === user.userId && !e.end),
      );
      if (!otherOpenTask) {
        const after = { ...task, timeEntries: [...entries, newEntry] };
        if (!(await saveTask(task, after))) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
        return result({ id: task.id });
      }
      // Two records change together here, so `saveTask` (built for one) doesn't apply — close the
      // other task's clock and open this one's in a single transaction, exactly like the task-delete
      // cascade above: either both writes land, or neither does.
      const otherEntries = otherOpenTask.timeEntries || [];
      const otherOpenIndex = otherEntries.findIndex((e) => e.userId === user.userId && !e.end);
      const otherAfter = { ...otherOpenTask, timeEntries: otherEntries.map((e, i) => (i === otherOpenIndex ? { ...e, end: now } : e)) };
      const taskAfter = { ...task, timeEntries: [...entries, newEntry] };
      const ok = await db.transaction(async (tx) => {
        const closedOther = await tx.query(
          'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
          [JSON.stringify(otherAfter), otherOpenTask.id, workspace.id, otherOpenTask.revision],
        );
        if (!closedOther.length) return false;
        const openedThis = await tx.query(
          'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
          [JSON.stringify(taskAfter), task.id, workspace.id, task.revision],
        );
        return openedThis.length > 0;
      });
      if (!ok) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
      return result({ id: task.id });
    }

    // ----- meetings (lib/meetings.ts): planned by the owner, admins and social media managers -----

    if (body.action === 'meeting-save') {
      if (!canPlanMeetings(workspace.role)) return response({ error: 'Seuls le propriétaire, les administrateurs et les social media managers planifient les réunions.' }, 403);
      const fields = meetingFields(body.data);
      if ('error' in fields) return response(fields, 400);
      const client = fields.clientId ? rowsNow.find((r) => r.kind === 'client' && r.id === fields.clientId && !r.archived) : undefined;
      if (fields.clientId && !client) return response({ error: 'Client introuvable.' }, 404);
      const roster = await members(workspace.id);
      const studio = roster.filter((m) => m.role !== 'client');
      if (fields.attendees.some((id) => !studio.some((m) => m.userId === id))) return response({ error: 'Invitez des membres de l’équipe de cet espace.' }, 400);
      const existing = body.id ? rowsNow.find((r) => r.kind === 'meeting' && r.id === body.id) : undefined;
      if (body.id && !existing) return response({ error: 'Réunion introuvable.' }, 404);
      if (existing && !canManageMeeting(existing, { role: workspace.role, userId: user.userId })) return response({ error: 'Réunion introuvable.' }, 404);
      if (!existing && meetingCapReached(rowsNow)) return response({ error: 'Votre espace a atteint 200 réunions : annulez ou supprimez-en avant d’en planifier.' }, 403);
      if (existing && existing.revision !== body.revision) return response({ error: 'Cette réunion a changé. Actualisez avant de réessayer.' }, 409);
      if (existing?.cancelledAt) return response({ error: 'Cette réunion est annulée.' }, 400);
      if (existing?.endedAt) return response({ error: 'Cette réunion est terminée.' }, 400);
      const attendees = fields.attendees.filter((id) => id !== user.userId);
      const meeting: RecordItem = {
        ...(existing ?? { id: crypto.randomUUID(), kind: 'meeting' as const, revision: 1, createdAt: now, authorId: user.userId, author: actor }),
        name: fields.name, clientId: client?.id, due: fields.due, time: fields.time, duration: fields.duration, callMode: fields.callMode,
        attendees, attendeeNames: [actor, ...attendees.map((id) => memberName(studio.find((m) => m.userId === id)!))],
        description: fields.description, link: fields.link || undefined,
      };
      if (existing) {
        if (!(await saveTask(existing, meeting))) return response({ error: 'Cette réunion a changé. Actualisez avant de réessayer.' }, 409);
      } else await insert(meeting);
      // Who is told: the team members invited (bell), and the client (portal feed, and e-mail when set up).
      const when = `${fields.due.split('-').reverse().join('/')} à ${fields.time}`;
      const what = `${fields.callMode === 'audio' ? 'Appel audio' : 'Réunion vidéo'} « ${fields.name} »`;
      const newAttendees = attendees.filter((id) => !existing?.attendees?.includes(id));
      const moved = !!existing && (existing.due !== meeting.due || existing.time !== meeting.time);
      const notified = existing ? (moved ? attendees : newAttendees) : attendees;
      const statements: Statement[] = [];
      if (notified.length) statements.push(insertRecord({
        id: `evt:${meeting.id}:meeting:${now}`, kind: 'event', revision: 1, type: 'meeting', audience: 'studio', meetingId: meeting.id, clientId: client?.id,
        name: `${actor} ${moved ? 'a déplacé' : 'vous invite à'} ${what}${client ? ` avec ${client.name}` : ''} — ${when}.`, createdAt: now, recipients: notified, readBy: [],
      }, 'system', workspace.id, true));
      if (client && (!existing || moved)) statements.push(insertRecord({
        id: `evt:${meeting.id}:meeting-client:${now}`, kind: 'event', revision: 1, type: 'meeting', audience: 'client', meetingId: meeting.id, clientId: client.id,
        name: `${moved ? 'Nouvel horaire' : 'Nouvelle réunion'} : ${what} — ${when}.`, createdAt: now,
      }, 'system', workspace.id, true));
      if (statements.length) await batch(db, statements);
      if (client && (!existing || moved) && body.emailClient !== false && mailConfigured()) {
        const emails = (await db.query<{ email: string | null }>('SELECT email FROM workspace_members WHERE workspace_id = $1 AND role = $2 AND client_id = $3', [workspace.id, 'client', client.id]))
          .map((m) => m.email?.trim()).filter((e): e is string => !!e);
        if (emails.length) await sendClientNotice({ to: [...new Set(emails)], clientName: client.name, studio: studioName, url: signInUrl(req), pendingTasks: [],
          news: `${what} — ${when} (${fields.duration} min, heure du Maroc). Rejoignez-la depuis votre espace, onglet « Réunions ».` });
      }
      return result({ id: meeting.id });
    }

    if (body.action === 'meeting-end') {
      if (!canPlanMeetings(workspace.role)) return response({ error: 'Seuls les organisateurs peuvent terminer la réunion.' }, 403);
      const failure = await db.transaction(async (tx) => {
        const meeting = await lockedMeeting(tx, workspace.id, body.id);
        if (!meeting || !canManageMeeting(meeting, { role: workspace.role, userId: user.userId })) return { error: 'Réunion introuvable.', status: 404 };
        if (meeting.cancelledAt) return { error: 'Cette réunion a été annulée.', status: 409 };
        if (meeting.endedAt) return null;
        if (!meeting.link) {
          const closed = await finishRoom(meeting.id);
          if (closed.error) return { error: closed.error, status: 502 };
        }
        const endedAt = new Date().toISOString();
        await tx.query('UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3',
          [JSON.stringify({ ...meeting, endedAt, endedBy: actor }), meeting.id, workspace.id]);
        const what = `${actor} a terminé ${meeting.callMode === 'audio' ? 'l’appel audio' : 'la réunion'} « ${meeting.name} ».`;
        const told = (meeting.attendees ?? []).filter((id) => id !== user.userId);
        if (told.length) {
          const event = insertRecord({ id: `evt:${meeting.id}:end`, kind: 'event', revision: 1, type: 'meeting', audience: 'studio', meetingId: meeting.id, clientId: meeting.clientId, name: what, createdAt: endedAt, recipients: told, readBy: [] }, 'system', workspace.id, true);
          await tx.query(event.text, event.params);
        }
        if (meeting.clientId) {
          const event = insertRecord({ id: `evt:${meeting.id}:end-client`, kind: 'event', revision: 1, type: 'meeting', audience: 'client', meetingId: meeting.id, clientId: meeting.clientId, name: what, createdAt: endedAt }, 'system', workspace.id, true);
          await tx.query(event.text, event.params);
        }
        return null;
      });
      return failure ? response({ error: failure.error }, failure.status) : result();
    }

    if (body.action === 'meeting-cancel') {
      if (!canPlanMeetings(workspace.role)) return response({ error: 'Seuls le propriétaire, les administrateurs et les social media managers planifient les réunions.' }, 403);
      const meeting = rowsNow.find((r) => r.kind === 'meeting' && r.id === body.id);
      if (!meeting || !canManageMeeting(meeting, { role: workspace.role, userId: user.userId })) return response({ error: 'Réunion introuvable.' }, 404);
      if (meeting.cancelledAt) return result();
      if (meeting.endedAt) return response({ error: 'Cette réunion est terminée.' }, 409);
      if (!(await saveTask(meeting, { ...meeting, cancelledAt: now }))) return response({ error: 'Cette réunion a changé. Actualisez avant de réessayer.' }, 409);
      const what = `${meeting.callMode === 'audio' ? 'L’appel audio' : 'La réunion'} « ${meeting.name} » du ${meeting.due?.split('-').reverse().join('/')} à ${meeting.time} est annulé${meeting.callMode === 'audio' ? '' : 'e'}.`;
      const statements: Statement[] = [];
      const told = (meeting.attendees ?? []).filter((id) => id !== user.userId);
      if (told.length) statements.push(insertRecord({ id: `evt:${meeting.id}:cancel`, kind: 'event', revision: 1, type: 'meeting', audience: 'studio', meetingId: meeting.id, clientId: meeting.clientId, name: what, createdAt: now, recipients: told, readBy: [] }, 'system', workspace.id, true));
      if (meeting.clientId) statements.push(insertRecord({ id: `evt:${meeting.id}:cancel-client`, kind: 'event', revision: 1, type: 'meeting', audience: 'client', meetingId: meeting.id, clientId: meeting.clientId, name: what, createdAt: now }, 'system', workspace.id, true));
      if (statements.length) await batch(db, statements);
      return result();
    }

    // A commercial decision is always explicit, scoped to this client's sent document and revision.
    // It does not use the deliverable's silence clock or claim a certified electronic signature.
    if (body.action === 'document-decision') {
      if (workspace.role !== 'client' && workspace.role !== 'owner') return response({ error: 'Votre rôle ne peut pas accepter ce document.' }, 403);
      const doc = rowsNow.find(r => r.kind === 'document' && r.id === body.id && !r.archived && (workspace.role === 'owner' || r.clientId === workspace.clientId));
      if (!doc) return response({ error: 'Document introuvable.' }, 404);
      if (doc.docType === 'facture' || doc.docStatus !== 'sent' || !['accepted', 'refused'].includes(body.status)) return response({ error: 'Ce document ne peut plus recevoir de décision.' }, 409);
      if (body.status === 'accepted' && doc.docType === 'devis' && doc.validUntil && doc.validUntil < today) return response({ error: 'Ce devis est expiré. Demandez au studio une nouvelle version.' }, 409);
      if (body.revision !== doc.revision) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
      const after = { ...doc, docStatus: body.status as DocStatus, documentDecision: { by: actor, userId: user.userId, email: user.email, at: now, method: workspace.role === 'client' ? 'portal' as const : 'studio' as const, status: body.status as 'accepted' | 'refused' }, history: [...(doc.history || []), { text: `Statut : ${docStatusLabels[body.status as DocStatus]} — ${actor}`, date: now }].slice(-100) };
      if (!(await saveTask(doc, after))) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
      return result({ id: doc.id });
    }

    // ----- request bank: the portal form -----

    if (body.action === 'request') {
      if (workspace.role === 'viewer' || isMemberRole(workspace.role)) return response({ error: 'Seuls les administrateurs saisissent une demande au nom d’un client.' }, 403);
      const clientId = workspace.role === 'client' ? workspace.clientId : body.clientId;
      const client = rowsNow.find((r) => r.kind === 'client' && r.id === clientId && !r.archived);
      if (!client) return response({ error: 'Client introuvable.' }, 404);
      const parsed = requestFields.safeParse(body.data);
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      const data = parsed.data;
      // Scope the key to the authenticated sender and workspace, never the supplied client id.
      // ON CONFLICT below also covers two simultaneous retries after the first response was lost.
      const requestId = data.submissionId
        ? `request:${createHash('sha256').update(JSON.stringify([workspace.id, user.userId, client.id, data.submissionId])).digest('hex')}`
        : crypto.randomUUID();
      if (rowsNow.some(r => r.kind === 'request' && r.id === requestId && r.clientId === client.id)) return result({ id: requestId });
      if (data.projectId && !rowsNow.some((r) => r.kind === 'project' && r.clientId === client.id && !r.archived && r.id === data.projectId)) {
        return response({ error: 'Choisissez un sous-projet de ce client.' }, 400);
      }
      // A request waits in the studio's inbox (« Demandes »); the owner or an admin makes it a task — or not.
      const platforms = [...new Set([...(data.platforms ?? []), ...(data.channel ? [data.channel] : [])])];
      const request: RecordItem = {
        id: requestId, kind: 'request', revision: 1, name: data.name, clientId: client.id, projectId: data.projectId || undefined,
        description: data.description || '', due: data.due || '', platforms, priority: data.priority ?? 'Moyenne', requestStatus: 'new',
        request: { by: actor, email: user.email, at: now }, createdAt: now,
      };
      const managers = (await db.query<{ userId: string }>("SELECT user_id AS \"userId\" FROM workspace_members WHERE workspace_id = $1 AND role IN ('owner', 'admin')", [workspace.id]))
        .map((m) => m.userId).filter((id) => id !== user.userId);
      await batch(db, [
        insertRecord(request, owner, workspace.id, true),
        insertRecord({ id: `evt:${request.id}:request`, kind: 'event', revision: 1, type: 'request', audience: 'studio', requestId: request.id, clientId: client.id,
          name: `Nouvelle demande de ${client.name} : « ${request.name} »${data.due ? ` pour le ${data.due.split('-').reverse().join('/')}` : ''}${platforms.length ? ` (${platforms.join(', ')})` : ''}.`,
          createdAt: now, ...(managers.length ? { recipients: managers, readBy: [] } : {}) }, 'system', workspace.id, true),
      ]);
      return result({ id: request.id });
    }

    if (body.action === 'request-update') {
      if (!isManager(workspace.role) && workspace.role !== 'client') return response({ error: 'Seuls le client, le propriétaire et les administrateurs modifient une demande.' }, 403);
      const request = rowsNow.find(r => r.kind === 'request' && r.id === body.id && (workspace.role !== 'client' || r.clientId === workspace.clientId));
      if (!request || !rowsNow.some(r => r.kind === 'client' && r.id === request.clientId && !r.archived)) return response({ error: 'Demande introuvable.' }, 404);
      if ((request.requestStatus ?? 'new') !== 'new') return response({ error: 'Cette demande a déjà été traitée.' }, 409);
      if (!Number.isSafeInteger(body.revision) || body.revision < 1) return response({ error: 'Révision de la demande invalide.' }, 400);
      if (body.revision !== request.revision) return response({ error: 'Cette demande a changé. Actualisez avant de réessayer.' }, 409);
      const parsed = requestUpdateFields.safeParse(body.data);
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      const data = parsed.data;
      if (data.projectId && !rowsNow.some(r => r.kind === 'project' && r.id === data.projectId && r.clientId === request.clientId && !r.archived)) return response({ error: 'Choisissez un sous-projet de ce client.' }, 400);
      const next = { ...request, name: data.name,
        projectId: data.projectId === undefined ? request.projectId : data.projectId || undefined,
        due: data.due ?? request.due ?? '', description: data.description ?? request.description ?? '',
        platforms: data.platforms ? [...new Set(data.platforms)] : request.platforms ?? [], priority: data.priority ?? request.priority ?? 'Moyenne',
      };
      const keys = ['name', 'projectId', 'due', 'description', 'platforms', 'priority'] as const;
      const changed = keys.filter(key => JSON.stringify(next[key]) !== JSON.stringify(request[key]));
      if (!changed.length) return result({ id: request.id });
      const labels = { name: 'titre', projectId: 'sous-projet', due: 'date', description: 'brief', platforms: 'plateformes', priority: 'priorité' };
      const after = { ...next, history: [...(request.history ?? []), { text: `Demande modifiée par ${actor} (${changed.map(key => labels[key]).join(', ')})`, date: now }].slice(-100) };
      const people = await db.query<{ userId: string; role: string }>(`SELECT user_id AS "userId", role FROM workspace_members
        WHERE workspace_id = $1 AND user_id <> $2 AND (role IN ('owner', 'admin') OR (role = 'client' AND client_id = $3))`, [workspace.id, user.userId, request.clientId]);
      const notices = (['studio', 'client'] as const).flatMap(audience => {
        const recipients = people.filter(person => audience === 'client' ? person.role === 'client' : person.role !== 'client').map(person => person.userId);
        if (!recipients.length) return [];
        return [insertRecord({ id: `evt:${request.id}:updated:${request.revision + 1}:${audience}`, kind: 'event', revision: 1, type: 'request', audience,
          requestId: request.id, clientId: request.clientId, name: `${actor} a modifié la demande « ${after.name} » (${changed.map(key => labels[key]).join(', ')}).`, createdAt: now, recipients, readBy: [] }, 'system', workspace.id, true)];
      });
      const saved = await db.transaction(async tx => {
        const rows = await tx.query('UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id', [JSON.stringify(after), request.id, workspace.id, body.revision]);
        if (!rows.length) return false;
        for (const notice of notices) await tx.query(notice.text, notice.params);
        return true;
      });
      if (!saved) return response({ error: 'Cette demande a changé. Actualisez avant de réessayer.' }, 409);
      return result({ id: request.id });
    }

    if (body.action === 'request-accept' || body.action === 'request-decline') {
      if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs traitent les demandes.' }, 403);
      const request = rowsNow.find((r) => r.kind === 'request' && r.id === body.id);
      if (!request) return response({ error: 'Demande introuvable.' }, 404);
      if (request.requestStatus !== 'new') return response({ error: 'Cette demande a déjà été traitée.' }, 409);
      if (body.revision !== undefined && body.revision !== request.revision) return response({ error: 'Cette demande a changé. Actualisez avant de réessayer.' }, 409);
      const client = rowsNow.find((r) => r.kind === 'client' && r.id === request.clientId && !r.archived);
      if (!client) return response({ error: 'Client introuvable.' }, 404);
      const statements: Statement[] = [];
      const told = (text: string, extra: Partial<RecordItem> = {}) => insertRecord({ id: `evt:${request.id}:decision:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'client',
        requestId: request.id, clientId: client.id, name: text, createdAt: now, ...extra }, 'system', workspace.id, true);

      if (body.action === 'request-decline') {
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : '';
        if (!reason) return response({ error: 'Expliquez au client pourquoi la demande n’est pas retenue.' }, 400);
        const declined = { ...request, requestStatus: 'declined' as const, decision: { by: actor, at: now, reason } };
        if (!(await saveTask(request, declined))) return response({ error: 'Cette demande a changé. Actualisez avant de réessayer.' }, 409);
        statements.push(told(`Votre demande « ${request.name} » n’est pas retenue : ${reason}`));
        await batch(db, statements);
        return result();
      }

      const parsed = acceptFields.safeParse(body.data ?? {});
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      const data = parsed.data;
      if (request.revisionTaskId && (data.commercialTreatment !== 'extra' || data.scopeFormat !== 'other' || data.scopeUnits !== 1)) return response({ error: 'Ce tour supplémentaire nécessite un devis extra pour une unité.' }, 400);
      const agreement = activeContract(rowsNow, client.id, today)?.serviceScope;
      if (agreement && (!data.commercialTreatment || !data.scopeFormat || !data.scopeUnits)) return response({ error: 'Classez la demande et indiquez son format et sa quantité avant production.' }, 400);
      if (data.commercialTreatment === 'extra') {
        const extra = rowsNow.find(d => d.kind === 'document' && d.id === data.extraQuoteId && d.clientId === client.id && d.docType === 'devis' && d.documentPurpose === 'extra' && d.requestId === request.id && d.docStatus === 'accepted' && !d.archived);
        if (!extra) return response({ error: 'Un extra nécessite le devis de cette demande accepté explicitement par le client.' }, 409);
        if (extra.scopeFormat !== data.scopeFormat || extra.scopeUnits !== data.scopeUnits) return response({ error: 'Le format et la quantité doivent correspondre au devis extra accepté.' }, 409);
      } else if (agreement && data.scopeFormat && data.scopeUnits) {
        const usage = scopeUsage(rowsNow, client.id, agreement, (data.due || request.due || today).slice(0, 7)).rows.find(r => r.format === data.scopeFormat);
        if (!usage || usage.planned + data.scopeUnits > usage.quantity) return response({ error: 'Cette quantité dépasse le forfait. Préparez un devis extra et faites-le accepter avant production.' }, 409);
      }
      let project = rowsNow.find((r) => r.kind === 'project' && r.clientId === client.id && !r.archived && r.id === (data.projectId || request.projectId));
      if (data.projectId && !project) return response({ error: 'Choisissez un sous-projet de ce client.' }, 400);
      project ??= rowsNow.find((r) => r.kind === 'project' && r.clientId === client.id && !r.archived && r.name === 'Demandes');
      if (!project) {
        project = { id: crypto.randomUUID(), kind: 'project', revision: 1, name: 'Demandes', clientId: client.id, description: 'Demandes reçues via le portail client.', createdAt: now };
        statements.push(insertRecord(project, owner, workspace.id));
      }
      const assignee = data.assigneeId ? (await members(workspace.id)).find((m) => m.userId === data.assigneeId && m.role !== 'client') : undefined;
      if (data.assigneeId && !assignee) return response({ error: 'Assignez un membre de l’équipe.' }, 400);
      const platforms = request.platforms ?? [];
      const channel = platforms.find((p): p is (typeof taskChannels)[number] => (taskChannels as readonly string[]).includes(p)) ?? '';
      const description = [data.description ?? request.description ?? '', platforms.length ? `Plateformes : ${platforms.join(', ')}` : ''].filter((l) => l.trim()).join('\n\n');
      const original = request.revisionTaskId ? rowsNow.find(r => r.kind === 'task' && r.id === request.revisionTaskId && r.clientId === client.id && !r.archived && r.pendingExtraRequestId === request.id) : undefined;
      if (request.revisionTaskId && !original) return response({ error: 'Le livrable de ce tour supplémentaire a changé.' }, 409);
      const task: RecordItem = original ? { ...requestChanges(original, actor, now), pendingExtraRequestId: undefined, extraQuoteId: data.extraQuoteId } : {
        id: crypto.randomUUID(), kind: 'task', revision: 1, name: data.name, clientId: client.id, projectId: project.id,
        description, due: data.due ?? request.due ?? '', channel, platforms, priority: request.priority ?? 'Moyenne', status: 'À faire', source: 'Portail',
        ...(assignee ? { assignee: memberName(assignee), assigneeId: assignee.userId } : {}),
        request: request.request, createdAt: now,
        commercialTreatment: data.commercialTreatment, scopeFormat: data.scopeFormat, scopeUnits: data.scopeUnits, extraQuoteId: data.commercialTreatment === 'extra' ? data.extraQuoteId : undefined,
        history: [{ text: `Demande du portail (${request.request?.by ?? client.name}) acceptée par ${actor}`, date: now }],
      };
      const accepted = { ...request, requestStatus: 'accepted' as const, taskId: task.id, commercialTreatment: data.commercialTreatment, scopeFormat: data.scopeFormat, scopeUnits: data.scopeUnits, extraQuoteId: task.extraQuoteId, decision: { by: actor, at: now } };
      if (!original) statements.push(insertRecord(task, owner, workspace.id));
      statements.push(told(`Votre demande « ${request.name} » est acceptée${task.due ? ` : prévue pour le ${task.due.split('-').reverse().join('/')}` : ''}.`, { taskId: task.id }));
      if (assignee && assignee.userId !== user.userId) statements.push(insertRecord({ id: `evt:${task.id}:task-assigned:${now}`, kind: 'event', revision: 1, type: 'task-assigned', audience: 'studio',
        name: `« ${task.name} » assignée à ${memberName(assignee)} par ${actor}.`, taskId: task.id, clientId: client.id, createdAt: now, recipients: [assignee.userId], readBy: [] }, 'system', workspace.id, true));
      await db.transaction(async tx => {
        // Serialize included requests for this client; re-read quota after taking the lock.
        if (agreement && data.commercialTreatment === 'included') {
          await tx.query('SELECT id FROM records WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [client.id, workspace.id]);
          const fresh = await tx.query<{ data: RecordItem; revision: number; planMonth?: string }>("SELECT r.data, r.revision, p.data->>'month' AS \"planMonth\" FROM records r LEFT JOIN records p ON p.workspace_id = r.workspace_id AND p.kind = 'meta' AND starts_with(p.id, $2) AND p.data->>'id' = r.data->>'planId' WHERE r.workspace_id = $1 AND r.kind IN ('task', 'plan_item')", [workspace.id, `content-plan:${workspace.id}:`]);
          const usage = scopeUsage(fresh.map(r => ({ ...r.data, revision: r.revision, planMonth: r.planMonth || r.data.planMonth })), client.id, agreement, (data.due || request.due || today).slice(0, 7)).rows.find(r => r.format === data.scopeFormat);
          if (!usage || usage.planned + (data.scopeUnits || 1) > usage.quantity) throw new CommercialError('Cette quantité dépasse le forfait. Préparez un devis extra et faites-le accepter avant production.');
        }
        const savedRequest = await tx.query('UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id', [JSON.stringify(accepted), request.id, workspace.id, request.revision]);
        if (!savedRequest.length) throw new CommercialError('Cette demande a changé. Actualisez avant de réessayer.');
        if (original) {
          const resumed = await tx.query('UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id', [JSON.stringify(task), original.id, workspace.id, original.revision]);
          if (!resumed.length) throw new CommercialError('Ce livrable a changé. Actualisez avant de réessayer.');
        }
        for (const statement of statements) await tx.query(statement.text, statement.params);
      });
      const assignmentWhatsapp = await notifyTaskAssignment(workspace.id, task, undefined, user.userId, actor, new URL(req.url).origin);
      return result({ id: task.id, ...(assignmentWhatsapp ? { assignmentWhatsapp } : {}) });
    }

    if (body.action === 'delete' && body.kind === 'library') {
      if (!isStudioRole(workspace.role) || workspace.role === 'viewer') return response({ error: 'Votre rôle ne peut pas modifier la bibliothèque.' }, 403);
      const item = rowsNow.find((r) => r.id === body.id && r.kind === 'library');
      if (!item) return response({ error: 'Élément introuvable.' }, 404);
      if (!canManageEntry(item, { userId: owner, name: actor, role: workspace.role })) return response({ error: 'Seuls son auteur, le propriétaire et les administrateurs peuvent supprimer cette ressource.' }, 403);
      if (body.revision !== item.revision) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
      const deleted = await db.query('DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id', [workspace.id, item.id, item.revision]);
      if (!deleted.length) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
      return result();
    }

    if (body.action === 'delete' && body.kind === 'platform') {
      if (!isStudioRole(workspace.role) || workspace.role === 'viewer') return response({ error: 'Votre rôle ne peut pas modifier les plateformes.' }, 403);
      const item = rowsNow.find((r) => r.id === body.id && r.kind === 'platform');
      if (!item) return response({ error: 'Plateforme introuvable.' }, 404);
      if (body.revision !== item.revision) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
      const deleted = await db.query('DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id', [workspace.id, item.id, item.revision]);
      if (!deleted.length) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
      return result();
    }

    if (body.action === 'delete' && body.kind === 'document') {
      if (workspace.role !== 'owner') return response({ error: 'Seul le propriétaire peut supprimer un document.' }, 403);
      const doc = rowsNow.find((r) => r.id === body.id && r.kind === 'document');
      if (!doc) return response({ error: 'Document introuvable.' }, 404);
      // A document the client may already have seen is never hard-deleted, only archived — the numbered history stays intact.
      if (doc.docStatus !== 'draft') return response({ error: 'Seul un brouillon peut être supprimé ; archivez ce document à la place.' }, 409);
      if (body.revision !== doc.revision) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
      const deleted = await db.query('DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id', [workspace.id, doc.id, doc.revision]);
      if (!deleted.length) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
      return result();
    }

    // ----- several tasks deleted at once (the task table's selection), with their comments, notices and files -----

    if (body.action === 'delete-many' && body.kind === 'task') {
      if (!canManageMembers(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent supprimer.' }, 403);
      const wanted = Array.isArray(body.items) ? (body.items as { id?: unknown; revision?: unknown }[]).slice(0, 500) : [];
      if (!wanted.length) return response({ error: 'Sélectionnez au moins une tâche.' }, 400);
      const targets = wanted.map((w) => ({ w, record: rowsNow.find((r) => r.kind === 'task' && r.id === w?.id) }));
      if (targets.some((x) => !x.record)) return response({ error: 'Une des tâches est introuvable. Actualisez avant de réessayer.' }, 404);
      if (targets.some((x) => x.record!.revision !== x.w.revision)) return response({ error: 'Une des tâches a changé. Actualisez avant de réessayer.' }, 409);
      const ids = targets.map((x) => x.record!.id);
      const done = await db.transaction(async (tx) => {
        for (const { record } of targets) {
          const rows = await tx.query('DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id', [workspace.id, record!.id, record!.revision]);
          if (!rows.length) throw new Error('changed');
        }
        await tx.query(
          `DELETE FROM assets WHERE workspace_id = $1 AND kind = 'audio' AND id IN (
             SELECT data->>'audio' FROM records WHERE workspace_id = $1 AND kind = 'comment' AND data->>'taskId' = ANY($2::text[]) AND data ? 'audio')`,
          [workspace.id, ids],
        );
        await tx.query(
          `DELETE FROM assets WHERE workspace_id = $1 AND kind = 'file' AND id IN (
             SELECT f->>'id' FROM records c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.data->'attachments') = 'array' THEN c.data->'attachments' ELSE '[]'::jsonb END) f
             WHERE c.workspace_id = $1 AND c.kind = 'comment' AND c.data->>'taskId' = ANY($2::text[]))`,
          [workspace.id, ids],
        );
        await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind IN ('comment', 'event') AND data->>'taskId' = ANY($2::text[])", [workspace.id, ids]);
        return true;
      }).catch((e) => { if ((e as Error).message === 'changed') return false; throw e; });
      if (!done) return response({ error: 'Une des tâches a changé. Actualisez avant de réessayer.' }, 409);
      return result();
    }

    if (body.action === 'delete') {
      const socialDelete = body.kind === 'editorial_post' && canSocial(workspace.role);
      if (!canManageMembers(workspace.role) && !socialDelete) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent supprimer.' }, 403);
      if (body.kind === 'client' && workspace.role !== 'owner') return response({ error: 'Seul le propriétaire peut supprimer un client.' }, 403);
      const record = rowsNow.find((r) => r.id === body.id && r.kind === body.kind);
      if (!record) return response({ error: 'Élément introuvable.' }, 404);
      if (body.revision !== record.revision) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
      // Media files of the posts going away (the post itself, or a deleted client's whole calendar).
      const mediaGone = rowsNow
        .filter((r) => r.kind === 'editorial_post' && (r.id === record.id || (body.kind === 'client' && r.clientId === record.id)))
        .flatMap((r) => mediaOf(r).map((m) => m.path).filter((p): p is string => !!p));
      const deleted = await db.transaction(async (tx) => {
        const rows = await tx.query('DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id', [workspace.id, record.id, record.revision]);
        if (!rows.length) return false;
        // Voice messages on the comments going away are dropped with them.
        const dropVoice = async (taskIds: string[]) => {
          if (!taskIds.length) return;
          await tx.query(
            `DELETE FROM assets WHERE workspace_id = $1 AND kind = 'audio' AND id IN (
               SELECT data->>'audio' FROM records WHERE workspace_id = $1 AND kind = 'comment' AND data->>'taskId' = ANY($2::text[]) AND data ? 'audio')`,
            [workspace.id, taskIds],
          );
          // And so are the files sent in them.
          await tx.query(
            `DELETE FROM assets WHERE workspace_id = $1 AND kind = 'file' AND id IN (
               SELECT f->>'id' FROM records c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.data->'attachments') = 'array' THEN c.data->'attachments' ELSE '[]'::jsonb END) f
               WHERE c.workspace_id = $1 AND c.kind = 'comment' AND c.data->>'taskId' = ANY($2::text[]))`,
            [workspace.id, taskIds],
          );
        };
        if (body.kind === 'editorial_post') {
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'postId' = $2", [workspace.id, record.id]);
        } else if (body.kind === 'meeting') {
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'meetingId' = $2", [workspace.id, record.id]);
        } else if (body.kind === 'task') {
          await dropVoice([record.id]);
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind IN ('comment', 'event') AND data->>'taskId' = $2", [workspace.id, record.id]);
        } else if (body.kind === 'client') {
          const taskIds = rowsNow.filter((r) => r.kind === 'task' && r.clientId === record.id).map((r) => r.id);
          await dropVoice(taskIds);
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'project' AND data->>'clientId' = $2", [workspace.id, record.id]);
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'task' AND data->>'clientId' = $2", [workspace.id, record.id]);
          // The posting calendar belongs to the client too: left behind, its posts keep showing on
          // the studio-wide calendar under a client that no longer exists.
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'editorial_post' AND data->>'clientId' = $2", [workspace.id, record.id]);
          // Its requests (and their notices), its meetings and theirs.
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'requestId' IN (SELECT id FROM records WHERE workspace_id = $1 AND kind = 'request' AND data->>'clientId' = $2)", [workspace.id, record.id]);
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'request' AND data->>'clientId' = $2", [workspace.id, record.id]);
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'meetingId' IN (SELECT id FROM records WHERE workspace_id = $1 AND kind = 'meeting' AND data->>'clientId' = $2)", [workspace.id, record.id]);
          await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind = 'meeting' AND data->>'clientId' = $2", [workspace.id, record.id]);
          if (taskIds.length) await tx.query("DELETE FROM records WHERE workspace_id = $1 AND kind IN ('comment', 'event') AND data->>'taskId' = ANY($2::text[])", [workspace.id, taskIds]);
          // The logo and banner uploaded for this client (devis/factures are kept on purpose).
          const images = [record.logo, record.banner].filter(Boolean) as string[];
          if (images.length) await tx.query("DELETE FROM assets WHERE workspace_id = $1 AND id = ANY($2::text[])", [workspace.id, images]);
        }
        return true;
      });
      if (!deleted) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
      await removeMedia(mediaGone);
      // A deleted client's connected accounts go with it: nothing may post in its name any more.
      if (body.kind === 'client') await removeClientAccounts(workspace.id, record.id);
      return result();
    }

    // ----- own profile: the display name used in greetings, comments and receipts -----

    if (body.action === 'update-profile') {
      // Name and/or picture. The picture is an uploaded 'avatar' asset id (null removes it); replaced pictures are dropped.
      const wantsName = body.name !== undefined, wantsAvatar = body.avatar !== undefined;
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
      if (wantsName && (name.length < 2 || name.length > 80)) return response({ error: 'Indiquez un nom (2 à 80 caractères).' }, 400);
      const avatar = body.avatar === null || body.avatar === '' ? null : typeof body.avatar === 'string' && /^[0-9a-f-]{36}$/.test(body.avatar) ? body.avatar : undefined;
      if (wantsAvatar && avatar === undefined) return response({ error: 'Image introuvable.' }, 400);
      if (!wantsName && !wantsAvatar) return response({ error: 'Requête invalide.' }, 400);
      const current = (await db.query<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [user.userId]))[0];
      if (wantsAvatar && avatar) {
        const owned = (await db.query<{ id: string }>("SELECT id FROM assets WHERE id = $1 AND kind = 'avatar' AND created_by = $2", [avatar, user.userId]))[0];
        if (!owned) return response({ error: 'Image introuvable.' }, 400);
      }
      await db.transaction(async (tx) => {
        if (wantsName) {
          await tx.query(
            `UPDATE records r SET data = jsonb_set(jsonb_set(r.data, '{assigneeId}', to_jsonb($1::text)), '{assignee}', to_jsonb($2::text)), revision = revision + 1
             WHERE kind = 'task' AND (data->>'assigneeId' = $1 OR (
               data->>'assigneeId' IS NULL AND lower(trim(data->>'assignee')) = ANY($3::text[])
               AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = r.workspace_id AND wm.user_id = $1)
               AND NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = r.workspace_id AND wm.user_id <> $1
                 AND lower(trim(data->>'assignee')) IN (lower(trim(wm.name)), lower(trim(wm.email))))))`,
            [user.userId, name, identitiesOf(user).map((v) => v.trim().toLowerCase()).filter(Boolean)],
          );
          await tx.query('UPDATE users SET name = $2 WHERE id = $1', [user.userId, name]);
          await tx.query('UPDATE workspace_members SET name = $2 WHERE user_id = $1', [user.userId, name]);
        }
        if (wantsAvatar) {
          await tx.query('UPDATE users SET avatar = $2 WHERE id = $1', [user.userId, avatar]);
          if (current?.avatar && current.avatar !== avatar) await tx.query('DELETE FROM assets WHERE id = $1', [current.avatar]);
        }
      });
      const fresh: AppUser = { ...user, fullName: wantsName ? name : user.fullName, displayName: wantsName ? name : user.displayName, avatar: wantsAvatar ? avatar! : current?.avatar ?? null };
      return response({ ...(await payload(workspace, fresh)), user: { id: fresh.userId, name: fresh.fullName || fresh.displayName, email: fresh.email, avatar: fresh.avatar } });
    }

    if (body.action === 'mark-read') {
      const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.startsWith('evt:')).slice(0, 200) : [];
      const events = visibleTo(workspace, rowsNow, user).filter((r) => r.kind === 'event' && (body.all === true
        ? (!r.recipients || isEventRecipient(r, user.userId)) && isEventUnreadFor(r, user.userId)
        : ids.includes(r.id)));
      // Read state is per user for every event (targeted or broadcast): a race-safe append of the user
      // to `readBy`. Broadcast events (no `recipients`) never flip a flag shared by everyone.
      const readable = events.filter((e) => !e.recipients || isEventRecipient(e, user.userId));
      const statements: Statement[] = readable.length ? [{
        text: `UPDATE records SET data = jsonb_set(data, '{readBy}', COALESCE(data->'readBy','[]'::jsonb) || to_jsonb($1::text))
               WHERE id = ANY($2::text[]) AND workspace_id = $3 AND kind = 'event'
                 AND (NOT (data ? 'recipients') OR COALESCE(data->'recipients','[]'::jsonb) ? $1::text)
                 AND NOT (COALESCE(data->'readBy','[]'::jsonb) ? $1::text)`,
        params: [user.userId, readable.map((e) => e.id), workspace.id],
      }] : [];
      if (statements.length) await batch(db, statements);
      return result();
    }

    if (body.action === 'notify-client') {
      if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs peuvent notifier un client.' }, 403);
      const client = rowsNow.find((r) => r.kind === 'client' && r.id === body.clientId && !r.archived);
      if (!client) return response({ error: 'Client introuvable.' }, 404);
      if (!mailConfigured()) return response({ error: 'L’envoi d’e-mail n’est pas configuré.' }, 400);
      const news = typeof body.news === 'string' ? body.news.trim().slice(0, 2000) : '';
      const pendingTasks = rowsNow
        .filter((r) => r.kind === 'task' && r.clientId === client.id && !r.archived && r.status === 'À valider')
        .map((t) => t.name);
      if (!pendingTasks.length && !news) return response({ error: 'Rien à envoyer : ajoutez une actualité ou attendez un élément à valider.' }, 400);
      // Portal contacts actually receive the account; the fiche's own address is only a fallback
      // for a client with no portal login yet.
      const portalEmails = (await db.query<{ email: string | null }>(
        'SELECT email FROM workspace_members WHERE workspace_id = $1 AND role = $2 AND client_id = $3',
        [workspace.id, 'client', client.id],
      )).map((m) => m.email).filter((e): e is string => !!e?.trim());
      const emails = portalEmails.length ? [...new Set(portalEmails)] : (client.email?.trim() ? [client.email.trim()] : []);
      if (!emails.length) return response({ error: 'Aucune adresse e-mail pour ce client.' }, 400);
      const url = signInUrl(req);
      const mail = await sendClientNotice({ to: emails, clientName: client.name, studio: studioName, url, pendingTasks, news });
      if (!mail.sent) return response({ error: mail.error || 'Envoi impossible.' }, 502);
      return result({ sent: true, emailCount: emails.length });
    }

    // ----- library: shared team resources (prompts, assets, plugins, presets) — never the client -----

    // A star is personal; « used » counts a copy or an opening (no revision: it never conflicts with an edit).
    if ((body.action === 'library-favorite' || body.action === 'library-used') && isStudioRole(workspace.role)) {
      // « used » is a plain counter anyone reading the library may bump; a star is a write.
      if (body.action === 'library-favorite' && workspace.role === 'viewer') return response({ error: 'Votre rôle ne peut pas modifier la bibliothèque.' }, 403);
      const item = rowsNow.find((r) => r.id === body.id && r.kind === 'library');
      if (!item) return response({ error: 'Élément introuvable.' }, 404);
      if (body.action === 'library-used') {
        await db.query(
          "UPDATE records SET data = jsonb_set(data, '{copies}', to_jsonb(COALESCE((data->>'copies')::int, 0) + 1)) WHERE id = $1 AND workspace_id = $2 AND kind = 'library'",
          [item.id, workspace.id],
        );
        return response({ ok: true });
      }
      await db.query(
        `UPDATE records SET data = jsonb_set(data, '{favoriteBy}', COALESCE((
           SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(COALESCE(data->'favoriteBy', '[]'::jsonb) || CASE WHEN $3 THEN to_jsonb(ARRAY[$4::text]) ELSE '[]'::jsonb END) v
           WHERE $3 OR v <> $4), '[]'::jsonb)) WHERE id = $1 AND workspace_id = $2 AND kind = 'library'`,
        [item.id, workspace.id, body.on === true, owner],
      );
      return result();
    }

    if (['create', 'update'].includes(body.action) && body.kind === 'library') {
      if (!isStudioRole(workspace.role) || workspace.role === 'viewer') {
        return response({ error: 'Votre rôle ne peut pas modifier la bibliothèque.' }, 403);
      }
      const existing = body.action === 'update' ? rowsNow.find((r) => r.id === body.id && r.kind === 'library') : undefined;
      if (body.action === 'update' && !existing) return response({ error: 'Élément introuvable.' }, 404);
      if (existing && !canManageEntry(existing, { userId: owner, name: actor, role: workspace.role })) {
        return response({ error: 'Seuls son auteur, le propriétaire et les administrateurs peuvent modifier cette ressource.' }, 403);
      }
      const parsed = libraryFields.safeParse(body.data);
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      const data = { ...parsed.data, tags: cleanTags(parsed.data.tags) };
      // A prompt keeps its text, a link its address: the other one is dropped when the category changes.
      const prompt = data.category === 'prompt';
      // The same link twice is almost always a mistake: said, unless the person confirms.
      const key = !prompt ? linkKey(data.link) : '';
      const twin = key ? rowsNow.find((r) => r.kind === 'library' && r.id !== existing?.id && linkKey(r.link) === key) : undefined;
      if (twin && body.allowDuplicate !== true) return response({ error: `Ce lien existe déjà dans la bibliothèque : « ${twin.name} ».`, code: 'duplicate', id: twin.id }, 409);
      const item: RecordItem = {
        ...existing, ...data,
        content: prompt ? data.content : undefined, link: prompt ? undefined : data.link,
        tool: prompt ? data.tool || undefined : undefined, example: prompt ? data.example || undefined : undefined,
        icon: prompt ? undefined : data.icon || (existing?.link && linkKey(existing.link) === key ? existing.icon : undefined),
        // The library is the studio's, not a client's.
        clientId: undefined, tags: data.tags.length ? data.tags : undefined,
        id: existing?.id || crypto.randomUUID(), kind: 'library', revision: existing?.revision ?? 1,
        author: existing?.author || actor, authorId: existing ? existing.authorId : owner, createdAt: existing?.createdAt || now,
        history: [...(existing?.history || []), { text: existing ? `Modifié par ${actor}` : `Ajouté par ${actor}`, date: now }].slice(-100),
      };
      if (existing) {
        if (body.revision !== existing.revision) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
        const changed = await db.query(
          'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
          [JSON.stringify(item), existing.id, workspace.id, body.revision],
        );
        if (!changed.length) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
      } else {
        await insert(item);
      }
      return result({ id: item.id });
    }

    // ----- platforms: the editable list a post's "channels" are picked from — shared, any studio writer -----

    if (['create', 'update'].includes(body.action) && body.kind === 'platform') {
      if (!isStudioRole(workspace.role) || workspace.role === 'viewer') {
        return response({ error: 'Votre rôle ne peut pas modifier les plateformes.' }, 403);
      }
      const existing = body.action === 'update' ? rowsNow.find((r) => r.id === body.id && r.kind === 'platform') : undefined;
      if (body.action === 'update' && !existing) return response({ error: 'Plateforme introuvable.' }, 404);
      const parsed = platformFields.safeParse(body.data);
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      // "instagram" and "Instagram" are the same platform: creating a duplicate just returns the one already there.
      const same = rowsNow.find((r) => r.kind === 'platform' && r.id !== existing?.id && r.name.trim().toLowerCase() === parsed.data.name.toLowerCase());
      if (same && !existing) return result({ id: same.id });
      if (same) return response({ error: 'Cette plateforme existe déjà.' }, 409);
      const item: RecordItem = {
        ...existing, ...parsed.data, id: existing?.id || crypto.randomUUID(), kind: 'platform', revision: existing?.revision ?? 1,
        createdAt: existing?.createdAt || now,
      };
      if (existing) {
        if (body.revision !== existing.revision) return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
        const changed = await db.query(
          'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
          [JSON.stringify(item), existing.id, workspace.id, body.revision],
        );
        if (!changed.length) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
      } else {
        await insert(item);
      }
      return result({ id: item.id });
    }

    // ----- editorial posts: the posting calendar — a lightweight plan, not tied to the task workflow -----

    if (['create', 'update'].includes(body.action) && body.kind === 'editorial_post') {
      if (!canSocial(workspace.role)) return response({ error: 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.' }, 403);
      const existing = body.action === 'update' ? rowsNow.find((r) => r.id === body.id && r.kind === 'editorial_post') : undefined;
      if (body.action === 'update' && !existing) return response({ error: 'Post introuvable.' }, 404);
      const parsed = editorialPostFields.safeParse(body.data);
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      let client: RecordItem | undefined;
      if (parsed.data.clientId !== 'internal') {
        client = rowsNow.find((r) => r.kind === 'client' && r.id === parsed.data.clientId);
        if (!client || client.archived) return response({ error: 'Sélectionnez un client actif.' }, 400);
      }
      // An optional multi-value tag shouldn't block saving the rest of the post: drop anything
      // that no longer matches a real platform instead of rejecting the whole submission.
      const validPlatformIds = new Set(rowsNow.filter((r) => r.kind === 'platform').map((r) => r.id));
      const channels = (parsed.data.channels || []).filter((id) => validPlatformIds.has(id));
      // Photos and videos: the list when sent, else the single media of a pre-hub post, else unchanged.
      // A storage path is only kept inside this workspace's folder: a post can never point at, and so
      // delete, another workspace's file.
      const { mediaType, mediaPath, mediaUrl, targets, media, socialState, repeat, ...fields } = parsed.data;
      const folder = `${workspace.id.replace(/[^a-zA-Z0-9-]/g, '_')}/`;
      const ownPath = (path?: string) => (path && path.startsWith(folder) ? { path } : {});
      // Storage-hosted files must live in this workspace's folder (same rule as lib/post-media-analysis.ts).
      const storageBase = env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${env.SUPABASE_MEDIA_BUCKET || 'editorial-media'}/` : '';
      const mediaList = media
        ? media.map((m) => m.source === 'drive'
          ? { url: m.url, type: m.type, source: 'drive' as const, ...(m.thumb ? { thumb: m.thumb } : {}), ...(m.mime ? { mime: m.mime } : {}), ...(m.name ? { name: m.name } : {}) }
          : { url: m.url, type: m.type, ...ownPath(m.path) })
        : mediaType && mediaUrl ? [{ url: mediaUrl, type: mediaType, ...ownPath(mediaPath) }]
        : existing ? mediaOf(existing) : [];
      // Photos and videos come from the app's storage or Google Drive, nowhere else: the server
      // downloads them to publish, so any other address is refused (lib/media-source.ts).
      if ((media || mediaUrl) && mediaList.some((m) => !isMediaSource(m.url)
        || (storageBase && m.url.startsWith(storageBase) && !m.url.startsWith(`${storageBase}${folder}`))
        || ('thumb' in m && m.thumb && (!isMediaSource(m.thumb) || (storageBase && m.thumb.startsWith(storageBase) && !m.thumb.startsWith(`${storageBase}${folder}`)))))) {
        return response({ error: 'Ajoutez les photos et vidéos depuis l’ordinateur ou avec un lien Google Drive.' }, 400);
      }
      const item: RecordItem = {
        ...existing, ...fields, channels, id: existing?.id || crypto.randomUUID(), kind: 'editorial_post', revision: existing?.revision ?? 1,
        targets: targets ?? existing?.targets ?? [], media: mediaList, socialState: socialState ?? existing?.socialState ?? 'draft',
        author: existing?.author || actor, createdAt: existing?.createdAt || now,
        history: [...(existing?.history || []), { text: existing ? `Modifié par ${actor}` : `Créé par ${actor}`, date: now }].slice(-100),
      };
      delete item.mediaType; delete item.mediaUrl; delete item.mediaPath;
      // Repeating (lib/social-repeat.ts): the rule is tidied, and the date moves to the first day the
      // series goes out. A day's copy of a series doesn't repeat itself.
      if (repeat !== undefined) {
        const rule = item.repeatOf ? undefined : normalizeRepeat(repeat, item.due!);
        if (rule) item.repeat = rule; else delete item.repeat;
      }
      if (item.repeat && !item.publishedAt) {
        const first = nextRepeatDay(item.repeat, item.due!);
        if (!first) return response({ error: 'La date de fin de la répétition est avant la première publication.' }, 400);
        item.due = first;
      }
      delete (item as Record<string, unknown>).aiCaption; // the old n8n AI-caption switch, gone with n8n
      // Client approval: a scheduled post of a client who approves posts waits for them. Any change to
      // what goes out (text, media, networks, date) asks again; a draft needs no answer.
      const content = (p?: RecordItem) => p ? JSON.stringify([p.due, p.time || '', p.description || '', targetsOf(p), mediaOf(p).map((m) => m.url), p.repeat ?? null]) : '';
      let askClient = false;
      if (item.socialState !== 'scheduled' || item.publishedAt) {
        if (item.socialState !== 'scheduled') delete item.approval;
      } else if (client?.postApproval && (!item.approval || content(existing) !== content(item))) {
        item.approval = { state: 'pending', at: now };
        askClient = existing?.approval?.state !== 'pending' || content(existing) !== content(item);
      }
      if (existing) {
        if (body.revision !== existing.revision) return response({ error: 'Ce post a changé. Actualisez avant de réessayer.' }, 409);
        const changed = await db.query(
          'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
          [JSON.stringify(item), existing.id, workspace.id, body.revision],
        );
        if (!changed.length) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
        // Photos or videos taken off the post leave storage with it.
        const kept = new Set(mediaOf(item).map((m) => m.path).filter(Boolean));
        await removeMedia(mediaOf(existing).map((m) => m.path).filter((p): p is string => !!p && !kept.has(p)));
      } else {
        await insert(item);
      }
      if (askClient && client) {
        const note = insertRecord({
          id: `evt:${item.id}:approval:${now}`, kind: 'event', revision: 1, type: 'post', audience: 'client', postId: item.id, clientId: client.id,
          name: `Nouvelle publication à valider : « ${item.name} »`, createdAt: now,
        }, owner, workspace.id, true);
        await db.query(note.text, note.params);
      }
      return result({ id: item.id });
    }

    // ----- one date of a repeating series: skipped, or with its own title and text (lib/social-repeat.ts) -----

    if (body.action === 'series-date') {
      if (!canSocial(workspace.role)) return response({ error: 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.' }, 403);
      const series = rowsNow.find((r) => r.kind === 'editorial_post' && r.id === body.id && !r.archived);
      if (!series?.repeat || series.publishedAt) return response({ error: 'Série introuvable.' }, 404);
      const day = typeof body.day === 'string' ? body.day : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < (series.due ?? '') || !repeatsOn(series.repeat, day)) return response({ error: 'Cette date ne fait pas partie de la série.' }, 400);
      if (body.revision !== series.revision) return response({ error: 'Ce post a changé. Actualisez avant de réessayer.' }, 409);
      const raw = body.exception as { skip?: unknown; name?: unknown; description?: unknown } | null | undefined;
      const exceptions = { ...(series.repeatExceptions ?? {}) };
      const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      let note: string;
      let newText = false;
      if (!raw) {
        delete exceptions[day];
        note = `Date du ${label} rétablie comme la série`;
      } else if (raw.skip === true) {
        exceptions[day] = { skip: true };
        note = `Date du ${label} sautée`;
      } else {
        const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 160) : undefined;
        const description = typeof raw.description === 'string' ? raw.description.slice(0, 5000) : undefined;
        if (name === '') return response({ error: 'Donnez un titre à cette date.' }, 400);
        const own = { ...(name !== undefined && name !== series.name ? { name } : {}), ...(description !== undefined && description !== (series.description ?? '') ? { description } : {}) };
        if (Object.keys(own).length) { exceptions[day] = own; newText = true; } else delete exceptions[day];
        note = `Date du ${label} modifiée`;
      }
      const after: RecordItem = { ...series, repeatExceptions: exceptions, history: [...(series.history || []), { text: `${note} par ${actor}`, date: now }].slice(-100) };
      if (!Object.keys(exceptions).length) delete after.repeatExceptions;
      // A client who approves posts sees the new text of that date before it goes out.
      const client = rowsNow.find((r) => r.kind === 'client' && r.id === series.clientId);
      const askClient = newText && !!client?.postApproval && series.socialState === 'scheduled';
      if (askClient) after.approval = { state: 'pending', at: now };
      const saved = await db.query(
        'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
        [JSON.stringify(after), series.id, workspace.id, series.revision],
      );
      if (!saved.length) return response({ error: 'Ce post a changé. Actualisez avant de réessayer.' }, 409);
      if (askClient && client) {
        const event = insertRecord({
          id: `evt:${series.id}:approval:${now}`, kind: 'event', revision: 1, type: 'post', audience: 'client', postId: series.id, clientId: client.id,
          name: `Publication du ${label} modifiée, à valider : « ${series.name} »`, createdAt: now,
        }, owner, workspace.id, true);
        await db.query(event.text, event.params);
      }
      return result({ id: series.id });
    }

    // ----- the client's answer on a post (portal), or the studio recording it for them -----

    if (body.action === 'post-approve' || body.action === 'post-changes') {
      const post = rowsNow.find((r) => r.kind === 'editorial_post' && r.id === body.postId && !r.archived);
      const asClient = workspace.role === 'client';
      if (!post || (asClient && post.clientId !== workspace.clientId)) return response({ error: 'Publication introuvable.' }, 404);
      if (!asClient && !canSocial(workspace.role)) return response({ error: 'Accès non autorisé.' }, 403);
      if (post.socialState !== 'scheduled' || post.publishedAt || post.approval?.state !== 'pending') {
        return response({ error: 'Cette publication n’attend pas de validation.' }, 409);
      }
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
      if (body.action === 'post-changes' && !text) return response({ error: 'Dites ce qu’il faut modifier.' }, 400);
      const by = asClient ? actor : `${actor} (pour le client)`;
      const approval = body.action === 'post-approve' ? { state: 'approved' as const, at: now, by } : { state: 'changes' as const, at: now, by, note: text };
      const after: RecordItem = { ...post, approval, history: [...(post.history || []), { text: body.action === 'post-approve' ? `Validé par ${by}` : `Modifications demandées par ${by} : ${text}`, date: now }].slice(-100) };
      const saved = await db.query(
        'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
        [JSON.stringify(after), post.id, workspace.id, post.revision],
      );
      if (!saved.length) return response({ error: 'Cette publication a changé. Actualisez avant de réessayer.' }, 409);
      const note = insertRecord({
        id: `evt:${post.id}:${body.action}:${now}`, kind: 'event', revision: 1, type: 'post', audience: 'studio', postId: post.id, clientId: post.clientId,
        name: body.action === 'post-approve' ? `« ${post.name} » validé par ${by}.` : `${by} demande des modifications sur « ${post.name} » : ${text}`,
        createdAt: now,
      }, owner, workspace.id, true);
      await db.query(note.text, note.params);
      return result({ id: post.id });
    }

    // ----- a network the app doesn't post to itself (TikTok, YouTube for now): marked done by hand -----

    if (body.action === 'post-mark-published') {
      if (!canSocial(workspace.role)) return response({ error: 'Accès non autorisé.' }, 403);
      const post = rowsNow.find((r) => r.kind === 'editorial_post' && r.id === body.postId);
      if (!post) return response({ error: 'Publication introuvable.' }, 404);
      // Published some other way (the app, a connection that failed…): recorded by hand, with its link.
      const target = targetsOf(post).find((t) => t.network === body.network);
      if (!target || post.publishResults?.[target.network]?.ok) return response({ error: 'Réseau introuvable sur cette publication.' }, 400);
      const link = typeof body.url === 'string' && safeLink(body.url) ? safeLink(body.url) : '';
      const publishResults = { ...post.publishResults, [target.network]: { ok: true, at: now, manual: true, by: actor, ...(link ? { url: link } : {}) } };
      const allDone = targetsOf(post).every((t) => publishResults[t.network]?.ok);
      const after: RecordItem = {
        ...post, publishResults, ...(allDone ? { publishedAt: now } : {}),
        history: [...(post.history || []), { text: `Publié sur ${networkLabels[target.network]} (à la main, ${actor})`, date: now }].slice(-100),
      };
      const saved = await db.query(
        'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
        [JSON.stringify(after), post.id, workspace.id, post.revision],
      );
      if (!saved.length) return response({ error: 'Cette publication a changé. Actualisez avant de réessayer.' }, 409);
      return result({ id: post.id });
    }

    // ----- devis / facture / contrat: owner-created and owner-managed, visible only to their own client -----

    if (['create', 'update'].includes(body.action) && body.kind === 'document') {
      if (workspace.role !== 'owner') return response({ error: 'Seul le propriétaire peut créer ou modifier un devis, une facture ou un contrat.' }, 403);
      const existing = body.action === 'update' ? rowsNow.find((r) => r.id === body.id && r.kind === 'document') : undefined;
      if (body.action === 'update' && !existing) return response({ error: 'Document introuvable.' }, 404);
      const parsed = documentFields.safeParse(body.data);
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      const data = parsed.data;
      if (data.clientId !== 'internal') {
        const docClient = rowsNow.find((r) => r.kind === 'client' && r.id === data.clientId && !r.archived);
        if (!docClient) return response({ error: 'Sélectionnez un client actif.' }, 400);
      }
      const docStatus: DocStatus = data.docStatus || existing?.docStatus || 'draft';
      if (!docStatusesFor[data.docType].includes(docStatus)) return response({ error: 'Statut invalide pour ce type de document.' }, 400);
      const scope = data.serviceScope ?? existing?.serviceScope;
      const purpose = data.documentPurpose ?? existing?.documentPurpose ?? 'base';
      let sourceTerms: RecordItem['workflowTerms'];
      if (data.requestId && !rowsNow.some(r => r.kind === 'request' && r.id === data.requestId && r.clientId === data.clientId)) return response({ error: 'Demande introuvable pour ce client.' }, 400);
      if (purpose === 'extra' && (data.docType !== 'devis' || !data.requestId || !data.scopeFormat || !data.scopeUnits || data.lineItems.reduce((sum, line) => sum + line.quantity, 0) !== data.scopeUnits)) return response({ error: 'Un devis extra doit préciser la demande, le format et la quantité exacte.' }, 400);
      if (data.sourceDocumentId) {
        const source = rowsNow.find(d => d.kind === 'document' && d.id === data.sourceDocumentId && d.clientId === data.clientId && d.docType === 'devis' && d.docStatus === 'accepted' && (!d.archived || existing?.sourceDocumentId === d.id || data.docType === 'facture'));
        if (!source) return response({ error: 'Choisissez un devis accepté de ce client.' }, 400);
        if (canonical(scope) !== canonical(source.serviceScope) || canonical(data.lineItems) !== canonical(source.lineItems) || (data.taxRate ?? 0) !== (source.taxRate ?? 0)) return response({ error: 'Le contrat doit reprendre le périmètre et les montants du devis accepté.' }, 409);
        if (data.docType === 'contract' && (data.notes || '') !== (source.notes || '')) return response({ error: 'Le contrat doit conserver les conditions particulières du devis accepté.' }, 409);
        sourceTerms = source.workflowTerms ?? workflowSnapshot();
        if (data.workflowSettings && canonical(data.workflowSettings) !== canonical({ validationHours: sourceTerms.validationHours, maxRevisionRounds: sourceTerms.maxRevisionRounds })) return response({ error: 'Le contrat doit conserver les règles de validation du devis accepté.' }, 409);
      }
      if (data.docType === 'contract' && scope && !data.sourceDocumentId) return response({ error: 'Créez le contrat depuis le devis accepté.' }, 400);

      const requestedTerms = sourceTerms ?? (data.workflowSettings ? workflowSnapshot(data.workflowSettings) : existing?.workflowTerms) ?? (scope ? workflowSnapshot(rowsNow.find(r => r.kind === 'client' && r.id === data.clientId)?.workflowSettings ?? (await loadWorkflowState(workspace.id)).settings) : undefined);
      if (existing) {
        if (!nextDocStatuses(existing.docType!, existing.docStatus || 'draft').includes(docStatus)) return response({ error: 'Un document envoyé ne peut pas redevenir un brouillon ; créez une nouvelle version.' }, 409);
        if (docStatus === 'sent' && existing.docStatus === 'draft' && scope && scopeReadiness(scope).length) return response({ error: `Complétez le périmètre avant envoi : ${scopeReadiness(scope).join(', ')}.` }, 400);
        // Once it has left "draft", the client may already have seen it: lock the financial shape.
        // Line items are compared field-by-field, not via JSON.stringify — Postgres jsonb does not
        // preserve object key insertion order, so a round-tripped-but-unchanged item would otherwise
        // look "different" the moment its key order happens to differ from the freshly-parsed input.
        const sameLineItems = (a: typeof data.lineItems, b: typeof data.lineItems) =>
          a.length === b.length && a.every((item, i) => item.description === b[i]?.description && item.quantity === b[i]?.quantity && item.unitPrice === b[i]?.unitPrice);
        const locked = existing.docStatus !== 'draft' && (
          !sameLineItems(existing.lineItems || [], data.lineItems)
          || (existing.taxRate ?? 0) !== (data.taxRate ?? 0)
          || existing.docType !== data.docType
          || existing.clientId !== data.clientId
          || canonical(existing.serviceScope) !== canonical(scope)
          || canonical(existing.workflowTerms) !== canonical(requestedTerms)
          || (existing.notes || '') !== (data.notes || '')
          || (existing.issuedAt || '') !== (data.issuedAt || '')
          || (existing.dueAt || '') !== (data.dueAt || '')
          || (existing.validUntil || '') !== (data.validUntil || '')
          || (existing.sourceDocumentId || '') !== (data.sourceDocumentId || '')
          || (existing.documentPurpose || 'base') !== purpose
          || (existing.requestId || '') !== (data.requestId || '')
          || existing.scopeFormat !== data.scopeFormat
          || existing.scopeUnits !== data.scopeUnits
        );
        if (locked) return response({ error: 'Un document envoyé ne peut plus être modifié sur ses lignes ou son montant.' }, 409);
        if (body.revision !== existing.revision) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
        const statusChanged = docStatus !== existing.docStatus;
        const item: RecordItem = {
          ...existing, name: data.name || existing.name, lineItems: data.lineItems, taxRate: data.taxRate,
          issuedAt: data.issuedAt, dueAt: data.dueAt, validUntil: data.validUntil, notes: data.notes,
          archived: data.archived ?? existing.archived, docStatus,
          serviceScope: scope, documentPurpose: purpose, sourceDocumentId: data.sourceDocumentId, requestId: data.requestId,
          scopeFormat: data.scopeFormat, scopeUnits: data.scopeUnits,
          workflowTerms: requestedTerms,
          sentAt: existing.sentAt ?? (docStatus === 'sent' ? now : undefined),
          ...(statusChanged && ['accepted', 'refused'].includes(docStatus) ? { documentDecision: { by: actor, userId: user.userId, email: user.email, at: now, method: 'studio' as const, status: docStatus as 'accepted' | 'refused' } } : {}),
          history: [...(existing.history || []), { text: statusChanged ? `Statut : ${docStatusLabels[docStatus]}` : 'Modifié', date: now }].slice(-100),
        };
        const changed = await db.query(
          'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
          [JSON.stringify(item), existing.id, workspace.id, body.revision],
        );
        if (!changed.length) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
        return result({ id: item.id });
      }

      // New document: assign the next number for this type this year. The unique index on
      // (workspace, docType, number) is the real guarantee; a WHERE NOT EXISTS insert plus a
      // short retry loop handles the rare case of two people creating one at the same instant.
      const year = new Date(now).getFullYear();
      let createdId: string | null = null;
      for (let attempt = 0; attempt < 3 && !createdId; attempt++) {
        const existingNumbers = await db.query<{ number: string }>(
          `SELECT data->>'number' AS number FROM records WHERE workspace_id = $1 AND kind = 'document' AND data->>'docType' = $2 AND data->>'number' LIKE $3`,
          [workspace.id, data.docType, `${docPrefixes[data.docType]}-${year}-%`],
        );
        const { seq, number } = nextDocNumber(existingNumbers.map((r) => r.number), data.docType, year);
        const item: RecordItem = {
          id: crypto.randomUUID(), kind: 'document', revision: 1, name: data.name || number,
          docType: data.docType, number, seq, docStatus: 'draft', clientId: data.clientId,
          lineItems: data.lineItems, taxRate: data.taxRate, issuedAt: data.issuedAt, dueAt: data.dueAt,
          validUntil: data.validUntil, notes: data.notes, author: actor, createdAt: now,
          serviceScope: scope, workflowTerms: requestedTerms, sourceDocumentId: data.sourceDocumentId, documentPurpose: purpose, requestId: data.requestId,
          scopeFormat: data.scopeFormat, scopeUnits: data.scopeUnits,
          history: [{ text: 'Créé', date: now }],
        };
        try {
          const inserted = await db.query(
            `INSERT INTO records (id, owner, workspace_id, kind, data, revision)
             SELECT $1, $2, $3, 'document', $4::jsonb, 1
             WHERE NOT EXISTS (SELECT 1 FROM records WHERE workspace_id = $3 AND kind = 'document' AND data->>'number' = $5)
             RETURNING id`,
            [item.id, owner, workspace.id, JSON.stringify(item), number],
          );
          if (inserted.length) createdId = item.id;
        } catch (error) {
          if ((error as { code?: string }).code !== '23505') throw error;
          // Number taken meanwhile — loop and recompute from a fresh read.
        }
      }
      if (!createdId) return response({ error: 'Numérotation en cours, réessayez.' }, 409);
      return result({ id: createdId });
    }

    // ----- create / update -----

    if (!['create', 'update'].includes(body.action) || !['client', 'project', 'task'].includes(body.kind)) {
      return response({ error: 'Action invalide.' }, 400);
    }
    if (!canWrite(workspace.role)) return response({ error: 'Votre rôle est en lecture seule.' }, 403);
    if (body.action === 'create' && body.kind === 'client' && workspace.role !== 'owner') {
      return response({ error: 'Seul le propriétaire peut ajouter des clients.' }, 403);
    }
    // The client's own page (brief, contacts, links, logo/banner) is studio-owned: only the
    // owner and admins edit it. A member still edits the client's sub-projects and tasks.
    if (body.kind === 'client' && !isManager(workspace.role)) {
      return response({ error: 'Seuls le propriétaire et les administrateurs peuvent modifier la fiche d’un client.' }, 403);
    }
    const rows = rowsNow;
    const existing =
      body.action === 'update'
        ? rows.find((record) => record.id === body.id && record.kind === body.kind)
        : undefined;
    if (body.action === 'update' && !existing) return response({ error: 'Élément introuvable.' }, 404);
    // A company's plan caps its active clients (a new one, or one brought back from the archive).
    if (body.kind === 'client' && (!existing || (existing.archived && body.data?.archived === false))) {
      const full = await planRefusal(workspace.id, 'clients');
      if (full) return response(full, full.status);
    }
    // A member edits only the tasks within their reach; tasks are created by owners and admins. Clients and sub-projects are shared work.
    if (isMemberRole(workspace.role) && body.kind === 'task' && !existing) return response({ error: 'Les tâches sont créées par le propriétaire ou un administrateur.' }, 403);
    if (isMemberRole(workspace.role) && existing?.kind === 'task' && !isMine(user, existing)) return response({ error: 'Élément introuvable.' }, 404);

    const parsed = fields.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    const data = parsed.data;
    if (data.workflowSettings !== undefined && body.kind !== 'client') return response({ error: 'Les règles personnalisées appartiennent à une fiche client.' }, 400);
    if (data.brief && body.kind !== 'client') return response({ error: 'Le brief de marque appartient à une fiche client.' }, 400);
    if (data.serviceScope && (body.kind !== 'client' || workspace.role !== 'owner')) return response({ error: 'Seul le propriétaire peut définir le périmètre commercial d’un client.' }, 403);
    if (body.kind === 'client') {
      // The legacy paragraph is the brand branch, so the sheet, assistant and visual board agree.
      if (data.brief) data.description = data.brief.overview;
      else if (existing?.brief && data.description !== undefined) data.brief = { ...existing.brief, overview: data.description };
    }
    // A logo or banner must be an image uploaded to *this* workspace — the same rule the voice
    // messages follow. Without it a well-formed id from another workspace would be accepted, and
    // the avatar mirroring below would copy that workspace's bytes.
    if (body.kind === 'client') {
      for (const key of ['logo', 'banner'] as const) {
        const id = data[key];
        if (!id || id === existing?.[key]) continue;
        const owned = await one<{ id: string }>(
          'SELECT id FROM assets WHERE id = $1 AND workspace_id = $2 AND kind = $3', [id, workspace.id, key],
        );
        if (!owned) return response({ error: 'Image introuvable dans cet espace.' }, 400);
      }
    }
    // Logo and banner belong to clients only: other kinds never carry them, so a project can't be
    // used as a handle to reference (and later delete) another record's image.
    if (body.kind !== 'client') { delete data.logo; delete data.banner; }
    let assigneeId = existing?.assigneeId;
    if (body.kind === 'task' && !data.assignee) assigneeId = undefined;
    if (body.kind === 'task' && data.assignee) {
      const availableMembers = await members(workspace.id);
      const allowedAssignees = new Set(
        availableMembers.filter((m) => isStudioRole(m.role)).flatMap((member) => [member.name, member.email].filter((value): value is string => !!value)),
      );
      const matching = availableMembers.filter((m) => isStudioRole(m.role) && [m.name, m.email].includes(data.assignee!));
      if (data.assignee !== existing?.assignee || !assigneeId) {
        if (matching.length > 1) return response({ error: 'Choisissez une personne de l’équipe pour l’assignation.' }, 400);
        if (matching.length === 1) assigneeId = matching[0].userId;
      }
      const unchangedLegacyAssignee = body.action === 'update' && existing?.assignee === data.assignee;
      if (!allowedAssignees.has(data.assignee) && !unchangedLegacyAssignee) {
        return response({ error: 'Choisissez une personne de l’équipe pour l’assignation.' }, 400);
      }
    }
    if (isMemberRole(workspace.role) && !!data.archived !== !!existing?.archived) {
      return response({ error: 'Seuls les administrateurs peuvent archiver ou restaurer des éléments.' }, 403);
    }
    // A member's only edits on a task are the deliverable link and moving it between "À faire",
    // "En cours" and "À valider"; every other field (and "Validé") is off-limits for them.
    // Falsy values (undefined/null/false/'') are treated as equivalent so an unset field sent back
    // as its default (e.g. archived: false) is never mistaken for a change. "publishable" is the
    // one field that defaults to true when unset (the form always resends a real boolean for it),
    // so it gets the same "unset means true" normalization used everywhere else it's read.
    if (isMemberRole(workspace.role) && body.kind === 'task' && existing) {
      const memberEditableFields = new Set(['deliverable', 'status']);
      const normalize = (key: string, value: unknown) => (key === 'publishable' ? value !== false : value || null);
      const touchedFields = (Object.keys(data) as (keyof typeof data)[]).filter(
        (key) => normalize(key, data[key]) !== normalize(key, (existing as Record<string, unknown>)[key]),
      );
      if (touchedFields.some((key) => !memberEditableFields.has(key as string))) {
        return response({ error: 'Un membre ne peut modifier que le lien livrable et le statut de cette tâche.' }, 403);
      }
      // A member pauses and resumes their own work; only validation stays with the studio's managers.
      if (touchedFields.includes('status') && !['À faire', 'En cours', 'En pause', 'À valider'].includes(data.status || '')) {
        return response({ error: 'Un membre ne peut pas passer une tâche à ce statut.' }, 403);
      }
    }
    if (existing?.archived && data.archived !== false) {
      return response({ error: 'Restaurez cet élément avant de le modifier.' }, 400);
    }
    if (body.kind !== 'client' && data.clientId !== 'internal') {
      const client = rows.find((record) => record.kind === 'client' && record.id === data.clientId);
      if (!client || (client.archived && !data.archived)) {
        return response({ error: 'Sélectionnez un client actif.' }, 400);
      }
    }
    let lockLifted = false;
    if (body.kind === 'task') {
      if (existing?.pendingExtraRequestId) {
        const pending = rows.find(r => r.kind === 'request' && r.id === existing.pendingExtraRequestId && r.requestStatus === 'new');
        if (pending && (data.status && data.status !== existing.status || data.deliverable && data.deliverable !== existing.deliverable)) return response({ error: 'Ce tour hors forfait attend un devis accepté. Traitez la demande avant de reprendre la production.' }, 409);
      }
      if (data.projectId) {
        const project = rows.find(
          (record) => record.kind === 'project' && record.id === data.projectId && record.clientId === data.clientId,
        );
        if (!project || (project.archived && !data.archived)) {
          return response({ error: 'Sélectionnez un sous-projet de ce client.' }, 400);
        }
      }
      data.status = data.status || 'À faire';
      // "À valider" is never picked manually: saving a new/changed deliverable link is what sends a task for validation.
      const previousStatus = existing?.status || 'À faire';
      if (data.status === previousStatus && existing?.status !== 'Validé' && data.deliverable && data.deliverable !== existing?.deliverable) {
        data.status = 'À valider';
      }
      if (isMemberRole(workspace.role) && data.status === 'Validé' && existing?.status !== 'Validé') {
        return response({ error: 'Seuls le client, le propriétaire ou un administrateur peuvent valider un livrable.' }, 403);
      }
      if (['À valider', 'Validé'].includes(data.status) && !data.deliverable) {
        return response({ error: 'Ajoutez un lien livrable avant la validation.' }, 400);
      }
      if (data.evergreen && data.due) {
        return response({ error: 'Un contenu de réserve n’a pas de date de publication. Retirez la date ou sortez-le de la réserve.' }, 400);
      }
      // J−7 lock: the calendar is frozen one week out. Admins may lift it explicitly; the lift is recorded.
      if (data.publishable !== false && lockApplies(existing?.due, data.due, today)) {
        if (!canManageMembers(workspace.role)) {
          return response({ error: `Verrou J−${flow.lockDays} : cette date est trop proche. Demandez à un administrateur de lever le verrou.`, code: 'lock' }, 403);
        }
        if (body.lockOverride !== true) {
          return response({ error: `Verrou J−${flow.lockDays} : cette date tombe dans la semaine gelée. Confirmez pour lever le verrou.`, code: 'lock' }, 409);
        }
        lockLifted = true;
      }
    }
    if (existing?.status === 'Validé' && data.deliverable !== existing.deliverable) data.status = 'En cours';

    let item = {
      ...existing,
      ...data,
      ...(body.kind === 'task' ? { assigneeId } : {}),
      id: existing?.id || crypto.randomUUID(),
      kind: body.kind,
      createdAt: existing?.createdAt || now,
    } as RecordItem;
    if (body.kind === 'task') item.effectiveWorkflow = rowsNow.find(r => r.kind === 'client' && r.id === item.clientId)?.effectiveWorkflow ?? (await loadWorkflowState(workspace.id)).settings;
    if (lockLifted) item.lockOverride = true;
    const statusChanged = data.status !== existing?.status;

    
    if (body.kind === 'task' && statusChanged) {
      if (data.status === 'À valider') item = sendForValidation({ ...item, status: existing?.status }, now);
      else if (data.status === 'Validé') item = approve({ ...item, status: existing?.status }, { mode: 'studio', by: actor, email: user.email, at: now, round: item.revisionRound ?? 0 });
      else {
        // Internal rejection or a step back: the clock stops and is not counted as a client round.
        item.approvalDueAt = undefined;
        if (existing?.status === 'Validé') { item.validatedAt = undefined; item.signOff = undefined; }
      }
    }
    // Leaving « En cours » — for whatever status — stops every clock running on the task: everyone's,
    // not just the person who clicked (see stopClocks). Validation paths do it in lib/flow.ts.
    if (body.kind === 'task' && statusChanged && item.status !== 'En cours') item = stopClocks(item, now);
    const transitionLogged = body.kind === 'task' && statusChanged && (data.status === 'À valider' || data.status === 'Validé');
    if (!transitionLogged) {
      item.history = [
        ...(existing?.history || []),
        {
          text: !existing
            ? 'Élément créé'
            : data.archived && !existing.archived
              ? 'Élément archivé'
              : !data.archived && existing.archived
                ? 'Élément restauré'
                : data.status !== existing.status
                  ? `Statut : ${data.status}`
                  : 'Informations mises à jour',
          date: now,
        },
      ].slice(-100);
    }
    if (lockLifted) item.history = [...(item.history || []), { text: `Verrou J−${flow.lockDays} levé par ${actor} pour le ${data.due}`, date: now }].slice(-100);
    if (existing?.evergreen && data.due && !data.evergreen) {
      item.evergreen = false;
      item.history = [...(item.history || []), { text: `Sorti de la réserve · planifié le ${data.due}`, date: now }].slice(-100);
    }

    if (existing) {
      if (body.revision !== existing.revision) {
        return response({ error: 'Cet élément a changé. Actualisez avant de réessayer.' }, 409);
      }
      const changed = await db.query(
        'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id',
        [JSON.stringify(item), existing.id, workspace.id, body.revision],
      );
      if (!changed.length) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
      if (body.kind === 'task' && statusChanged && item.status === 'Validé') after(() => notifyOwnerOfApproval(workspace.id, item, new URL(req.url).origin, rowsNow.find((r) => r.kind === 'client' && r.id === item.clientId)?.name));
      // Replaced or removed images are dropped right away; ids are never reused.
      const dropped = (['logo', 'banner'] as const).filter((k) => existing[k] && existing[k] !== item[k]).map((k) => existing[k]!);
      if (dropped.length) await db.query("DELETE FROM assets WHERE workspace_id = $1 AND kind IN ('logo', 'banner') AND id = ANY($2::text[])", [workspace.id, dropped]);
    } else {
      await insert(item);
    }
    // A client's logo change mirrors onto every client-portal member already tied to that client.
    if (body.kind === 'client' && item.logo !== existing?.logo) await syncClientAvatars(item.id, item.logo);
    // Studio-wide events for the polling alerts panel: a new client, or a task handed to someone.
    // IDs are prefixed evt: (like every other event) so mark-read recognizes and can clear them.
    if (body.kind === 'client' && !existing) {
      await insert({ id: `evt:${item.id}:client-added:${now}`, kind: 'event', revision: 1, type: 'client-added', audience: 'studio',
        name: `Nouveau client « ${item.name} » ajouté par ${actor}.`, clientId: item.id, createdAt: now }, true);
    }
    // Targeted at the new assignee specifically — not a studio-wide broadcast, and never for
    // assigning something to yourself (nothing to notify).
    if (body.kind === 'task' && item.assigneeId !== existing?.assigneeId && item.assigneeId && item.assigneeId !== user.userId) {
      await insert({ id: `evt:${item.id}:task-assigned:${now}`, kind: 'event', revision: 1, type: 'task-assigned', audience: 'studio',
        name: `« ${item.name} » assignée à ${data.assignee} par ${actor}.`, taskId: item.id, clientId: item.clientId, createdAt: now,
        recipients: [item.assigneeId], readBy: [] }, true);
    }
    // Send only after the optimistic save succeeds; unrelated edits never resend.
    const assignmentWhatsapp = body.kind === 'task'
      ? await notifyTaskAssignment(workspace.id, item, existing, user.userId, actor, new URL(req.url).origin) : undefined;
    const whatsapp = body.kind === 'task' && statusChanged && item.status === 'À valider'
      ? await notifyTaskApproval(workspace.id, item, rowsNow, new URL(req.url).origin) : undefined;
    return result({ id: item.id,
      ...(whatsapp ? { whatsapp: { sent: whatsapp.sent, error: whatsapp.error } } : {}),
      ...(assignmentWhatsapp ? { assignmentWhatsapp: { sent: assignmentWhatsapp.sent, error: assignmentWhatsapp.error } } : {}),
    });
  } catch (error) {
    if (error instanceof CommercialError) return response({ error: error.message }, error.status);
    if (error instanceof NoWorkspaceError) return response({ error: 'Aucun espace ne vous est attribué. Demandez une invitation au studio.', code: 'no-workspace' }, 403);
    if (error instanceof WorkspaceAccessError) return response({ error: 'Vous n’avez plus accès à cet espace.' }, 403);
    console.error('save record', error);
    return response({ error: 'Enregistrement impossible. Vos saisies sont conservées ; réessayez.' }, 503);
  }
}
