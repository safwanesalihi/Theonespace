// Meetings (lib/meetings.ts): planned by the owner, admins and social media managers; the invited team
// members and the client are told when one is planned, moved, ended or cancelled.
import { batch, type Statement } from '@/lib/database';
import { finishRoom } from '@/lib/daily';
import { insertRecord } from '@/lib/flow-server';
import { mailConfigured, sendClientNotice } from '@/lib/mail';
import { lockedMeeting } from '@/lib/meeting-server';
import { canManageMeeting, canPlanMeetings, meetingCapReached, meetingFields } from '@/lib/meetings';
import type { RecordItem } from '@/lib/model';
import { memberName } from '@/lib/workspace';
import type { ActionStep } from '../context';
import { response } from '../http';
import { members } from '../workspace-access';

const notPlanner = () => response({ error: 'Seuls le propriétaire, les administrateurs et les social media managers planifient les réunions.' }, 403);

export const saveMeeting: ActionStep = {
  actions: ['meeting-save'],
  async run({ body, workspace, user, rows, db, actor, now, signInUrl, saveTask, insert, result }) {
    if (!canPlanMeetings(workspace.role)) return notPlanner();
    const fields = meetingFields(body.data);
    if ('error' in fields) return response(fields, 400);
    const client = fields.clientId ? rows.find((r) => r.kind === 'client' && r.id === fields.clientId && !r.archived) : undefined;
    if (fields.clientId && !client) return response({ error: 'Client introuvable.' }, 404);
    const roster = await members(workspace.id);
    const studio = roster.filter((m) => m.role !== 'client');
    if (fields.attendees.some((id) => !studio.some((m) => m.userId === id))) return response({ error: 'Invitez des membres de l’équipe de cet espace.' }, 400);
    const existing = body.id ? rows.find((r) => r.kind === 'meeting' && r.id === body.id) : undefined;
    if (body.id && !existing) return response({ error: 'Réunion introuvable.' }, 404);
    if (existing && !canManageMeeting(existing, { role: workspace.role, userId: user.userId })) return response({ error: 'Réunion introuvable.' }, 404);
    if (!existing && meetingCapReached(rows)) return response({ error: 'Votre espace a atteint 200 réunions : annulez ou supprimez-en avant d’en planifier.' }, 403);
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
      if (emails.length) await sendClientNotice({ to: [...new Set(emails)], clientName: client.name, studio: workspace.name, url: signInUrl, pendingTasks: [],
        news: `${what} — ${when} (${fields.duration} min, heure du Maroc). Rejoignez-la depuis votre espace, onglet « Réunions ».` });
    }
    return result({ id: meeting.id });
  },
};

export const endMeeting: ActionStep = {
  actions: ['meeting-end'],
  async run({ body, workspace, user, db, actor, result }) {
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
  },
};

export const cancelMeeting: ActionStep = {
  actions: ['meeting-cancel'],
  async run({ body, workspace, user, rows, db, now, saveTask, result }) {
    if (!canPlanMeetings(workspace.role)) return notPlanner();
    const meeting = rows.find((r) => r.kind === 'meeting' && r.id === body.id);
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
  },
};
