// Shooting sessions: a photo or video shoot the studio plans, internal (in-house, or for the agency
// itself — a client is optional) or external (for a client, usually on location), with the team members
// who shoot it. The client sees the shoots for them in the portal and confirms or asks for another date.
// Pure rules here: what a shoot holds, who plans and sees it, crew conflicts, and the client's copy.
// A shoot reuses the meeting fields (lib/model.ts): due + time + duration, attendees as its crew.
import { isDay, shiftDay } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';
import { appNow, appWallTime } from '@/lib/time';
import { isManager, type WorkspaceRole } from '@/lib/workspace';

export const shootLimits = { title: 140, location: 300, brief: 4000, externalCrew: 300, crew: 20, note: 1000, minDuration: 15, maxDuration: 720 };
export const shootDurations = [60, 120, 180, 240, 360, 480] as const;
export type ShootType = 'internal' | 'external';

/** Who plans shoots: the owner, the administrators and the social media managers — as for meetings. */
export const canPlanShoots = (role: WorkspaceRole) => role === 'owner' || role === 'admin' || role === 'social';

export type ShootInput = {
  name: string; shootType: ShootType; clientId: string; projectId: string; due: string; time: string; duration: number;
  location: string; attendees: string[]; externalCrew: string; description: string;
};

/** Checks what the planning form sent. Returns the clean fields, or the reason it can't be saved. */
export function shootFields(data: unknown): ShootInput | { error: string } {
  const d = (typeof data === 'object' && data ? data : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = text(d.name, shootLimits.title);
  if (!name) return { error: 'Donnez un titre au shooting.' };
  const shootType: ShootType = d.shootType === 'internal' ? 'internal' : 'external';
  const clientId = text(d.clientId, 200);
  if (shootType === 'external' && !clientId) return { error: 'Choisissez le client du shooting.' };
  const due = text(d.due, 10);
  if (!isDay(due)) return { error: 'Choisissez la date du shooting.' };
  const time = text(d.time, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Choisissez l’heure du shooting.' };
  const duration = Number(d.duration);
  if (!Number.isInteger(duration) || duration < shootLimits.minDuration || duration > shootLimits.maxDuration) return { error: 'Durée invalide.' };
  const rawCrew = d.attendees ?? [];
  if (!Array.isArray(rawCrew) || rawCrew.some((a) => typeof a !== 'string')) return { error: 'Équipe invalide.' };
  const attendees = [...new Set((rawCrew as string[]).map((a) => a.trim()).filter(Boolean))];
  if (attendees.length > shootLimits.crew) return { error: `Jusqu’à ${shootLimits.crew} membres de l’équipe.` };
  return {
    name, shootType, clientId, projectId: text(d.projectId, 200), due, time, duration,
    location: text(d.location, shootLimits.location), attendees, externalCrew: text(d.externalCrew, shootLimits.externalCrew),
    description: text(d.description, shootLimits.brief),
  };
}

/** Start and end, in Casablanca wall-clock time. */
export function shootStart(shoot: Pick<RecordItem, 'due' | 'time'>): Date | null {
  if (!isDay(shoot.due) || !/^\d{2}:\d{2}$/.test(shoot.time ?? '')) return null;
  return appWallTime(shoot.due!, shoot.time!);
}
export const shootEnd = (shoot: Pick<RecordItem, 'due' | 'time' | 'duration'>) => {
  const start = shootStart(shoot);
  return start ? new Date(start.getTime() + (shoot.duration ?? 120) * 60_000) : null;
};

export type ShootPhase = 'planned' | 'today' | 'done' | 'cancelled';
/** Where a shoot stands: cancelled, done (marked, or its day is past), happening today, or planned. */
export function shootPhase(shoot: RecordItem, today: string): ShootPhase {
  if (shoot.cancelledAt) return 'cancelled';
  if (shoot.endedAt || (shoot.due ?? '') < today) return 'done';
  return shoot.due === today ? 'today' : 'planned';
}

/**
 * The crew members already booked elsewhere while this shoot runs: on another live shoot, or invited to a
 * meeting, that overlaps it. A warning to the planner, never a refusal — a two-hour call during a
 * day-long shoot can be intended.
 */
export function crewConflicts(shoot: Pick<RecordItem, 'id' | 'due' | 'time' | 'duration' | 'attendees'>, records: RecordItem[]) {
  const start = shootStart(shoot), end = shootEnd(shoot);
  if (!start || !end) return [];
  const crew = new Set(shoot.attendees ?? []);
  const clashes: { userId: string; with: RecordItem }[] = [];
  for (const other of records) {
    if (other.id === shoot.id || (other.kind !== 'shoot' && other.kind !== 'meeting') || other.cancelledAt || other.endedAt || other.archived) continue;
    const otherStart = shootStart(other);
    const otherEnd = other.kind === 'meeting' ? (otherStart ? new Date(otherStart.getTime() + (other.duration ?? 60) * 60_000) : null) : shootEnd(other);
    if (!otherStart || !otherEnd || otherStart >= end || otherEnd <= start) continue;
    for (const userId of [...(other.attendees ?? []), ...(other.authorId && other.kind === 'meeting' ? [other.authorId] : [])]) {
      if (crew.has(userId) && !clashes.some((c) => c.userId === userId && c.with.id === other.id)) clashes.push({ userId, with: other });
    }
  }
  return clashes;
}

/** Whether this person sees the shoot: managers and viewers see all; a team member, the ones they shoot or planned. */
export function seesShoot(shoot: RecordItem, who: { role: WorkspaceRole; userId: string; clientId?: string | null }) {
  if (who.role === 'client') return !!shoot.clientId && shoot.clientId === who.clientId && !shoot.archived;
  return isManager(who.role) || who.role === 'viewer' || shoot.authorId === who.userId || !!shoot.attendees?.includes(who.userId);
}

/** The client's copy of a shoot lives beside the other client copies (lib/flow.ts portalView). */
export { clientShoot } from '@/lib/flow';

/** Shoots of the coming days and of the last two weeks, soonest first. */
export function shootLists(shoots: RecordItem[], today: string) {
  const recent = shiftDay(today, -14);
  const byStart = (a: RecordItem, b: RecordItem) => `${a.due} ${a.time}`.localeCompare(`${b.due} ${b.time}`);
  const coming = shoots.filter((s) => { const p = shootPhase(s, today); return p === 'planned' || p === 'today'; }).sort(byStart);
  const past = shoots.filter((s) => { const p = shootPhase(s, today); return (p === 'done' || p === 'cancelled') && (s.due ?? '') >= recent; }).sort(byStart).reverse();
  return { coming, past };
}

/** What the client still has to answer: their upcoming shoots without a confirmation. */
export const awaitingClient = (shoots: RecordItem[], today = appNow().toISOString().slice(0, 10)) =>
  shoots.filter((s) => s.clientId && shootPhase(s, today) === 'planned' && s.clientDecision?.state !== 'confirmed');
