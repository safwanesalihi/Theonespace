// Shooting sessions (lib/shoots.ts): planned by the owner, admins and social media managers. The crew
// hears when a shoot is planned, moved or cancelled; the client sees theirs in the portal and confirms it
// or asks for another date, and the studio hears the answer.
import { batch, type Statement } from '@/lib/database';
import { insertRecord } from '@/lib/flow-server';
import type { RecordItem } from '@/lib/model';
import { canPlanShoots, crewConflicts, seesShoot, shootFields, shootLimits } from '@/lib/shoots';
import { memberName } from '@/lib/workspace';
import type { ActionStep } from '../context';
import { response } from '../http';
import { members } from '../workspace-access';

const notPlanner = () => response({ error: 'Seuls le propriétaire, les administrateurs et les social media managers planifient les shootings.' }, 403);
const changed = () => response({ error: 'Ce shooting a changé. Actualisez avant de réessayer.' }, 409);
const dayLabel = (day?: string) => (day ?? '').split('-').reverse().join('/');

export const saveShoot: ActionStep = {
  actions: ['shoot-save'],
  async run({ body, workspace, user, rows, db, actor, now, saveTask, insert, result }) {
    if (!canPlanShoots(workspace.role)) return notPlanner();
    const fields = shootFields(body.data);
    if ('error' in fields) return response(fields, 400);
    const client = fields.clientId ? rows.find((r) => r.kind === 'client' && r.id === fields.clientId && !r.archived) : undefined;
    if (fields.clientId && !client) return response({ error: 'Client introuvable.' }, 404);
    const project = fields.projectId ? rows.find((r) => r.kind === 'project' && r.id === fields.projectId && r.clientId === client?.id && !r.archived) : undefined;
    if (fields.projectId && !project) return response({ error: 'Sélectionnez un sous-projet de ce client.' }, 400);
    const studio = (await members(workspace.id)).filter((m) => m.role !== 'client');
    if (fields.attendees.some((id) => !studio.some((m) => m.userId === id))) return response({ error: 'Choisissez l’équipe parmi les membres de cet espace.' }, 400);
    const existing = body.id ? rows.find((r) => r.kind === 'shoot' && r.id === body.id) : undefined;
    if (body.id && (!existing || !seesShoot(existing, { role: workspace.role, userId: user.userId }))) return response({ error: 'Shooting introuvable.' }, 404);
    if (existing && existing.revision !== body.revision) return changed();
    if (existing?.cancelledAt) return response({ error: 'Ce shooting est annulé.' }, 400);
    if (!existing && rows.filter((r) => r.kind === 'shoot' && !r.cancelledAt && !r.archived && (r.due ?? '') >= now.slice(0, 10)).length >= 500) {
      return response({ error: 'Votre espace a atteint 500 shootings à venir : annulez-en avant d’en planifier.' }, 403);
    }
    const moved = !!existing && (existing.due !== fields.due || existing.time !== fields.time || existing.location !== fields.location);
    const shoot: RecordItem = {
      ...(existing ?? { id: crypto.randomUUID(), kind: 'shoot' as const, revision: 1, createdAt: now, authorId: user.userId, author: actor }),
      name: fields.name, shootType: fields.shootType, clientId: client?.id, projectId: project?.id, due: fields.due, time: fields.time, duration: fields.duration,
      location: fields.location || undefined, attendees: fields.attendees, attendeeNames: fields.attendees.map((id) => memberName(studio.find((m) => m.userId === id)!)),
      externalCrew: fields.externalCrew || undefined, description: fields.description,
      // A new date or place asks the client again.
      clientDecision: moved ? undefined : existing?.clientDecision,
      history: [...(existing?.history ?? []), { text: existing ? (moved ? `Déplacé au ${dayLabel(fields.due)} à ${fields.time} par ${actor}` : `Modifié par ${actor}`) : `Planifié par ${actor}`, date: now }].slice(-50),
    };
    if (existing) {
      if (!(await saveTask(existing, shoot))) return changed();
    } else await insert(shoot);
    // Who is told: the crew members new to it (or all of them when the date or place moves), and the client.
    const when = `${dayLabel(fields.due)} à ${fields.time}${fields.location ? ` · ${fields.location}` : ''}`;
    const told = (existing && !moved ? fields.attendees.filter((id) => !existing.attendees?.includes(id)) : fields.attendees).filter((id) => id !== user.userId);
    const statements: Statement[] = [];
    if (told.length) statements.push(insertRecord({
      id: `evt:${shoot.id}:shoot:${now}`, kind: 'event', revision: 1, type: 'shoot', audience: 'studio', shootId: shoot.id, clientId: client?.id,
      name: `${actor} ${moved ? 'a déplacé' : 'vous a ajouté au'} shooting « ${fields.name} »${client ? ` (${client.name})` : ''} — ${when}.`, createdAt: now, recipients: told, readBy: [],
    }, 'system', workspace.id, true));
    if (client && (!existing || moved)) statements.push(insertRecord({
      id: `evt:${shoot.id}:shoot-client:${now}`, kind: 'event', revision: 1, type: 'shoot', audience: 'client', shootId: shoot.id, clientId: client.id,
      name: `${moved ? 'Nouvelle date pour le' : 'Nouveau'} shooting « ${fields.name} » — ${when}. Confirmez-le depuis votre espace.`, createdAt: now,
    }, 'system', workspace.id, true));
    if (statements.length) await batch(db, statements);
    // Crew already booked at the same time: saved anyway, and said so to the planner.
    const nameOf = (id: string) => { const member = studio.find((m) => m.userId === id); return member ? memberName(member) : 'Un membre'; };
    const conflicts = crewConflicts(shoot, rows).map((c) => `${nameOf(c.userId)} · ${c.with.name}`);
    return result({ id: shoot.id, ...(conflicts.length ? { conflicts } : {}) });
  },
};

