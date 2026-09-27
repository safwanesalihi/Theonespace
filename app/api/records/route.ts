import { createHash } from 'node:crypto';
import { getAppUser, type AppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { batch, database, type Statement } from '@/lib/database';
import { env } from '@/lib/env';
import { nextRepeatDay, normalizeRepeat } from '@/lib/social-repeat';
import { isMediaSource } from '@/lib/media-source';
import { acceptFields, fields, inviteFields, requestFields, libraryFields, documentFields, platformFields, editorialPostFields } from '@/lib/validation';
import { RecordItem, safeLink, channels as taskChannels, type Attachment, type DocStatus } from '@/lib/model';
import { mediaOf, networkLabels, targetsOf } from '@/lib/social';
import { docPrefixes, docStatusesFor, docStatusLabels, nextDocNumber } from '@/lib/documents';
import {
  canManageMembers, canSocial, cleanTitles, invitableRolesFor, isManager, memberName, isMemberRole, isStudioRole, isWorkspaceRole, roleLabels, titleLimits,
  type WorkspaceContext, type WorkspaceMember, type WorkspaceRole, type WorkspaceSummary,
} from '@/lib/workspace';
import {
  approve, dayIn, flow, isEventRecipient, lockApplies, memberView, portalView, publish, requestChanges, sendForValidation, stopClocks,
} from '@/lib/flow';
import { applySweep, closeStaleClocks, ensurePlatforms, purgeDemoRecords, insertRecord, loadRecords } from '@/lib/flow-server';
import { isOwnerEmail, provisionAccount } from '@/lib/password-auth';
import { mailConfigured, sendClientNotice, sendInvitation } from '@/lib/mail';
import { messageNoticeConfigured, sendApprovalRequest, sendMessageNotice, whatsappConfigured, type WhatsappResult } from '@/lib/whatsapp';
import { mediaStorageConfigured, removeMedia } from '@/lib/media-storage';
import { removeClientAccounts } from '@/lib/social-accounts';
import { isCompanyWorkspaceId, isPrintWorkspaceId } from '@/lib/workspace';
import { printVisible } from '@/lib/printing';
import { canPlanMeetings, meetingFields } from '@/lib/meetings';
import { mutatePrinting } from '@/lib/printing-server';

export const dynamic = 'force-dynamic';

class WorkspaceAccessError extends Error {}
class NoWorkspaceError extends Error {}

const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

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
    `SELECT wm.user_id AS "userId", wm.role, wm.name, wm.email, wm.client_id AS "clientId", wm.created_at AS "createdAt", u.avatar,
            t.data->'titles' AS titles${withState
      ? ', (u.must_change_password AND u.last_login_at IS NULL) AS "pending", u.last_login_at AS "lastLoginAt"' : ''}
     FROM workspace_members wm LEFT JOIN users u ON u.id = wm.user_id
     LEFT JOIN records t ON t.kind = 'meta' AND t.workspace_id = wm.workspace_id AND t.id = 'titles:' || wm.workspace_id || ':' || wm.user_id
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
  !task.assignee?.trim() || (task.assigneeId ? task.assigneeId === user.userId : identitiesOf(user).some((v) => v.trim().toLowerCase() === task.assignee!.trim().toLowerCase()));

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
  if (workspace.role === 'client') return portalView(rows, workspace.clientId!);
  if (isMemberRole(workspace.role)) return memberView(rows, identitiesOf(user), user.userId, workspace.role === 'social');
  // Devis/factures/contrats are owner + client only — admin and viewer never see that they exist.
  if (workspace.role !== 'owner') return rows.filter((r) => r.kind !== 'document');
  return rows;
}

async function payload(workspace: WorkspaceContext, user: AppUser, rows?: RecordItem[]) {
  const [loaded, roster, workspaces] = await Promise.all([
    rows ? Promise.resolve(rows) : all(workspace.id),
    workspace.role === 'client' ? Promise.resolve([] as WorkspaceMember[]) : members(workspace.id, canManageMembers(workspace.role), user.userId),
    workspacesFor(user),
  ]);
  return {
    records: visibleTo(workspace, loaded, user),
    user: { id: user.userId, name: user.fullName || user.displayName, email: user.email, avatar: user.avatar },
    workspace,
    // Members get the roster for display only: no e-mails but their own.
    members: canManageMembers(workspace.role) ? roster : roster.map((m) => ({ ...m, email: m.userId === user.userId ? m.email : null })),
    workspaces,
    today: dayIn(new Date()),
    mailConfigured: mailConfigured(),
    mediaStorage: mediaStorageConfigured(),
    // The studio's owner (OWNER_EMAIL): the print workspace and the finance page are theirs alone.
    platformOwner: isOwnerEmail(user.email),
  };
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
    const rows = await all(workspace.id);
    if (!clientContextValid(workspace, rows)) {
      return response({ error: 'Votre accès client n’est plus actif. Contactez le studio.' }, 403);
    }
    // The page polls every few seconds: when nothing changed, a 304 with no body spares the download
    // and the re-render (the ETag is a hash of exactly what would have been sent).
    const text = JSON.stringify(await payload(workspace, user, rows));
    const etag = `W/"${createHash('sha1').update(text).digest('base64url')}"`;
    const headers = { 'Cache-Control': 'no-store', ETag: etag };
    if (req?.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(text, { headers: { ...headers, 'Content-Type': 'application/json' } });
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
    if (raw.length > 25000) return response({ error: 'Le contenu est trop long.' }, 413);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return response({ error: 'Requête invalide.' }, 400);
    }
    if (!isObject(parsedBody)) return response({ error: 'Requête invalide.' }, 400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- action dispatch reads loosely typed fields, each validated below
    const body = parsedBody as Record<string, any>;

    const db = database();
    const owner = user.userId;
    const workspace = await workspaceFor(user, req.headers.get('X-Workspace-Id'));
    const now = new Date().toISOString();
    const today = dayIn(new Date());
    const actor = user.fullName || user.displayName;
    const result = async (extra: Record<string, unknown> = {}) => response({ ...(await payload(workspace, user)), ...extra });

    const rowsNow = await all(workspace.id);
    if (!clientContextValid(workspace, rowsNow)) return response({ error: 'Votre accès client n’est plus actif. Contactez le studio.' }, 403);

    if (isPrintWorkspaceId(workspace.id)) {
      if (workspace.role === 'client') return response({ error: 'Accès non autorisé.' }, 403);
      if (['print-save', 'print-task-status', 'print-delete'].includes(body.action)) {
        const changed = await mutatePrinting(workspace, owner, actor, body, rowsNow);
        if ('error' in changed) return response({ error: changed.error }, changed.status);
        return result({ id: changed.id });
      }
      const shared = ['invite-member', 'renew-invitation', 'set-member-role', 'remove-member', 'set-member-titles', 'update-profile', 'start-timer', 'stop-timer'];
      if (!shared.includes(body.action)) return response({ error: 'Cette action n’est pas disponible dans Impression.' }, 403);
    }

    const parentArchived = (rows: RecordItem[], task: RecordItem) =>
      !!task.archived || !!rows.find((r) => r.id === task.clientId)?.archived || !!rows.find((r) => r.id === task.projectId)?.archived;

    const findTask = (rows: RecordItem[], id: unknown) => {
      const task = rows.find((r) => r.id === id && r.kind === 'task');
      if (!task || parentArchived(rows, task)) return null;
      if (workspace.role === 'client' && task.clientId !== workspace.clientId) return null;
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
        const name = (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\\/]+/g, ' ').trim().slice(0, 120) || (row.content_type === 'application/pdf' ? 'document.pdf' : 'photo');
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
      const url = env.AUTH_URL ?? new URL(req.url).origin;
      const mail = await sendInvitation({ to: email, name, temporaryPassword, studio: studioName, url, roleLabel, renewal });
      // The temporary password is returned only when the studio has to pass it on by hand.
      return { email, sent: mail.sent, error: mail.error, temporaryPassword: mail.sent ? undefined : temporaryPassword, url };
    };

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
        if (role === 'client' && clientLogo) await syncMemberAvatar(existingAccount.id, clientLogo);
        const url = env.AUTH_URL ?? new URL(req.url).origin;
        return response({ workspace, members: await members(workspace.id, true, user.userId), invitation: { email, sent: false, existingAccount: true, url } });
      }
      const account = await provisionAccount(db, email, name ?? '');
      await attachMembership(account.userId);
      if (inviteTitles.length) await storeTitles(workspace.id, account.userId, inviteTitles, owner);
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
      const byOwner = workspace.role === 'owner';
      if (!byOwner && target.role === 'admin') return response({ error: 'Seul le propriétaire peut renouveler l’accès d’un administrateur.' }, 403);
      if (!byOwner && !mailConfigured()) return response({ error: 'L’e-mail n’est pas configuré : seul le propriétaire peut renouveler un accès et transmettre le mot de passe temporaire.' }, 403);
      const account = await provisionAccount(db, target.email.toLowerCase(), target.name ?? '');
      const delivered = await deliver(target.email.toLowerCase(), target.name ?? '', roleLabels[target.role], account.temporaryPassword, true);
      const invitation = byOwner || delivered.sent ? delivered
        : { ...delivered, temporaryPassword: undefined, error: `${delivered.error ?? 'E-mail non envoyé.'} Demandez au propriétaire de renouveler l’accès.` };
      return response({ workspace, members: await members(workspace.id, true, user.userId), invitation });
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
      }
      if (body.action === 'set-member-role' && body.role === 'client' && clientLogo) await syncMemberAvatar(body.userId, clientLogo);
      // A client access never works in the print workspace: one given from here goes with the switch.
      if (body.action === 'set-member-role' && body.role === 'client' && !isPrintWorkspaceId(workspace.id)) {
        await db.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role != 'owner'", [`${workspace.id}:print`, body.userId]);
      }
      const refreshedWorkspace = await workspaceFor(user, workspace.id);
      return response({ workspace: refreshedWorkspace, members: await members(workspace.id, true, user.userId) });
    }


    // ----- the single channel -----

    if (body.action === 'comment') {
      if (workspace.role === 'viewer') return response({ error: 'Votre rôle est en lecture seule.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task) return response({ error: 'Tâche introuvable.' }, 404);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const voice = await voiceMessage();
      if (voice && typeof voice === 'object') return response(voice, 400);
      const files = await messageFiles();
      if (!Array.isArray(files)) return response(files, 400);
      if ((!text && !voice && !files.length) || text.length > 5000) {
        return response({ error: 'Écrivez un message de 1 à 5 000 caractères, enregistrez un message vocal ou joignez un fichier.' }, 400);
      }
      const comment: RecordItem = {
        id: crypto.randomUUID(), kind: 'comment', revision: 1, name: text, taskId: task.id,
        clientId: task.clientId, author: actor, authorId: user.userId, createdAt: now,
        ...(voice ? { audio: voice } : {}),
        ...(files.length ? { attachments: files } : {}),
        ...(workspace.role === 'client' ? { audience: 'client' as const } : {}),
      };

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
      const recipients = [...new Set([task.assigneeId, studioOwner, ...priorAuthorIds].filter((id): id is string => !!id && id !== user.userId))];
      const preview = text
        ? `${actor} a commenté : « ${text.substring(0, 30)}${text.length > 30 ? '...' : ''} » sur la tâche « ${task.name} ».`
        : files.length
          ? `${actor} a envoyé ${files.length > 1 ? `${files.length} fichiers` : `« ${files[0].name} »`} sur la tâche « ${task.name} ».`
          : `${actor} a laissé un message vocal sur la tâche « ${task.name} ».`;

      if (workspace.role === 'client') {
        // The client's own comment: notify studio, targeted at whoever's actually on this task.
        if (recipients.length) statements.push(insertRecord({
          id: `evt:${task.id}:comment:${now}`, kind: 'event', revision: 1, type: 'comment', audience: 'studio',
          name: preview, taskId: task.id, clientId: task.clientId, createdAt: now, recipients, readBy: [],
        }, 'system', workspace.id, true));
      } else {
        // The client still hears about every studio comment (unchanged, broadcast). Teammates on
        // this task now also get a targeted notification, which didn't exist before at all.
        statements.push(insertRecord({
          id: `evt:${task.id}:comment:${now}`, kind: 'event', revision: 1, type: 'comment', audience: 'client',
          name: preview, taskId: task.id, clientId: task.clientId, createdAt: now,
        }, 'system', workspace.id, true));
        if (recipients.length) statements.push(insertRecord({
          id: `evt:${task.id}:comment:studio:${now}`, kind: 'event', revision: 1, type: 'comment', audience: 'studio',
          name: preview, taskId: task.id, clientId: task.clientId, createdAt: now, recipients, readBy: [],
        }, 'system', workspace.id, true));
      }

      // Mentions parsing
      const mentions = [...text.matchAll(/@([^\s]+)/g)].map(m => m[1]);
      if (mentions.length > 0) {
        mentions.forEach(mention => {
          statements.push(insertRecord({
            id: `evt:${task.id}:mention:${mention}:${now}`, kind: 'event', revision: 1, type: 'comment', audience: 'studio',
            name: `${actor} vous a mentionné (@${mention}) sur la tâche « ${task.name} ».`, 
            taskId: task.id, clientId: task.clientId, createdAt: now
          }, 'system', workspace.id, true));
        });
      }

      await batch(db, statements);

      // The client hears on WhatsApp that the studio wrote to them (when the « nouveau message » template
      // is set up and their file has a number) — once per task every 2 hours, not at every message.
      if (workspace.role !== 'client' && messageNoticeConfigured()) {
        const taskClient = rowsNow.find((r) => r.kind === 'client' && r.id === task.clientId && !r.archived);
        const since = new Date(Date.now() - 2 * 3600_000).toISOString();
        const recent = rowsNow.some((r) => r.kind === 'event' && r.type === 'whatsapp' && r.taskId === task.id && r.id.includes(':whatsapp-message:') && r.createdAt >= since);
        if (taskClient?.whatsapp && !recent) {
          const sent = await sendMessageNotice({ to: taskClient.whatsapp, clientName: taskClient.name, from: actor, taskName: task.name, url: env.AUTH_URL ?? new URL(req.url).origin });
          await insert({
            id: `evt:${task.id}:whatsapp-message:${now}`, kind: 'event', revision: 1, type: 'whatsapp', audience: 'studio',
            name: sent.sent ? `WhatsApp envoyé à ${taskClient.name} : nouveau message sur « ${task.name} ».` : `WhatsApp non envoyé à ${taskClient.name} pour le message sur « ${task.name} » — ${sent.error}`,
            taskId: task.id, clientId: taskClient.id, createdAt: now,
          }, true);
        }
      }
      return result();
    }

    // Deleting a message: the owner and admins only. The bubble stays, as « Message supprimé » with who
    // removed it and when, so the thread still reads right; its text, voice note and files are gone.
    if (body.action === 'comment-delete') {
      if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs suppriment des messages.' }, 403);
      const comment = rowsNow.find((r) => r.kind === 'comment' && r.id === body.id);
      if (!comment) return response({ error: 'Message introuvable.' }, 404);
      if (comment.deletedAt) return result();
      const files = [comment.audio, ...(comment.attachments ?? []).map((a) => a.id)].filter((id): id is string => !!id);
      const { audio, attachments, ...kept } = comment;
      void audio; void attachments;
      if (!(await saveTask(comment, { ...kept, name: '', deletedAt: now, deletedBy: actor }))) return response({ error: 'Ce message a changé. Actualisez avant de réessayer.' }, 409);
      if (files.length) await db.query("DELETE FROM assets WHERE workspace_id = $1 AND kind IN ('audio', 'file') AND id = ANY($2::text[])", [workspace.id, files]);
      return result();
    }

    // ----- validation: explicit approval, request for changes, publication -----

    if (body.action === 'approve') {
      if (workspace.role === 'viewer') return response({ error: 'Votre rôle est en lecture seule.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task) return response({ error: 'Livrable introuvable.' }, 404);
      if (task.status !== 'À valider') return response({ error: 'Ce livrable n’est pas en attente de validation.' }, 409);
      const mode = workspace.role === 'client' ? 'explicit' : 'studio';
      const after = approve(task, { mode, by: actor, email: user.email, at: now, round: task.revisionRound ?? 0 });
      if (!(await saveTask(task, after))) return response({ error: 'Ce livrable a changé. Actualisez avant de réessayer.' }, 409);
      await insert({ id: `evt:${task.id}:decision:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
        name: `« ${task.name} » validé par ${actor}${mode === 'studio' ? ' (depuis le studio)' : ''}.`, taskId: task.id, clientId: task.clientId, createdAt: now }, true);
      return result({ id: task.id });
    }

    if (body.action === 'request-changes') {
      if (workspace.role === 'viewer') return response({ error: 'Votre rôle est en lecture seule.' }, 403);
      const task = findTask(rowsNow, body.taskId);
      if (!task) return response({ error: 'Livrable introuvable.' }, 404);
      if (task.status !== 'À valider') return response({ error: 'Ce livrable n’est pas en attente de validation.' }, 409);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const voice = await voiceMessage();
      if (voice && typeof voice === 'object') return response(voice, 400);
      if ((!text && !voice) || text.length > 5000) {
        return response({ error: 'Précisez les modifications demandées (1 à 5 000 caractères), ou enregistrez un message vocal.' }, 400);
      }
      const after = requestChanges(task, actor, now);
      const round = after.revisionRound!;
      const tag = round > flow.maxRevisionRounds ? `Retours client — tour ${round} · hors forfait` : `Retours client — tour ${round}`;
      if (!(await saveTask(task, after))) return response({ error: 'Ce livrable a changé. Actualisez avant de réessayer.' }, 409);
      await insert({ id: crypto.randomUUID(), kind: 'comment', revision: 1, name: text ? `[${tag}] ${text}` : `[${tag}]`, taskId: task.id,
        clientId: task.clientId, author: actor, authorId: user.userId, createdAt: now, ...(voice ? { audio: voice } : {}),
        ...(workspace.role === 'client' ? { audience: 'client' as const } : {}) });
      await insert({ id: `evt:${task.id}:round:${round}:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
        name: `${tag} sur « ${task.name} » (${actor}).`, taskId: task.id, clientId: task.clientId, createdAt: now }, true);
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
      if (existing && existing.revision !== body.revision) return response({ error: 'Cette réunion a changé. Actualisez avant de réessayer.' }, 409);
      if (existing?.cancelledAt) return response({ error: 'Cette réunion est annulée.' }, 400);
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
        if (emails.length) await sendClientNotice({ to: [...new Set(emails)], clientName: client.name, studio: studioName, url: env.AUTH_URL ?? new URL(req.url).origin, pendingTasks: [],
          news: `${what} — ${when} (${fields.duration} min, heure du Maroc). Rejoignez-la depuis votre espace, onglet « Réunions ».` });
      }
      return result({ id: meeting.id });
    }

    if (body.action === 'meeting-cancel') {
      if (!canPlanMeetings(workspace.role)) return response({ error: 'Seuls le propriétaire, les administrateurs et les social media managers planifient les réunions.' }, 403);
      const meeting = rowsNow.find((r) => r.kind === 'meeting' && r.id === body.id);
      if (!meeting) return response({ error: 'Réunion introuvable.' }, 404);
      if (meeting.cancelledAt) return result();
      if (!(await saveTask(meeting, { ...meeting, cancelledAt: now }))) return response({ error: 'Cette réunion a changé. Actualisez avant de réessayer.' }, 409);
      const what = `${meeting.callMode === 'audio' ? 'L’appel audio' : 'La réunion'} « ${meeting.name} » du ${meeting.due?.split('-').reverse().join('/')} à ${meeting.time} est annulé${meeting.callMode === 'audio' ? '' : 'e'}.`;
      const statements: Statement[] = [];
      const told = (meeting.attendees ?? []).filter((id) => id !== user.userId);
      if (told.length) statements.push(insertRecord({ id: `evt:${meeting.id}:cancel`, kind: 'event', revision: 1, type: 'meeting', audience: 'studio', meetingId: meeting.id, clientId: meeting.clientId, name: what, createdAt: now, recipients: told, readBy: [] }, 'system', workspace.id, true));
      if (meeting.clientId) statements.push(insertRecord({ id: `evt:${meeting.id}:cancel-client`, kind: 'event', revision: 1, type: 'meeting', audience: 'client', meetingId: meeting.id, clientId: meeting.clientId, name: what, createdAt: now }, 'system', workspace.id, true));
      if (statements.length) await batch(db, statements);
      return result();
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
      if (data.projectId && !rowsNow.some((r) => r.kind === 'project' && r.clientId === client.id && !r.archived && r.id === data.projectId)) {
        return response({ error: 'Choisissez un sous-projet de ce client.' }, 400);
      }
      // A request waits in the studio's inbox (« Demandes »); the owner or an admin makes it a task — or not.
      const platforms = [...new Set([...(data.platforms ?? []), ...(data.channel ? [data.channel] : [])])];
      const request: RecordItem = {
        id: crypto.randomUUID(), kind: 'request', revision: 1, name: data.name, clientId: client.id, projectId: data.projectId || undefined,
        description: data.description || '', due: data.due || '', platforms, requestStatus: 'new',
        request: { by: actor, email: user.email, at: now }, createdAt: now,
      };
      const managers = (await db.query<{ userId: string }>("SELECT user_id AS \"userId\" FROM workspace_members WHERE workspace_id = $1 AND role IN ('owner', 'admin')", [workspace.id]))
        .map((m) => m.userId).filter((id) => id !== user.userId);
      await batch(db, [
        insertRecord(request, owner, workspace.id),
        insertRecord({ id: `evt:${request.id}:request`, kind: 'event', revision: 1, type: 'request', audience: 'studio', requestId: request.id, clientId: client.id,
          name: `Nouvelle demande de ${client.name} : « ${request.name} »${data.due ? ` pour le ${data.due.split('-').reverse().join('/')}` : ''}${platforms.length ? ` (${platforms.join(', ')})` : ''}.`,
          createdAt: now, ...(managers.length ? { recipients: managers, readBy: [] } : {}) }, 'system', workspace.id, true),
      ]);
      return result({ id: request.id });
    }

    if (body.action === 'request-accept' || body.action === 'request-decline') {
      if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs traitent les demandes.' }, 403);
      const request = rowsNow.find((r) => r.kind === 'request' && r.id === body.id);
      if (!request) return response({ error: 'Demande introuvable.' }, 404);
      if (request.requestStatus !== 'new') return response({ error: 'Cette demande a déjà été traitée.' }, 409);
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
      const task: RecordItem = {
        id: crypto.randomUUID(), kind: 'task', revision: 1, name: data.name, clientId: client.id, projectId: project.id,
        description, due: data.due ?? request.due ?? '', channel, platforms, status: 'À faire', source: 'Portail',
        ...(assignee ? { assignee: memberName(assignee), assigneeId: assignee.userId } : {}),
        request: request.request, createdAt: now,
        history: [{ text: `Demande du portail (${request.request?.by ?? client.name}) acceptée par ${actor}`, date: now }],
      };
      const accepted = { ...request, requestStatus: 'accepted' as const, taskId: task.id, decision: { by: actor, at: now } };
      if (!(await saveTask(request, accepted))) return response({ error: 'Cette demande a changé. Actualisez avant de réessayer.' }, 409);
      statements.push(insertRecord(task, owner, workspace.id));
      statements.push(told(`Votre demande « ${request.name} » est acceptée${task.due ? ` : prévue pour le ${task.due.split('-').reverse().join('/')}` : ''}.`, { taskId: task.id }));
      if (assignee && assignee.userId !== user.userId) statements.push(insertRecord({ id: `evt:${task.id}:task-assigned:${now}`, kind: 'event', revision: 1, type: 'task-assigned', audience: 'studio',
        name: `« ${task.name} » assignée à ${memberName(assignee)} par ${actor}.`, taskId: task.id, clientId: client.id, createdAt: now, recipients: [assignee.userId], readBy: [] }, 'system', workspace.id, true));
      await batch(db, statements);
      return result({ id: task.id });
    }

    if (body.action === 'delete' && body.kind === 'library') {
      if (!isStudioRole(workspace.role) || workspace.role === 'viewer') return response({ error: 'Votre rôle ne peut pas modifier la bibliothèque.' }, 403);
      const item = rowsNow.find((r) => r.id === body.id && r.kind === 'library');
      if (!item) return response({ error: 'Élément introuvable.' }, 404);
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
      if (!isStudioRole(workspace.role)) return response({ error: 'Action réservée au studio.' }, 403);
      const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.startsWith('evt:')).slice(0, 200) : [];
      const events = rowsNow.filter((r) => r.kind === 'event' && ids.includes(r.id));
      // Broadcast events (no `recipients`) keep the old shared boolean, overwritten directly — safe
      // since it's idempotent. Targeted events get a per-user, race-safe append to `readBy` instead:
      // a one-shot click has no retry, unlike the read-modify-write this app uses elsewhere for state
      // that gets idempotently recomputed anyway (e.g. `reminders` in the sweep).
      const statements: Statement[] = [
        ...events.filter((e) => !e.recipients && !e.read).map((event) => ({
          text: 'UPDATE records SET data = $1::jsonb WHERE id = $2 AND workspace_id = $3',
          params: [JSON.stringify({ ...event, read: true }), event.id, workspace.id],
        })),
        ...events.filter((e) => isEventRecipient(e, user.userId)).map((event) => ({
          text: `UPDATE records SET data = jsonb_set(data, '{readBy}', COALESCE(data->'readBy','[]'::jsonb) || to_jsonb($1::text))
                 WHERE id = $2 AND workspace_id = $3 AND kind = 'event' AND NOT (COALESCE(data->'readBy','[]'::jsonb) ? $1::text)`,
          params: [user.userId, event.id, workspace.id],
        })),
      ];
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
      const url = env.AUTH_URL ?? new URL(req.url).origin;
      const mail = await sendClientNotice({ to: emails, clientName: client.name, studio: studioName, url, pendingTasks, news });
      if (!mail.sent) return response({ error: mail.error || 'Envoi impossible.' }, 502);
      return result({ sent: true, emailCount: emails.length });
    }

    // ----- library: shared team resources (prompts, assets, plugins, presets) — never the client -----

    if (['create', 'update'].includes(body.action) && body.kind === 'library') {
      if (!isStudioRole(workspace.role) || workspace.role === 'viewer') {
        return response({ error: 'Votre rôle ne peut pas modifier la bibliothèque.' }, 403);
      }
      const existing = body.action === 'update' ? rowsNow.find((r) => r.id === body.id && r.kind === 'library') : undefined;
      if (body.action === 'update' && !existing) return response({ error: 'Élément introuvable.' }, 404);
      const parsed = libraryFields.safeParse(body.data);
      if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
      const item: RecordItem = {
        ...existing, ...parsed.data, id: existing?.id || crypto.randomUUID(), kind: 'library', revision: existing?.revision ?? 1,
        author: existing?.author || actor, createdAt: existing?.createdAt || now,
        history: [...(existing?.history || []), { text: existing ? 'Modifié' : 'Ajouté', date: now }].slice(-100),
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
      const mediaList = media
        ? media.map((m) => m.source === 'drive'
          ? { url: m.url, type: m.type, source: 'drive' as const, ...(m.thumb ? { thumb: m.thumb } : {}), ...(m.mime ? { mime: m.mime } : {}), ...(m.name ? { name: m.name } : {}) }
          : { url: m.url, type: m.type, ...ownPath(m.path) })
        : mediaType && mediaUrl ? [{ url: mediaUrl, type: mediaType, ...ownPath(mediaPath) }]
        : existing ? mediaOf(existing) : [];
      // Photos and videos come from the app's storage or Google Drive, nowhere else: the server
      // downloads them to publish, so any other address is refused (lib/media-source.ts).
      if ((media || mediaUrl) && mediaList.some((m) => !isMediaSource(m.url))) {
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

      if (existing) {
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
        );
        if (locked) return response({ error: 'Un document envoyé ne peut plus être modifié sur ses lignes ou son montant.' }, 409);
        if (body.revision !== existing.revision) return response({ error: 'Ce document a changé. Actualisez avant de réessayer.' }, 409);
        const statusChanged = docStatus !== existing.docStatus;
        const item: RecordItem = {
          ...existing, name: data.name || existing.name, lineItems: data.lineItems, taxRate: data.taxRate,
          issuedAt: data.issuedAt, dueAt: data.dueAt, validUntil: data.validUntil, notes: data.notes,
          archived: data.archived ?? existing.archived, docStatus,
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
    // A member edits only the tasks within their reach; tasks are created by owners and admins. Clients and sub-projects are shared work.
    if (isMemberRole(workspace.role) && body.kind === 'task' && !existing) return response({ error: 'Les tâches sont créées par le propriétaire ou un administrateur.' }, 403);
    if (isMemberRole(workspace.role) && existing?.kind === 'task' && !isMine(user, existing)) return response({ error: 'Élément introuvable.' }, 404);

    const parsed = fields.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    const data = parsed.data;
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
      // Replaced or removed images are dropped right away; ids are never reused.
      const dropped = (['logo', 'banner'] as const).filter((k) => existing[k] && existing[k] !== item[k]).map((k) => existing[k]!);
      if (dropped.length) await db.query('DELETE FROM assets WHERE workspace_id = $1 AND id = ANY($2::text[])', [workspace.id, dropped]);
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
    if (body.kind === 'task' && data.assignee && data.assignee !== existing?.assignee && item.assigneeId && item.assigneeId !== user.userId) {
      await insert({ id: `evt:${item.id}:task-assigned:${now}`, kind: 'event', revision: 1, type: 'task-assigned', audience: 'studio',
        name: `« ${item.name} » assignée à ${data.assignee} par ${actor}.`, taskId: item.id, clientId: item.clientId, createdAt: now,
        recipients: [item.assigneeId], readBy: [] }, true);
    }
    // Ready for the client's approval → a WhatsApp message to their number, if the studio set one.
    // Sent after the save has landed and awaited with a timeout (a background send is not reliable
    // on serverless); whatever happens, the save itself stands. The outcome goes into the studio's
    // activity feed and back to the caller, so a failure is visible rather than silent.
    let whatsapp: WhatsappResult | undefined;
    if (body.kind === 'task' && statusChanged && item.status === 'À valider' && whatsappConfigured()) {
      const taskClient = rowsNow.find((r) => r.kind === 'client' && r.id === item.clientId && !r.archived);
      if (taskClient?.whatsapp) {
        whatsapp = await sendApprovalRequest({
          to: taskClient.whatsapp, clientName: taskClient.name, taskName: item.name,
          url: env.AUTH_URL ?? new URL(req.url).origin,
        });
        await insert({
          id: `evt:${item.id}:whatsapp:${now}`, kind: 'event', revision: 1, type: 'whatsapp', audience: 'studio',
          name: whatsapp.sent
            ? `WhatsApp envoyé à ${taskClient.name} : « ${item.name} » est prêt à valider.`
            : `WhatsApp non envoyé à ${taskClient.name} pour « ${item.name} » — ${whatsapp.error}`,
          taskId: item.id, clientId: taskClient.id, createdAt: now,
        }, true);
      }
    }
    return result({ id: item.id, ...(whatsapp ? { whatsapp: { sent: whatsapp.sent, error: whatsapp.error } } : {}) });
  } catch (error) {
    if (error instanceof NoWorkspaceError) return response({ error: 'Aucun espace ne vous est attribué. Demandez une invitation au studio.', code: 'no-workspace' }, 403);
    if (error instanceof WorkspaceAccessError) return response({ error: 'Vous n’avez plus accès à cet espace.' }, 403);
    console.error('save record', error);
    return response({ error: 'Enregistrement impossible. Vos saisies sont conservées ; réessayez.' }, 503);
  }
}
