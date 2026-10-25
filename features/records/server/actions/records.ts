// Creating and updating the workspace's core records: clients, sub-projects and tasks. The task rules
// (who may change what, sending for validation, the J−7 lock, clocks) are enforced here.
import { after } from 'next/server';
import { notifyOwnerOfApproval } from '@/lib/approval-notice';
import { approve, flow, lockApplies, sendForValidation, stopClocks, submitForReview } from '@/lib/flow';
import { reviewersOf, reviewRequestEvent } from '@/lib/internal-review';
import type { RecordItem } from '@/lib/model';
import { behaviourOf, firstOf, runsClock, startStatus, statusLabel, workStatus } from '@/lib/process';
import { planRefusal } from '@/lib/subscription';
import { notifyTaskApproval, notifyTaskAssignment } from '@/lib/task-whatsapp';
import { fields } from '@/lib/validation';
import { loadWorkflowState } from '@/lib/workflow-settings-server';
import { canManageMembers, isManager, isMemberRole, isStudioRole } from '@/lib/workspace';
import type { ActionStep } from '../context';
import { response } from '../http';
import { canWrite, isMine } from '../payload';
import { one, updateAtRevision } from '../store';
import { members } from '../workspace-access';
import { syncClientAvatars } from './members';

export const saveRecord: ActionStep = {
  actions: ['create', 'update'],
  when: ({ body }) => ['client', 'project', 'task'].includes(body.kind),
  async run(ctx) {
    const { body, workspace, user, rows, db, actor, now, today, origin, insert, result, studioProcess } = ctx;
    if (!canWrite(workspace.role)) return response({ error: 'Votre rôle est en lecture seule.' }, 403);
    if (body.action === 'create' && body.kind === 'client' && workspace.role !== 'owner') {
      return response({ error: 'Seul le propriétaire peut ajouter des clients.' }, 403);
    }
    // The client's own page (brief, contacts, links, logo/banner) is studio-owned: only the
    // owner and admins edit it. A member still edits the client's sub-projects and tasks.
    if (body.kind === 'client' && !isManager(workspace.role)) {
      return response({ error: 'Seuls le propriétaire et les administrateurs peuvent modifier la fiche d’un client.' }, 403);
    }
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
    // A member's only edits on a task are the deliverable link and moving it between the studio's
    // work statuses (not started, in production, paused) and its internal check; every other field
    // (and sending to the client, or marking it done) is off-limits for them. See lib/process.ts.
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
      // A member pauses and resumes their own work; sending to the client and validation stay with the studio's managers.
      if (touchedFields.includes('status') && !['todo', 'work', 'paused', 'internal'].includes(behaviourOf(data.status || undefined, studioProcess))) {
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
        const pending = rows.find((r) => r.kind === 'request' && r.id === existing.pendingExtraRequestId && r.requestStatus === 'new');
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
      data.status = data.status || startStatus(studioProcess);
      // Only the studio's own statuses (a task keeps an old one until someone moves it).
      if (data.status !== existing?.status && !studioProcess.statuses.some((s) => s.id === data.status)) {
        return response({ error: 'Statut inconnu dans ce studio.' }, 400);
      }
      const behaviour = behaviourOf(data.status, studioProcess);
      // Saving a new/changed deliverable link is what submits it — to internal review first when the
      // studio has one, never straight to the client: the owner or an administrator sends it on.
      const previousStatus = existing?.status || startStatus(studioProcess);
      const internal = firstOf(studioProcess, 'internal');
      if (internal && data.status === previousStatus && behaviourOf(existing?.status, studioProcess) !== 'done' && data.deliverable && data.deliverable !== existing?.deliverable) {
        data.status = internal;
      }
      if (behaviourOf(data.status, studioProcess) === 'client' && data.status !== existing?.status && !isManager(workspace.role)) {
        return response({ error: 'Seuls le propriétaire ou un administrateur envoient un livrable au client.' }, 403);
      }
      if (isMemberRole(workspace.role) && behaviour === 'done' && data.status !== existing?.status) {
        return response({ error: 'Seuls le client, le propriétaire ou un administrateur peuvent valider un livrable.' }, 403);
      }
      if (['internal', 'client', 'done'].includes(behaviourOf(data.status, studioProcess)) && !data.deliverable) {
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
    if (existing && behaviourOf(existing.status, studioProcess) === 'done' && data.deliverable !== existing.deliverable) data.status = workStatus(studioProcess);

    let item = {
      ...existing,
      ...data,
      ...(body.kind === 'task' ? { assigneeId } : {}),
      id: existing?.id || crypto.randomUUID(),
      kind: body.kind,
      createdAt: existing?.createdAt || now,
    } as RecordItem;
    if (body.kind === 'task') item.effectiveWorkflow = rows.find((r) => r.kind === 'client' && r.id === item.clientId)?.effectiveWorkflow ?? (await loadWorkflowState(workspace.id)).settings;
    if (lockLifted) item.lockOverride = true;
    const statusChanged = data.status !== existing?.status;

    // What the status does, before and after (lib/process.ts); only a change of behaviour runs a transition.
    const before = behaviourOf(existing?.status, studioProcess), next = behaviourOf(item.status, studioProcess);
    const transition = body.kind === 'task' && statusChanged && next !== before && (next === 'internal' || next === 'client' || next === 'done');
    if (body.kind === 'task' && statusChanged) {
      const chosen = item.status;
      if (transition && next === 'internal') item = submitForReview({ ...item, status: existing?.status }, now, existing?.deliverable, studioProcess);
      else if (transition && next === 'client') item = sendForValidation({ ...item, status: existing?.status }, now, studioProcess);
      else if (transition && next === 'done') item = approve({ ...item, status: existing?.status }, { mode: 'studio', by: actor, email: user.email, at: now, round: item.revisionRound ?? 0 }, studioProcess);
      else if (next !== 'done') {
        // Internal rejection or a step back: the clock stops and is not counted as a client round.
        item.approvalDueAt = undefined;
        if (before === 'done') { item.validatedAt = undefined; item.signOff = undefined; }
      }
      item.status = chosen; // the status the person chose, when the studio has several of that kind
    }
    // Leaving a status where the clock runs stops every clock running on the task: everyone's, not
    // just the person who clicked (see stopClocks). Validation paths do it in lib/flow.ts.
    if (body.kind === 'task' && statusChanged && !runsClock(item.status, studioProcess)) item = stopClocks(item, now);
    const transitionLogged = transition;
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
                  ? `Statut : ${statusLabel(data.status, studioProcess)}`
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
      if (!(await updateAtRevision(db, workspace.id, existing.id, body.revision, item))) return response({ error: 'Modification simultanée. Actualisez votre espace.' }, 409);
      if (body.kind === 'task' && transition && next === 'done') after(() => notifyOwnerOfApproval(workspace.id, item, origin, rows.find((r) => r.kind === 'client' && r.id === item.clientId)?.name, studioProcess));
      // Replaced or removed images are dropped right away; ids are never reused.
      const dropped = (['logo', 'banner'] as const).filter((k) => existing[k] && existing[k] !== item[k]).map((k) => existing[k]!);
      if (dropped.length) await db.query("DELETE FROM assets WHERE workspace_id = $1 AND kind IN ('logo', 'banner') AND id = ANY($2::text[])", [workspace.id, dropped]);
    } else {
      await insert(item);
    }
    // A client's logo change mirrors onto every client-portal member already tied to that client.
    if (body.kind === 'client' && item.logo !== existing?.logo) await syncClientAvatars(ctx, item.id, item.logo);
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
    // The owner and administrators hear that a deliverable waits for their internal review.
    if (body.kind === 'task' && transition && next === 'internal') {
      const notice = reviewRequestEvent(item, await reviewersOf(workspace.id, user.userId), actor, now);
      if (notice) await insert(notice, true);
    }
    // Send only after the optimistic save succeeds; unrelated edits never resend.
    const assignmentWhatsapp = body.kind === 'task'
      ? await notifyTaskAssignment(workspace.id, item, existing, user.userId, actor, origin) : undefined;
    const whatsapp = body.kind === 'task' && transition && next === 'client'
      ? await notifyTaskApproval(workspace.id, item, rows, origin) : undefined;
    return result({ id: item.id,
      ...(whatsapp ? { whatsapp: { sent: whatsapp.sent, error: whatsapp.error } } : {}),
      ...(assignmentWhatsapp ? { assignmentWhatsapp: { sent: assignmentWhatsapp.sent, error: assignmentWhatsapp.error } } : {}),
    });
  },
};