/** The shoot took place, or is called off: the crew (and, when cancelled, the client) hear about it. */
export const closeShoot: ActionStep = {
  actions: ['shoot-done', 'shoot-cancel'],
  async run({ body, workspace, user, rows, db, actor, now, saveTask, result }) {
    if (!canPlanShoots(workspace.role)) return notPlanner();
    const shoot = rows.find((r) => r.kind === 'shoot' && r.id === body.id);
    if (!shoot || !seesShoot(shoot, { role: workspace.role, userId: user.userId })) return response({ error: 'Shooting introuvable.' }, 404);
    if (shoot.cancelledAt) return body.action === 'shoot-cancel' ? result() : response({ error: 'Ce shooting est annulé.' }, 409);
    if (body.action === 'shoot-done') {
      if (shoot.endedAt) return result();
      if (!(await saveTask(shoot, { ...shoot, endedAt: now, endedBy: actor, history: [...(shoot.history ?? []), { text: `Shooting réalisé (${actor})`, date: now }].slice(-50) }))) return changed();
      return result();
    }
    if (shoot.endedAt) return response({ error: 'Ce shooting a déjà eu lieu.' }, 409);
    if (!(await saveTask(shoot, { ...shoot, cancelledAt: now, history: [...(shoot.history ?? []), { text: `Annulé par ${actor}`, date: now }].slice(-50) }))) return changed();
    const what = `Le shooting « ${shoot.name} » du ${dayLabel(shoot.due)} à ${shoot.time} est annulé.`;
    const statements: Statement[] = [];
    const told = (shoot.attendees ?? []).filter((id) => id !== user.userId);
    if (told.length) statements.push(insertRecord({ id: `evt:${shoot.id}:cancel`, kind: 'event', revision: 1, type: 'shoot', audience: 'studio', shootId: shoot.id, clientId: shoot.clientId, name: what, createdAt: now, recipients: told, readBy: [] }, 'system', workspace.id, true));
    if (shoot.clientId) statements.push(insertRecord({ id: `evt:${shoot.id}:cancel-client`, kind: 'event', revision: 1, type: 'shoot', audience: 'client', shootId: shoot.id, clientId: shoot.clientId, name: what, createdAt: now }, 'system', workspace.id, true));
    if (statements.length) await batch(db, statements);
    return result();
  },
};

/** The client confirms their shoot, or asks for another date (with a note); the planner and the crew hear it. */
export const answerShoot: ActionStep = {
  actions: ['shoot-answer'],
  async run({ body, workspace, user, rows, actor, now, saveTask, insert, result }) {
    if (workspace.role !== 'client') return response({ error: 'Seul le client répond à un shooting.' }, 403);
    const shoot = rows.find((r) => r.kind === 'shoot' && r.id === body.id);
    if (!shoot || !seesShoot(shoot, { role: 'client', userId: user.userId, clientId: workspace.clientId })) return response({ error: 'Shooting introuvable.' }, 404);
    if (shoot.cancelledAt || shoot.endedAt || (shoot.due ?? '') < now.slice(0, 10)) return response({ error: 'Ce shooting n’attend plus de réponse.' }, 409);
    const state = body.decision === 'confirm' ? 'confirmed' : body.decision === 'reschedule' ? 'reschedule' : null;
    if (!state) return response({ error: 'Réponse invalide.' }, 400);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, shootLimits.note) : '';
    if (state === 'reschedule' && !note) return response({ error: 'Proposez une autre date ou expliquez ce qui ne convient pas.' }, 400);
    const answered = { ...shoot, clientDecision: { state, by: actor, at: now, ...(note ? { note } : {}) } as RecordItem['clientDecision'],
      history: [...(shoot.history ?? []), { text: state === 'confirmed' ? `Confirmé par ${actor}` : `Autre date demandée par ${actor}`, date: now }].slice(-50) };
    if (!(await saveTask(shoot, answered))) return changed();
    const told = [...new Set([shoot.authorId, ...(shoot.attendees ?? [])].filter((id): id is string => !!id))];
    if (told.length) await insert({
      id: `evt:${shoot.id}:answer:${now}`, kind: 'event', revision: 1, type: 'shoot', audience: 'studio', shootId: shoot.id, clientId: shoot.clientId,
      name: state === 'confirmed' ? `${actor} a confirmé le shooting « ${shoot.name} » du ${dayLabel(shoot.due)}.` : `${actor} demande une autre date pour le shooting « ${shoot.name} » : ${note}`,
      createdAt: now, recipients: told, readBy: [],
    }, true);
    return result();
  },
};
