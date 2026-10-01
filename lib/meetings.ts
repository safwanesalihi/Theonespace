// Meetings: the studio plans a call with a client — video or audio only — and adds the team members it
// wants; everyone invited joins from the app (Réunions in the studio, the portal's Réunions tab). The
// call itself runs on Daily (lib/daily.ts), or on a link the studio pastes (Google Meet, Zoom…).
// Pure rules here: what a meeting holds, who sees it, who plans it, when it can be joined.
import { isDay, shiftDay } from '@/lib/flow';
import { appWallTime } from '@/lib/time';
import type { RecordItem } from '@/lib/model';
import type { WorkspaceRole } from '@/lib/workspace';

export const meetingLimits = { title: 140, agenda: 4000, attendees: 30, minDuration: 10, maxDuration: 480, earlyJoinMinutes: 30, lateJoinMinutes: 120 };
export const meetingDurations = [15, 30, 45, 60, 90, 120] as const;
export type CallMode = 'video' | 'audio';

/** Who plans meetings: the owner, the administrators and the social media managers (they talk to clients). */
export const canPlanMeetings = (role: WorkspaceRole) => role === 'owner' || role === 'admin' || role === 'social';
/** Who sees every meeting of the studio: the owner, the administrators, and read-only viewers. */
const seesAllMeetings = (role: WorkspaceRole) => role === 'owner' || role === 'admin' || role === 'viewer';

export type MeetingInput = { name: string; clientId: string; due: string; time: string; duration: number; callMode: CallMode; attendees: string[]; description: string; link: string };

/** Checks what the planning form sent. Returns the clean fields, or the reason it can't be saved. */
export function meetingFields(data: unknown): MeetingInput | { error: string } {
  const d = (typeof data === 'object' && data ? data : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = text(d.name, meetingLimits.title);
  if (!name) return { error: 'Donnez un titre à la réunion.' };
  const due = text(d.due, 10);
  if (!isDay(due)) return { error: 'Choisissez la date de la réunion.' };
  const time = text(d.time, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Choisissez l’heure de la réunion.' };
  const duration = Number(d.duration);
  if (!Number.isInteger(duration) || duration < meetingLimits.minDuration || duration > meetingLimits.maxDuration) return { error: 'Durée invalide.' };
  const callMode: CallMode = d.callMode === 'audio' ? 'audio' : 'video';
  const rawAttendees = d.attendees ?? [];
  if (!Array.isArray(rawAttendees) || rawAttendees.some((a) => typeof a !== 'string')) return { error: 'Participants invalides.' };
  const attendees = [...new Set((rawAttendees as string[]).map((a) => a.trim()).filter(Boolean))];
  if (attendees.length > meetingLimits.attendees) return { error: `Jusqu’à ${meetingLimits.attendees} participants de l’équipe.` };
  const link = text(d.link, 500);
  if (link && !/^https:\/\/[^\s]+$/i.test(link)) return { error: 'Le lien de la réunion doit commencer par https://.' };
  return { name, clientId: text(d.clientId, 200), due, time, duration, callMode, attendees, description: text(d.description, meetingLimits.agenda), link };
}

/** Casablanca wall-clock time → the instant. Morocco is UTC+1 all year except around Ramadan (UTC+0). */
export function meetingStart(meeting: Pick<RecordItem, 'due' | 'time'>): Date | null {
  if (!isDay(meeting.due) || !/^\d{2}:\d{2}$/.test(meeting.time ?? '')) return null;
  return appWallTime(meeting.due!, meeting.time!);
}
export const meetingEnd = (meeting: Pick<RecordItem, 'due' | 'time' | 'duration'>) => {
  const start = meetingStart(meeting);
  return start ? new Date(start.getTime() + (meeting.duration ?? 60) * 60_000) : null;
};

export type MeetingPhase = 'upcoming' | 'open' | 'live' | 'over' | 'cancelled';
/** Where a meeting stands: joinable from 30 minutes before its start to 2 hours after its planned end. */
export function meetingPhase(meeting: RecordItem, now = new Date()): MeetingPhase {
  if (meeting.cancelledAt) return 'cancelled';
  const start = meetingStart(meeting), end = meetingEnd(meeting);
  if (!start || !end) return 'over';
  const t = now.getTime();
  if (t < start.getTime() - meetingLimits.earlyJoinMinutes * 60_000) return 'upcoming';
  if (t < start.getTime()) return 'open';
  if (t <= end.getTime()) return 'live';
  if (t <= end.getTime() + meetingLimits.lateJoinMinutes * 60_000) return 'open';
  return 'over';
}

/** Whether this person is part of the meeting (and so may see and join it). */
export function invitedTo(meeting: RecordItem, who: { role: WorkspaceRole; userId: string; clientId?: string | null }) {
  if (who.role === 'client') return !!meeting.clientId && meeting.clientId === who.clientId;
  return seesAllMeetings(who.role) || meeting.authorId === who.userId || !!meeting.attendees?.includes(who.userId);
}

/** A meeting as a client contact sees it: no internal ids, no room. */
export function clientMeeting(meeting: RecordItem): RecordItem {
  const { attendees, authorId, history, ...copy } = meeting;
  void attendees; void authorId; void history;
  return copy;
}

/** Meetings of the next days and the last week, soonest first — what the Réunions pages list. */
export function meetingLists(meetings: RecordItem[], today: string, now = new Date()) {
  const recent = shiftDay(today, -7);
  const byStart = (a: RecordItem, b: RecordItem) => `${a.due} ${a.time}`.localeCompare(`${b.due} ${b.time}`);
  const coming = meetings.filter((m) => !m.cancelledAt && meetingPhase(m, now) !== 'over').sort(byStart);
  const past = meetings.filter((m) => (m.cancelledAt || meetingPhase(m, now) === 'over') && (m.due ?? '') >= recent).sort(byStart).reverse();
  return { coming, past };
}
