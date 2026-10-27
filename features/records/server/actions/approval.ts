// A deliverable's validation: the studio's internal review, explicit approval, a request for changes
// (a new round, or an extra round outside the plan), publication, and the per-person time clocks.
import { after } from 'next/server';
import { approve, passCheck, publish, rejectInternally, requestChanges, stopClocks } from '@/lib/flow';
import { insertRecord } from '@/lib/flow-server';
import { notifyOwnerOfApproval } from '@/lib/approval-notice';
import { reviewersOf, reviewRefusalEvent, reviewRequestEvent } from '@/lib/internal-review';
import type { RecordItem } from '@/lib/model';
import { behaviourOf, firstOf, flowFor, isDone, runsClock, workStatus } from '@/lib/process';
import { notifyTaskApproval, notifyTaskApprovedByClient, notifyTaskChanges } from '@/lib/task-whatsapp';
import { taskWorkflowSettings } from '@/lib/workflow-settings';
import { isManager } from '@/lib/workspace';
import type { ActionStep } from '../context';
import { CommercialError, response } from '../http';
import { canWrite } from '../payload';
import { updateAtRevision } from '../store';
import { voiceMessage } from './chat';

/**
 * The studio's internal review of a deliverable in « Validation interne »: the owner or an
 * administrator passes it — to the next check of a chain, else to the client (the client's clock
 * starts), or done on a path without a client step — or returns it to work with a note only the
 * studio reads. None of it counts as a client round.
 */
export const internalReview: ActionStep = {
  actions: ['internal-review'],
  async run({ body, workspace, user, rows, actor, now, origin, findTask, saveTask, insert, result, studioProcess }) {
    if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire ou un administrateur font la validation interne.' }, 403);
    const task = findTask(body.taskId);
    if (!task) return response({ error: 'Tâche introuvable.' }, 404);
    if (behaviourOf(task.status, studioProcess) !== 'internal') return response({ error: 'Ce livrable n’est pas en validation interne.' }, 409);
    if (body.revision !== task.revision) return response({ error: 'Ce livrable a changé. Actualisez avant de réessayer.' }, 409);
    if (body.decision === 'send') {
      if (!task.deliverable) return response({ error: 'Ajoutez un lien livrable avant l’envoi au client.' }, 400);
      // In a chain of checks the work moves to the next one; after the last, to the client (or done).
      const passed = passCheck(task, actor, now, studioProcess);
      if (!(await saveTask(task, passed.task))) return response({ error: 'Ce livrable a changé. Actualisez avant de réessayer.' }, 409);
      if (passed.to === 'check') {
        const notice = reviewRequestEvent(passed.task, await reviewersOf(workspace.id, user.userId), actor, now);
        if (notice) await insert(notice, true);
        return result({ id: task.id, next: 'check' });
      }
      if (passed.to === 'done') return result({ id: task.id, next: 'done' });
      // The client hears about it exactly as when a deliverable used to go straight to them.
      const whatsapp = await notifyTaskApproval(workspace.id, passed.task, rows, origin);
      return result({ id: task.id, next: 'client', ...(whatsapp ? { whatsapp: { sent: whatsapp.sent, error: whatsapp.error } } : {}) });
    }
    if (body.decision !== 'reject') return response({ error: 'Décision invalide.' }, 400);
    const note = typeof body.text === 'string' ? body.text.trim() : '';
    if (!note || note.length > 2000) return response({ error: 'Expliquez ce qu’il faut reprendre (1 à 2 000 caractères).' }, 400);
    const returned = rejectInternally(task, note, actor, now, studioProcess);
    if (!(await saveTask(task, returned))) return response({ error: 'Ce livrable a changé. Actualisez avant de réessayer.' }, 409);
    const notice = reviewRefusalEvent(returned, actor, user.userId, now);
    if (notice) await insert(notice, true);
    return result({ id: task.id });
  },
};

