// Reports (features/reports): what the studio's own records say over a period, to price, staff and
// prioritise. Time comes from the tasks' time entries (the clock runs while a task is « En cours »), cut
// to the period and to the studio's working hours: a task left « En cours » overnight or over Sunday
// would otherwise count its nights. A clock still running counts up to now. Archived tasks keep their
// time: it was spent.
// Pace and the client's side come from the approvals (validatedAt, signOff, revision rounds).
import { recordScopeFormat, scopeLabels, type ScopeFormat } from '@/lib/client-pipeline';
import { computeMetrics, countsInMetrics, dayIn, shiftDay, type Period } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';
import { isDone, oneCoreProcess, type Process } from '@/lib/process';
import { appDayKey, appWallTime, type TimeEntry } from '@/lib/time';

/** The hours a clock counts in the reports, on the studio's clock (Casablanca): Monday to Saturday, 8:00–20:00. */
export const reportHours = { from: '08:00', to: '20:00', days: [1, 2, 3, 4, 5, 6] };

/** An entry's time inside [from, to), counted within the working hours of each day it spans. */
export function workingMs(entry: TimeEntry, from: number, to: number) {
  const start = Math.max(Date.parse(entry.start), from);
  const end = Math.min(entry.end ? Date.parse(entry.end) : to, to);
  if (!(end > start)) return 0;
  let total = 0;
  const last = appDayKey(new Date(end));
  for (let day = appDayKey(new Date(start)); day <= last; day = shiftDay(day, 1)) {
    if (!reportHours.days.includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
    const open = appWallTime(day, reportHours.from).getTime(), close = appWallTime(day, reportHours.to).getTime();
    total += Math.max(0, Math.min(end, close) - Math.max(start, open));
  }
  return total;
}

/**
 * A task's format: the one it was planned or requested with, else read from its title (« Reel : … »,
 * « Carrousel rentrée »…), since tasks made by hand carry no format. Anything else is « other ».
 */
export function taskFormat(task: RecordItem): ScopeFormat {
  const known = recordScopeFormat(task);
  if (known) return known;
  const name = task.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const rules: [RegExp, ScopeFormat][] = [[/\breels?\b/, 'reel'], [/\bca?rr?ousel/, 'carousel'], [/\bstor(y|ies)\b/, 'story'], [/\bshoot(ing)?s?\b/, 'shooting'], [/\b(post|publication|visuel)s?\b/, 'post']];
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? 'other';
}

export type TaskTime = { task: RecordItem; ms: number; totalMs: number; people: string[] };
export type TimeGroup = { key: string; label: string; ms: number; tasks: number; approved: number; perApproved: number | null };

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * The period's report. `period` null is the whole history; `now` closes the clocks still running.
 * « Per approved content » is the whole time a content took (all of its entries), averaged over the
 * contents approved in the period that have time logged — one approved without a clock says nothing.
 */
export function workReport(records: RecordItem[], period: Period | null, now: number, process: Process = oneCoreProcess) {
  const from = period ? appWallTime(period.from).getTime() : 0;
  const to = period ? Math.min(appWallTime(shiftDay(period.to, 1)).getTime(), now) : now;
  const inPeriod = (iso?: string) => !!iso && (!period || (dayIn(new Date(iso)) >= period.from && dayIn(new Date(iso)) <= period.to));
  const clientNames = new Map(records.filter((r) => r.kind === 'client').map((c) => [c.id, c.name]));
  const tasks = records.filter((r) => r.kind === 'task');

  const times: TaskTime[] = tasks.map((task) => {
    const entries = task.timeEntries ?? [];
    return {
      task,
      ms: entries.reduce((n, e) => n + workingMs(e, from, to), 0),
      totalMs: entries.reduce((n, e) => n + workingMs(e, 0, now), 0),
      people: [...new Set(entries.filter((e) => workingMs(e, from, to) > 0).map((e) => e.name))],
    };
  });
  const logged = times.filter((t) => t.ms > 0).sort((a, b) => b.ms - a.ms);
  const approved = times.filter((t) => countsInMetrics(t.task) && isDone(t.task.status, process) && inPeriod(t.task.validatedAt));
  const approvedTimed = approved.filter((t) => t.totalMs > 0);

  const group = (keyOf: (task: RecordItem) => string, labelOf: (key: string) => string): TimeGroup[] => {
    const rows = new Map<string, TimeGroup & { timed: number[] }>();
    const row = (key: string) => rows.get(key) ?? rows.set(key, { key, label: labelOf(key), ms: 0, tasks: 0, approved: 0, perApproved: null, timed: [] }).get(key)!;
    for (const t of logged) { const r = row(keyOf(t.task)); r.ms += t.ms; r.tasks++; }
    for (const t of approved) { const r = row(keyOf(t.task)); r.approved++; if (t.totalMs > 0) r.timed.push(t.totalMs); }
    return [...rows.values()].map(({ timed, ...r }) => ({ ...r, perApproved: average(timed) })).sort((a, b) => b.ms - a.ms || b.approved - a.approved || a.label.localeCompare(b.label));
  };
  const clientKey = (task: RecordItem) => (task.clientId && clientNames.has(task.clientId) ? task.clientId : 'internal');

  // People: who logged the time, from the entries themselves (a member who left keeps their name).
  const people = new Map<string, { key: string; label: string; ms: number; tasks: Set<string> }>();
  for (const task of tasks) for (const e of task.timeEntries ?? []) {
    const ms = workingMs(e, from, to);
    if (!ms) continue;
    const p = people.get(e.userId) ?? people.set(e.userId, { key: e.userId, label: e.name, ms: 0, tasks: new Set() }).get(e.userId)!;
    p.ms += ms; p.tasks.add(task.id);
  }

  // Pace: from creation to approval, and approved on or before the due day.
  const cycleDays = approved.map((t) => (new Date(t.task.validatedAt!).getTime() - new Date(t.task.createdAt).getTime()) / 86_400_000).filter((d) => d >= 0);
  const dated = approved.filter((t) => !!t.task.due);
  const onTime = dated.filter((t) => dayIn(new Date(t.task.validatedAt!)) <= t.task.due!);
  const metrics = computeMetrics(records, period ?? { from: '0000-01-01', to: '9999-12-31' }, process);

  return {
    loggedMs: logged.reduce((n, t) => n + t.ms, 0),
    timedTasks: logged.length,
    running: tasks.filter((t) => (t.timeEntries ?? []).some((e) => !e.end)).length,
    approved: approved.length,
    perApproved: average(approvedTimed.map((t) => t.totalMs)),
    approvedTimed: approvedTimed.length,
    cycleDays: median(cycleDays),
    onTimeShare: dated.length ? onTime.length / dated.length : null, onTime: onTime.length, dated: dated.length,
    rounds: metrics.roundsPerItem, clientHours: metrics.medianValidationHours, silenceShare: metrics.silenceShare, decided: metrics.validated,
    tasks: logged,
    clients: group(clientKey, (key) => clientNames.get(key) ?? 'Interne'),
    formats: group(taskFormat, (key) => scopeLabels[key as ScopeFormat]),
    people: [...people.values()].map((p) => ({ key: p.key, label: p.label, ms: p.ms, tasks: p.tasks.size })).sort((a, b) => b.ms - a.ms),
  };
}
