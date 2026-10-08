// The request bank: a client (or a manager for them) files a request from the portal form; the owner or
// an administrator turns it into a task, inside the plan or as an accepted extra, or declines it.
import { createHash } from 'node:crypto';
import { activeContract, scopeUsage } from '@/lib/client-pipeline';
import { batch, type Statement } from '@/lib/database';
import { requestChanges } from '@/lib/flow';
import { insertRecord } from '@/lib/flow-server';
import { channels as taskChannels, type RecordItem } from '@/lib/model';
import { notifyTaskAssignment } from '@/lib/task-whatsapp';
import { acceptFields, requestFields, requestUpdateFields } from '@/lib/validation';
import { isManager, isMemberRole, memberName } from '@/lib/workspace';
import type { ActionStep } from '../context';
import { CommercialError, response } from '../http';
import { updateAtRevision } from '../store';
import { members } from '../workspace-access';

export const submitRequest: ActionStep = {
  actions: ['request'],
  async run({ body, workspace, user, rows, db, owner, actor, now, result }) {
    if (workspace.role === 'viewer' || isMemberRole(workspace.role)) return response({ error: 'Seuls les administrateurs saisissent une demande au nom d’un client.' }, 403);
    const clientId = workspace.role === 'client' ? workspace.clientId : body.clientId;
    const client = rows.find((r) => r.kind === 'client' && r.id === clientId && !r.archived);
    if (!client) return response({ error: 'Client introuvable.' }, 404);
    const parsed = requestFields.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    const data = parsed.data;
    // Scope the key to the authenticated sender and workspace, never the supplied client id.
    // ON CONFLICT below also covers two simultaneous retries after the first response was lost.
    const requestId = data.submissionId
      ? `request:${createHash('sha256').update(JSON.stringify([workspace.id, user.userId, client.id, data.submissionId])).digest('hex')}`
      : crypto.randomUUID();
    if (rows.some((r) => r.kind === 'request' && r.id === requestId && r.clientId === client.id)) return result({ id: requestId });
    if (data.projectId && !rows.some((r) => r.kind === 'project' && r.clientId === client.id && !r.archived && r.id === data.projectId)) {
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
  },
};

export const updateRequest: ActionStep = {
  actions: ['request-update'],
  async run({ body, workspace, user, rows, db, actor, now, result }) {
    if (!isManager(workspace.role) && workspace.role !== 'client') return response({ error: 'Seuls le client, le propriétaire et les administrateurs modifient une demande.' }, 403);
    const request = rows.find((r) => r.kind === 'request' && r.id === body.id && (workspace.role !== 'client' || r.clientId === workspace.clientId));
    if (!request || !rows.some((r) => r.kind === 'client' && r.id === request.clientId && !r.archived)) return response({ error: 'Demande introuvable.' }, 404);
    if ((request.requestStatus ?? 'new') !== 'new') return response({ error: 'Cette demande a déjà été traitée.' }, 409);
    if (!Number.isSafeInteger(body.revision) || body.revision < 1) return response({ error: 'Révision de la demande invalide.' }, 400);
    if (body.revision !== request.revision) return response({ error: 'Cette demande a changé. Actualisez avant de réessayer.' }, 409);
    const parsed = requestUpdateFields.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
    const data = parsed.data;
    if (data.projectId && !rows.some((r) => r.kind === 'project' && r.id === data.projectId && r.clientId === request.clientId && !r.archived)) return response({ error: 'Choisissez un sous-projet de ce client.' }, 400);
    const next = { ...request, name: data.name,
      projectId: data.projectId === undefined ? request.projectId : data.projectId || undefined,
      due: data.due ?? request.due ?? '', description: data.description ?? request.description ?? '',
      platforms: data.platforms ? [...new Set(data.platforms)] : request.platforms ?? [], priority: data.priority ?? request.priority ?? 'Moyenne',
    };
    const keys = ['name', 'projectId', 'due', 'description', 'platforms', 'priority'] as const;
    const changed = keys.filter((key) => JSON.stringify(next[key]) !== JSON.stringify(request[key]));
    if (!changed.length) return result({ id: request.id });
    const labels = { name: 'titre', projectId: 'sous-projet', due: 'date', description: 'brief', platforms: 'plateformes', priority: 'priorité' };
    const updated = { ...next, history: [...(request.history ?? []), { text: `Demande modifiée par ${actor} (${changed.map((key) => labels[key]).join(', ')})`, date: now }].slice(-100) };
    const people = await db.query<{ userId: string; role: string }>(`SELECT user_id AS "userId", role FROM workspace_members
        WHERE workspace_id = $1 AND user_id <> $2 AND (role IN ('owner', 'admin') OR (role = 'client' AND client_id = $3))`, [workspace.id, user.userId, request.clientId]);
    const notices = (['studio', 'client'] as const).flatMap((audience) => {
      const recipients = people.filter((person) => audience === 'client' ? person.role === 'client' : person.role !== 'client').map((person) => person.userId);
      if (!recipients.length) return [];
      return [insertRecord({ id: `evt:${request.id}:updated:${request.revision + 1}:${audience}`, kind: 'event', revision: 1, type: 'request', audience,
        requestId: request.id, clientId: request.clientId, name: `${actor} a modifié la demande « ${updated.name} » (${changed.map((key) => labels[key]).join(', ')}).`, createdAt: now, recipients, readBy: [] }, 'system', workspace.id, true)];
    });
    const saved = await db.transaction(async (tx) => {
      if (!(await updateAtRevision(tx, workspace.id, request.id, body.revision, updated))) return false;
      for (const notice of notices) await tx.query(notice.text, notice.params);
      return true;
    });
    if (!saved) return response({ error: 'Cette demande a changé. Actualisez avant de réessayer.' }, 409);
    return result({ id: request.id });
  },
};

export const decideRequest: ActionStep = {
  actions: ['request-accept', 'request-decline'],
  async run({ body, workspace, user, rows, db, owner, actor, now, today, origin, saveTask, result }) {
    if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs traitent les demandes.' }, 403);
    const request = rows.find((r) => r.kind === 'request' && r.id === body.id);
    if (!request) return response({ error: 'Demande introuvable.' }, 404);
    if (request.requestStatus !== 'new') return response({ error: 'Cette demande a déjà été traitée.' }, 409);
    if (body.revision !== undefined && body.revision !== request.revision) return response({ error: 'Cette demande a changé. Actualisez avant de réessayer.' }, 409);
    const client = rows.find((r) => r.kind === 'client' && r.id === request.clientId && !r.archived);
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
    const agreement = activeContract(rows, client.id, today)?.serviceScope;
    if (agreement && (!data.commercialTreatment || !data.scopeFormat || !data.scopeUnits)) return response({ error: 'Classez la demande et indiquez son format et sa quantité avant production.' }, 400);
    if (data.commercialTreatment === 'extra') {
      const extra = rows.find((d) => d.kind === 'document' && d.id === data.extraQuoteId && d.clientId === client.id && d.docType === 'devis' && d.documentPurpose === 'extra' && d.requestId === request.id && d.docStatus === 'accepted' && !d.archived);
      if (!extra) return response({ error: 'Un extra nécessite le devis de cette demande accepté explicitement par le client.' }, 409);
      if (extra.scopeFormat !== data.scopeFormat || extra.scopeUnits !== data.scopeUnits) return response({ error: 'Le format et la quantité doivent correspondre au devis extra accepté.' }, 409);
    } else if (agreement && data.scopeFormat && data.scopeUnits) {
      const usage = scopeUsage(rows, client.id, agreement, (data.due || request.due || today).slice(0, 7)).rows.find((r) => r.format === data.scopeFormat);
      if (!usage || usage.planned + data.scopeUnits > usage.quantity) return response({ error: 'Cette quantité dépasse le forfait. Préparez un devis extra et faites-le accepter avant production.' }, 409);
    }
    let project = rows.find((r) => r.kind === 'project' && r.clientId === client.id && !r.archived && r.id === (data.projectId || request.projectId));
    if (data.projectId && !project) return response({ error: 'Choisissez un sous-projet de ce client.' }, 400);
    project ??= rows.find((r) => r.kind === 'project' && r.clientId === client.id && !r.archived && r.name === 'Demandes');
    if (!project) {
      project = { id: crypto.randomUUID(), kind: 'project', revision: 1, name: 'Demandes', clientId: client.id, description: 'Demandes reçues via le portail client.', createdAt: now };
      statements.push(insertRecord(project, owner, workspace.id));
    }
    const assignee = data.assigneeId ? (await members(workspace.id)).find((m) => m.userId === data.assigneeId && m.role !== 'client') : undefined;
    if (data.assigneeId && !assignee) return response({ error: 'Assignez un membre de l’équipe.' }, 400);
    const platforms = request.platforms ?? [];
    const channel = platforms.find((p): p is (typeof taskChannels)[number] => (taskChannels as readonly string[]).includes(p)) ?? '';
    const description = [data.description ?? request.description ?? '', platforms.length ? `Plateformes : ${platforms.join(', ')}` : ''].filter((l) => l.trim()).join('\n\n');
    const original = request.revisionTaskId ? rows.find((r) => r.kind === 'task' && r.id === request.revisionTaskId && r.clientId === client.id && !r.archived && r.pendingExtraRequestId === request.id) : undefined;
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
    await db.transaction(async (tx) => {
      // Serialize included requests for this client; re-read quota after taking the lock.
      if (agreement && data.commercialTreatment === 'included') {
        await tx.query('SELECT id FROM records WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [client.id, workspace.id]);
        const fresh = await tx.query<{ data: RecordItem; revision: number; planMonth?: string }>("SELECT r.data, r.revision, p.data->>'month' AS \"planMonth\" FROM records r LEFT JOIN records p ON p.workspace_id = r.workspace_id AND p.kind = 'meta' AND starts_with(p.id, $2) AND p.data->>'id' = r.data->>'planId' WHERE r.workspace_id = $1 AND r.kind IN ('task', 'plan_item')", [workspace.id, `content-plan:${workspace.id}:`]);
        const usage = scopeUsage(fresh.map((r) => ({ ...r.data, revision: r.revision, planMonth: r.planMonth || r.data.planMonth })), client.id, agreement, (data.due || request.due || today).slice(0, 7)).rows.find((r) => r.format === data.scopeFormat);
        if (!usage || usage.planned + (data.scopeUnits || 1) > usage.quantity) throw new CommercialError('Cette quantité dépasse le forfait. Préparez un devis extra et faites-le accepter avant production.');
      }
      if (!(await updateAtRevision(tx, workspace.id, request.id, request.revision, accepted))) throw new CommercialError('Cette demande a changé. Actualisez avant de réessayer.');
      if (original && !(await updateAtRevision(tx, workspace.id, original.id, original.revision, task))) throw new CommercialError('Ce livrable a changé. Actualisez avant de réessayer.');
      for (const statement of statements) await tx.query(statement.text, statement.params);
    });
    const assignmentWhatsapp = await notifyTaskAssignment(workspace.id, task, undefined, user.userId, actor, origin);
    return result({ id: task.id, ...(assignmentWhatsapp ? { assignmentWhatsapp } : {}) });
  },
};