export const approveTask: ActionStep = {
  actions: ['approve'],
  async run({ body, workspace, user, rows, actor, now, origin, findTask, saveTask, insert, result, studioProcess }) {
    // Same rule as the update path: only the client, the owner or an administrator may validate.
    if (workspace.role !== 'client' && !isManager(workspace.role)) return response({ error: 'Seuls le client, le propriétaire ou un administrateur peuvent valider un livrable.' }, 403);
    const task = findTask(body.taskId);
    if (!task) return response({ error: 'Livrable introuvable.' }, 404);
    if (behaviourOf(task.status, studioProcess) !== 'client') return response({ error: 'Ce livrable n’est pas en attente de validation.' }, 409);
    const mode = workspace.role === 'client' ? 'explicit' : 'studio';
    const approved = approve(task, { mode, by: actor, email: user.email, at: now, round: task.revisionRound ?? 0 }, studioProcess);
    if (!(await saveTask(task, approved))) return response({ error: 'Ce livrable a changé. Actualisez avant de réessayer.' }, 409);
    await insert({ id: `evt:${task.id}:decision:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
      name: `« ${task.name} » validé par ${actor}${mode === 'studio' ? ' (depuis le studio)' : ''}.`, taskId: task.id, clientId: task.clientId, createdAt: now }, true);
    const approvedClient = rows.find((r) => r.kind === 'client' && r.id === task.clientId)?.name;
    after(() => notifyOwnerOfApproval(workspace.id, approved, origin, approvedClient, studioProcess));
    if (mode === 'explicit') after(() => notifyTaskApprovedByClient(workspace.id, approved, approvedClient || actor, origin));
    return result({ id: task.id });
  },
};

export const requestTaskChanges: ActionStep = {
  actions: ['request-changes'],
  async run(ctx) {
    const { body, workspace, user, rows, db, owner, actor, now, origin, findTask, result, studioProcess } = ctx;
    if (workspace.role !== 'client' && !isManager(workspace.role)) return response({ error: 'Seuls le client, le propriétaire ou un administrateur peuvent demander des modifications.' }, 403);
    const task = findTask(body.taskId);
    if (!task) return response({ error: 'Livrable introuvable.' }, 404);
    if (behaviourOf(task.status, studioProcess) !== 'client') return response({ error: 'Ce livrable n’est pas en attente de validation.' }, 409);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const voice = await voiceMessage(ctx);
    if (voice && typeof voice === 'object') return response(voice, 400);
    if ((!text && !voice) || text.length > 5000) {
      return response({ error: 'Précisez les modifications demandées (1 à 5 000 caractères), ou enregistrez un message vocal.' }, 400);
    }
    const clientName = () => rows.find((r) => r.kind === 'client' && r.id === task.clientId)?.name || actor;
    const settings = taskWorkflowSettings(task);
    // Past the plan's rounds: the task pauses and a request for an extra round waits for a quote.
    if (task.clientId && (task.revisionRound || 0) >= settings.maxRevisionRounds) {
      const request: RecordItem = { id: crypto.randomUUID(), kind: 'request', revision: 1, name: `Tour supplémentaire : ${task.name}`.slice(0, 160), clientId: task.clientId, projectId: task.projectId,
        due: task.due, description: text || 'Retours vocaux dans la conversation du livrable.', requestStatus: 'new', revisionTaskId: task.id, commercialTreatment: 'extra', scopeFormat: 'other', scopeUnits: 1,
        request: { by: actor, email: user.email, at: now }, createdAt: now };
      const changedTask: RecordItem = { ...stopClocks(task, now), status: firstOf(flowFor(studioProcess, task), 'paused') ?? workStatus(flowFor(studioProcess, task)), approvalDueAt: undefined, pendingExtraRequestId: request.id,
        history: [...(task.history || []), { text: 'Tour hors forfait : en attente de devis et d’accord explicite.', date: now }].slice(-100) };
      await db.transaction(async (tx) => {
        if (!(await updateAtRevision(tx, workspace.id, task.id, task.revision, changedTask))) throw new CommercialError('Ce livrable a changé. Actualisez avant de réessayer.');
        for (const statement of [insertRecord(request, owner, workspace.id), insertRecord({ id: crypto.randomUUID(), kind: 'comment', revision: 1, name: `[Tour hors forfait demandé] ${text}`, taskId: task.id, clientId: task.clientId, author: actor, authorId: user.userId, createdAt: now, ...(voice ? { audio: voice } : {}), ...(workspace.role === 'client' ? { audience: 'client' as const } : {}) }, owner, workspace.id),
          insertRecord({ id: `evt:${request.id}:request`, kind: 'event', revision: 1, type: 'request', audience: 'studio', requestId: request.id, taskId: task.id, clientId: task.clientId, name: `Tour hors forfait demandé sur « ${task.name} » : chiffrer avant de reprendre.`, createdAt: now }, 'system', workspace.id, true)]) await tx.query(statement.text, statement.params);
      });
      after(async () => { await notifyTaskChanges(workspace.id, changedTask, clientName(), origin); });
      return result({ id: task.id, extraRequestId: request.id });
    }
    const changedTask = requestChanges(task, actor, now, studioProcess);
    const round = changedTask.revisionRound!;
    const tag = round > settings.maxRevisionRounds ? `Retours client — tour ${round} · hors forfait` : `Retours client — tour ${round}`;
    const note: RecordItem = { id: crypto.randomUUID(), kind: 'comment', revision: 1, name: text ? `[${tag}] ${text}` : `[${tag}]`, taskId: task.id,
      clientId: task.clientId, author: actor, authorId: user.userId, createdAt: now, ...(voice ? { audio: voice } : {}),
      ...(workspace.role === 'client' ? { audience: 'client' as const } : {}) };
    const event: RecordItem = { id: `evt:${task.id}:round:${round}:${now}`, kind: 'event', revision: 1, type: 'decision', audience: 'studio',
      name: `${tag} sur « ${task.name} » (${actor}).`, taskId: task.id, clientId: task.clientId, createdAt: now };
    await db.transaction(async (tx) => {
      if (!(await updateAtRevision(tx, workspace.id, task.id, task.revision, changedTask))) throw new CommercialError('Ce livrable a changé. Actualisez avant de réessayer.');
      for (const statement of [insertRecord(note, owner, workspace.id), insertRecord(event, 'system', workspace.id, true)]) await tx.query(statement.text, statement.params);
    });
    after(async () => { await notifyTaskChanges(workspace.id, changedTask, clientName(), origin); });
    return result({ id: task.id });
  },
};

export const publishTask: ActionStep = {
  actions: ['publish'],
  async run({ body, workspace, actor, now, findTask, saveTask, result, studioProcess }) {
    if (!canWrite(workspace.role)) return response({ error: 'Votre rôle ne peut pas publier.' }, 403);
    const task = findTask(body.taskId);
    if (!task) return response({ error: 'Tâche introuvable.' }, 404);
    if (task.publishable === false) return response({ error: 'Cette tâche est un travail interne, elle ne se publie pas.' }, 409);
    if (!isDone(task.status, studioProcess)) return response({ error: 'Un contenu se publie une fois validé.' }, 409);
    if (task.publishedAt) return response({ error: 'Déjà publié.' }, 409);
    const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
    const publishedAt = day ? new Date(`${day}T12:00:00.000Z`).toISOString() : now;
    if (!(await saveTask(task, publish(task, publishedAt, actor)))) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
    return result({ id: task.id });
  },
};

/** Time tracking: per person, at most one running clock per user across the workspace. */
export const trackTime: ActionStep = {
  actions: ['start-timer', 'stop-timer'],
  async run({ body, workspace, user, rows, db, actor, now, findTask, saveTask, result, studioProcess }) {
    if (!canWrite(workspace.role)) return response({ error: 'Votre rôle ne peut pas suivre le temps.' }, 403);
    const task = findTask(body.taskId);
    if (!task) return response({ error: 'Tâche introuvable.' }, 404);
    const entries = task.timeEntries || [];
    const myOpenIndex = entries.findIndex((e) => e.userId === user.userId && !e.end);
    const changed = () => response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);

    if (body.action === 'stop-timer') {
      if (myOpenIndex === -1) return response({ error: 'Aucun chronomètre en cours pour cette tâche.' }, 409);
      const stopped = { ...task, timeEntries: entries.map((e, i) => (i === myOpenIndex ? { ...e, end: now } : e)) };
      if (!(await saveTask(task, stopped))) return changed();
      return result({ id: task.id });
    }

    if (myOpenIndex !== -1) return response({ error: 'Le chronomètre est déjà en cours pour cette tâche.' }, 409);
    if (!runsClock(task.status, studioProcess)) return response({ error: 'Le chronomètre ne tourne que sur une tâche en production.' }, 409);
    const newEntry = { userId: user.userId, name: actor, start: now };
    // Nobody runs two clocks at once: find any other task where this user's clock is still running.
    const otherOpenTask = rows.find(
      (r) => r.kind === 'task' && r.id !== task.id && r.timeEntries?.some((e) => e.userId === user.userId && !e.end),
    );
    if (!otherOpenTask) {
      if (!(await saveTask(task, { ...task, timeEntries: [...entries, newEntry] }))) return changed();
      return result({ id: task.id });
    }
    // Two records change together here: close the other task's clock and open this one's in a single
    // transaction — either both writes land, or neither does.
    const otherEntries = otherOpenTask.timeEntries || [];
    const otherOpenIndex = otherEntries.findIndex((e) => e.userId === user.userId && !e.end);
    const otherAfter = { ...otherOpenTask, timeEntries: otherEntries.map((e, i) => (i === otherOpenIndex ? { ...e, end: now } : e)) };
    const taskAfter = { ...task, timeEntries: [...entries, newEntry] };
    const ok = await db.transaction(async (tx) => {
      if (!(await updateAtRevision(tx, workspace.id, otherOpenTask.id, otherOpenTask.revision, otherAfter))) return false;
      return updateAtRevision(tx, workspace.id, task.id, task.revision, taskAfter);
    });
    if (!ok) return changed();
    return result({ id: task.id });
  },
};
