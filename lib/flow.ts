// The One Flow — the rules of the studio, as pure functions.
// Nothing in here touches the database, the network or React. Every transition the
// API applies and every number the Pilotage page shows comes from this file.
import type { RecordItem, SignOff, Status } from '@/lib/model';
import { behaviourOf, fieldsFor, firstOf, flowFor, is, isDone, nextCheck, oneCoreProcess, rulesOf, statusIds, statusLabel, workStatus, type Behaviour, type Process } from '@/lib/process';
import { appDayKey, appTimeZone } from '@/lib/time';
import { defaultWorkflowSettings, silenceOf, taskWorkflowSettings, workflowReminderHours, type WorkflowSettings } from './workflow-settings';

export const flow = {
  timeZone: appTimeZone,
  ...defaultWorkflowSettings, // fallback for workspaces without saved settings
  reminderHoursLeft: workflowReminderHours(defaultWorkflowSettings),
  lockDays: 7,                  // J−7: the calendar is frozen; new or re-dated items need an admin override
  evergreenTarget: 3,           // approved, undated items to keep in reserve per client
  archiveApprovedAfterDays: 15, // approved work leaves the lists this long after its approval
  // Four backward gates counted from the publish date J (the task's `due`).
  gates: [
    { key: 'brief', label: 'Brief validé', offset: 14 },
    { key: 'send', label: 'Envoi au client', offset: 7 },
    { key: 'validation', label: 'Validation client', offset: 5 },
    { key: 'ready', label: 'Prêt à publier', offset: 1 },
  ] as const,
  targets: {
    onTimeRate: 0.95, medianValidationHours: 24, silenceShare: 0.30,
    roundsPerItem: 1.4, deliveredVsSold: [1.0, 1.05] as const, evergreen: 3,
  },
};

export type GateKey = (typeof flow.gates)[number]['key'];
export type Court = 'studio' | 'client' | 'done';

// ---------- dates ----------

export function dayIn(date: Date, timeZone = flow.timeZone) {
  if (timeZone === appTimeZone) return appDayKey(date);
  // en-CA gives YYYY-MM-DD; the studio's day, not the server's.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function shiftDay(day: string, days: number) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string) {
  return Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);
}
export const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// ---------- derived state ----------

/** Who has to act next. Derived from the status, never typed (Stitch Kit §2.3). */
export function courtOf(task: Pick<RecordItem, 'status' | 'publishedAt' | 'archived'>, process: Process = oneCoreProcess): Court {
  if (task.archived || task.publishedAt) return 'done';
  if (is(task.status, 'client', process)) return 'client';
  return 'studio';
}
export const courtLabels: Record<Court, string> = { studio: 'Studio', client: 'Client', done: 'Terminé' };

/**
 * The agency's own tasks (clientId « internal », the « Tâches internes » page) are not client work:
 * they never go to a client — the internal check validates them — and they stay out of the client
 * numbers, the client pipeline and the portal.
 */
export const isInternalTask = (task: Pick<RecordItem, 'clientId'>) => task.clientId === 'internal';
/** Client work only: what the dashboard, the six numbers and the client flow count. */
export const clientWork = <T extends Pick<RecordItem, 'clientId'>>(tasks: T[]) => tasks.filter((t) => !isInternalTask(t));

/** Internal work (copywriting, prémontage…) is never published: no gates, no lock, no editorial plan. */
export const isPublishable = (task: Pick<RecordItem, 'publishable'>) => task.publishable !== false;

export function approvalDueAt(sentAt: string, settings: WorkflowSettings = defaultWorkflowSettings) {
  return new Date(new Date(sentAt).getTime() + settings.validationHours * 3600 * 1000).toISOString();
}
export function hoursLeft(task: Pick<RecordItem, 'approvalDueAt'>, now: Date) {
  if (!task.approvalDueAt) return null;
  return (new Date(task.approvalDueAt).getTime() - now.getTime()) / 3600000;
}

export function revisionState(task: Pick<RecordItem, 'revisionRound' | 'approvalSettings' | 'effectiveWorkflow' | 'pendingExtraRequestId'>) {
  const used = task.revisionRound ?? 0;
  const included = taskWorkflowSettings(task).maxRevisionRounds;
  return { used, included, overBudget: used > included || !!task.pendingExtraRequestId, lastIncluded: included > 0 && used === included };
}

export type Gate = { key: GateKey; label: string; day: string; reached: boolean; late: boolean };
/** The four backward gates for a publish date, with whether the task has passed each one. */
export function gatesFor(task: Pick<RecordItem, 'due' | 'status' | 'sentAt' | 'validatedAt' | 'publishedAt' | 'deliverable' | 'description' | 'publishable'>, today: string, process: Process = oneCoreProcess): Gate[] {
  if (!isDay(task.due) || !isPublishable(task)) return [];
  const behaviour = behaviourOf(task.status, process);
  const reached: Record<GateKey, boolean> = {
    brief: !!task.description?.trim() || behaviour !== 'todo',
    send: !!task.sentAt || behaviour === 'client' || behaviour === 'done',
    validation: behaviour === 'done',
    ready: behaviour === 'done' && !!task.deliverable,
  };
  // Each studio counts its own milestones back from the publishing date (lib/process.ts rulesOf).
  const offsets = rulesOf(process).gates;
  return flow.gates.map((gate) => {
    const day = shiftDay(task.due!, -offsets[gate.key]);
    return { key: gate.key, label: gate.label, day, reached: reached[gate.key], late: !reached[gate.key] && day < today };
  });
}

/**
 * True when a publish date falls inside the frozen window (today … J−n, the studio's lockDays; none at 0).
 * Past dates are backfills, not calendar moves.
 */
export function insideLock(due: string | undefined, today: string, lockDays: number = flow.lockDays) {
  if (!isDay(due) || lockDays <= 0) return false;
  const days = daysBetween(today, due);
  return days >= 0 && days < lockDays;
}
/** The lock applies to creating a dated item in the window or moving an item's date into/inside it. */
export function lockApplies(previousDue: string | undefined, nextDue: string | undefined, today: string, lockDays: number = flow.lockDays) {
  if (!isDay(nextDue) || !insideLock(nextDue, today, lockDays)) return false;
  return previousDue !== nextDue;
}

/** What the numbers count: live tasks, and approved ones the sweep archived on its own (they were delivered). */
export const countsInMetrics = (task: Pick<RecordItem, 'archived' | 'autoArchivedAt'>) => !task.archived || !!task.autoArchivedAt;

export const isEvergreenReserve = (task: RecordItem, process: Process = oneCoreProcess) =>
  task.kind === 'task' && !!task.evergreen && isPublishable(task) && !task.archived && isDone(task.status, process) && !task.due && !task.publishedAt;

// ---------- transitions ----------

const historyEntry = (text: string, date: string, internal?: boolean) => ({ text, date, ...(internal ? { internal } : {}) });

/**
 * A clock only runs while its task is in production (a status whose behaviour is « work », see
 * lib/process.ts). Every transition out of it — pause, back to the start, sent for validation,
 * validated by the client, by the studio or by silence — closes
 * everyone's running clock on the task at that moment (never before the clock started).
 */
export function stopClocks(task: RecordItem, at: string): RecordItem {
  if (!task.timeEntries?.some((e) => !e.end)) return task;
  return { ...task, timeEntries: task.timeEntries.map((e) => (e.end ? e : { ...e, end: e.start > at ? e.start : at })) };
}

/**
 * For clocks left running before that rule existed: when the task most likely left « En cours » after
 * `start` — sent for validation or validated, else its latest recorded change. Never later than `now`,
 * never earlier than `start`, so a repair can only remove time that was wrongly counted.
 */
export function leftWorkAt(task: RecordItem, start: string, now: string) {
  const after = (d?: string) => !!d && d >= start && d <= now;
  const transitions = [task.sentAt, task.validatedAt].filter(after) as string[];
  if (transitions.length) return transitions.sort()[0];
  const changes = (task.history ?? []).map((h) => h.date).filter(after).sort();
  return changes.at(-1) ?? start;
}

/**
 * The studio's own check before the client sees anything: the deliverable waits in « Validation
 * interne » for the owner or an administrator. No client clock runs. `previousLink` is the link the
 * task had before this version, kept as the one the client was last sent (for tasks sent before
 * `sentDeliverable` existed).
 */
export function submitForReview(task: RecordItem, now: string, previousLink?: string, studio: Process = oneCoreProcess): RecordItem {
  const process = flowFor(studio, task);
  return { ...stopClocks(task, now), status: firstOf(process, 'internal') ?? task.status, approvalDueAt: undefined,
    ...(task.sentDeliverable || !task.sentAt || !previousLink ? {} : { sentDeliverable: previousLink }),
    history: [...(task.history ?? []), historyEntry('Envoyé en validation interne', now, true)].slice(-100) };
}

/**
 * An internal check passed. In a chain (an account manager, then an art director), the work moves to
 * the next check; after the last one it goes to the client, or, on a path with no client step, it is
 * done, approved by the studio. `to` says which, for the notices and the answer.
 */
export function passCheck(task: RecordItem, by: string, now: string, studio: Process = oneCoreProcess): { task: RecordItem; to: 'check' | 'client' | 'done' } {
  const process = flowFor(studio, task);
  const next = nextCheck(process, task.status);
  if (next) {
    return { to: 'check', task: { ...task, status: next,
      history: [...(task.history ?? []), historyEntry(`Validé en interne par ${by} · passe à « ${statusLabel(next, process)} »`, now, true)].slice(-100) } };
  }
  const noted = { ...task, history: [...(task.history ?? []), historyEntry(`Validé en interne par ${by}`, now, true)].slice(-100) };
  // The agency's own work has no client: after its last check it is done.
  if (firstOf(process, 'client') && !isInternalTask(task)) return { to: 'client', task: sendForValidation(noted, now, studio) };
  return { to: 'done', task: approve(noted, { mode: 'studio', by, at: now, round: task.revisionRound ?? 0 }, studio) };
}

/** Returned by the studio before the client saw it: back to work with a note only the studio reads. */
export function rejectInternally(task: RecordItem, note: string, by: string, now: string, studio: Process = oneCoreProcess): RecordItem {
  const process = flowFor(studio, task);
  return { ...stopClocks(task, now), status: workStatus(process), approvalDueAt: undefined, internalReview: { note, by, at: now },
    history: [...(task.history ?? []), historyEntry(`Refusé en validation interne (${by})`, now, true)].slice(-100) };
}

export function sendForValidation(task: RecordItem, now: string, studio: Process = oneCoreProcess): RecordItem {
  const process = flowFor(studio, task);
  const settings = taskWorkflowSettings(task);
  const { internalReview, ...sent } = task; void internalReview; // the studio's note is settled once the client has it
  return { ...stopClocks(sent, now), approvalSettings: settings, status: firstOf(process, 'client') ?? task.status, sentAt: now, sentDeliverable: task.deliverable, approvalDueAt: approvalDueAt(now, settings), reminders: [],
    history: [...(task.history ?? []), historyEntry(`Envoyé au client · validation tacite dans ${settings.validationHours} h`, now)].slice(-100) };
}

export function approve(task: RecordItem, signOff: SignOff, studio: Process = oneCoreProcess): RecordItem {
  const process = flowFor(studio, task);
  const label = signOff.mode === 'silence' ? `Validation tacite — ${taskWorkflowSettings(task).validationHours} h sans réponse`
    : signOff.mode === 'studio' ? `Validé depuis le studio par ${signOff.by}` : `Validé par ${signOff.by}`;
  const { internalReview, ...settled } = task; void internalReview;
  return { ...stopClocks(settled, signOff.at), approvalSettings: taskWorkflowSettings(task), status: firstOf(process, 'done') ?? task.status, validatedAt: signOff.at, signOff, approvalDueAt: undefined, sentDeliverable: task.deliverable,
    history: [...(task.history ?? []), historyEntry(label, signOff.at)].slice(-100) };
}

export function requestChanges(task: RecordItem, by: string, now: string, studio: Process = oneCoreProcess): RecordItem {
  const process = flowFor(studio, task);
  const round = (task.revisionRound ?? 0) + 1;
  const note = round > revisionState(task).included ? ' · hors forfait' : '';
  return { ...task, approvalSettings: taskWorkflowSettings(task), status: workStatus(process), revisionRound: round, approvalDueAt: undefined, validatedAt: undefined, signOff: undefined,
    history: [...(task.history ?? []), historyEntry(`Retours client — tour ${round}${note} (${by})`, now)].slice(-100) };
}

export function publish(task: RecordItem, publishedAt: string, by: string): RecordItem {
  return { ...task, publishedAt, history: [...(task.history ?? []), historyEntry(`Publié par ${by}`, publishedAt)].slice(-100) };
}

// ---------- the sweep (clocks, reminders, J−1, J−7, archiving approved work) ----------

export type SweepResult = { tasks: RecordItem[]; events: RecordItem[] };

const event = (id: string, type: NonNullable<RecordItem['type']>, name: string, task: RecordItem, audience: RecordItem['audience'], createdAt: string): RecordItem =>
  ({ id, kind: 'event', revision: 1, name, type, audience, taskId: task.id, clientId: task.clientId, createdAt });

/**
 * Applies every timed rule to a workspace. Idempotent: running it twice produces nothing new.
 * Event ids are deterministic so INSERT OR IGNORE keeps them unique.
 */
export function sweep(records: RecordItem[], now: Date, process: Process = oneCoreProcess): SweepResult {
  const nowIso = now.toISOString();
  const today = dayIn(now);
  const tomorrow = shiftDay(today, 1);
  const rules = rulesOf(process);
  // A lookup map: a find per task made the sweep grow with the square of the workspace.
  const byId = new Map(records.map((r) => [r.id, r]));
  const parent = (id?: string) => (id ? byId.get(id) : undefined);
  const active = (t: RecordItem) => !t.archived && !parent(t.clientId)?.archived && !parent(t.projectId)?.archived;
  const tasks: RecordItem[] = [];
  const events: RecordItem[] = [];

  for (const task of records) {
    if (task.kind !== 'task' || !active(task)) continue;

    // Approved work archives itself the studio's number of days after the approval (15 by default, never at 0),
    // once its publication date has passed.
    // The evergreen reserve stays; a task restored by hand stays too, until it is approved again.
    const behaviour = behaviourOf(task.status, process);
    const approvedAt = behaviour === 'done' ? task.validatedAt ?? task.signOff?.at : undefined;
    if (approvedAt && rules.archiveAfterDays > 0 && !isEvergreenReserve(task, process) && (!isDay(task.due) || task.due < today)
      && now.getTime() - Date.parse(approvedAt) >= rules.archiveAfterDays * 86_400_000
      && (!task.autoArchivedAt || task.autoArchivedAt < approvedAt)) {
      tasks.push({ ...stopClocks(task, nowIso), archived: true, autoArchivedAt: nowIso,
        history: [...(task.history ?? []), historyEntry(`Archivé automatiquement : validé depuis ${rules.archiveAfterDays} jours`, nowIso)].slice(-100) });
      continue;
    }

    if (behaviour === 'client' && task.approvalDueAt) {
      const left = hoursLeft(task, now)!;
      const silence = silenceOf(taskWorkflowSettings(task));
      const marked = new Set(task.reminders ?? []);
      // The deadline passed without an answer. Only « approve » counts the silence as an approval; « remind »
      // tells both sides and « escalate » alerts the studio, once each, and the work keeps waiting.
      if (left <= 0 && silence !== 'approve') {
        if (!marked.has('overdue')) {
          events.push(silence === 'remind'
            ? event(`evt:${task.id}:overdue:${task.approvalDueAt}`, 'reminder', `Délai dépassé : « ${task.name} » attend toujours la validation du client.`, task, 'both', nowIso)
            : event(`evt:${task.id}:escalation:${task.approvalDueAt}`, 'escalation', `À relancer : le client n’a pas validé « ${task.name} » dans le délai.`, task, 'studio', nowIso));
          tasks.push({ ...task, reminders: [...marked, 'overdue'] });
        }
        continue;
      }
      if (left <= 0) {
        const signed = approve(task, { mode: 'silence', by: 'Validation tacite', at: task.approvalDueAt, round: task.revisionRound ?? 0 }, process);
        tasks.push(signed);
        events.push(event(`evt:${task.id}:auto:${task.approvalDueAt}`, 'auto-approved', `« ${task.name} » validé tacitement — ${taskWorkflowSettings(task).validationHours} h sans réponse du client.`, task, 'both', nowIso));
        continue;
      }
      // Several thresholds may be past at once (a long outage): mark them all, remind once.
      const sent = new Set(task.reminders ?? []);
      const due = workflowReminderHours(taskWorkflowSettings(task)).filter((hours) => left <= hours && !sent.has(`${hours}h`));
      if (due.length) {
        for (const hours of due) sent.add(`${hours}h`);
        const key = `${Math.min(...due)}h`;
        const leftLabel = left < 1 ? `${Math.max(1, Math.ceil(left * 60))} min` : `${Math.max(1, Math.round(left))} h`;
        events.push(event(`evt:${task.id}:remind:${key}:${task.approvalDueAt}`, 'reminder', silence === 'approve'
          ? `Rappel : « ${task.name} » sera validé tacitement dans ${leftLabel} sans réponse.`
          : `Rappel : « ${task.name} » attend la validation du client, échéance dans ${leftLabel}.`, task, 'both', nowIso));
        tasks.push({ ...task, reminders: [...sent] });
      }
    }

    if (isDay(task.due) && !task.publishedAt && isPublishable(task)) {
      // J−1 sweep: anything publishing tomorrow that is not validated.
      if (task.due === tomorrow && behaviour !== 'done') {
        events.push(event(`evt:${task.id}:j1:${task.due}`, 'sweep', `Balayage J−1 : « ${task.name} » se publie demain et n’est pas validé (${statusLabel(task.status, process)}).`, task, 'studio', nowIso));
      }
      // J−n alert: inside the studio's lock window and still not with the client (the agency's own work has none).
      if (!isInternalTask(task) && insideLock(task.due, today, rules.lockDays) && !(['client', 'done'] as Behaviour[]).includes(behaviour) && !task.sentAt) {
        events.push(event(`evt:${task.id}:j7:${task.due}`, 'lock', `Verrou J−${rules.lockDays} : « ${task.name} » se publie le ${task.due} et n’a pas été envoyé au client.`, task, 'studio', nowIso));
      }
    }
  }
  return { tasks, events };
}

// ---------- the six numbers ----------

export type Period = { from: string; to: string }; // inclusive days
export type ClientMetric = { clientId: string; name: string; quota: number | null; delivered: number; ratio: number | null; evergreen: number };
export type Metrics = {
  period: Period;
  onTimeRate: number | null; published: number; onTime: number;
  medianValidationHours: number | null; explicitDecisions: number;
  silenceShare: number | null; validated: number; silent: number;
  roundsPerItem: number | null;
  deliveredVsSold: number | null; delivered: number; sold: number;
  evergreenPerClient: number | null;
  clients: ClientMetric[];
};

export function monthPeriod(day: string): Period {
  const from = day.slice(0, 8) + '01';
  const [y, m] = day.split('-').map(Number);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const inPeriod = (iso: string | undefined, period: Period) => !!iso && dayIn(new Date(iso)) >= period.from && dayIn(new Date(iso)) <= period.to;

export function computeMetrics(records: RecordItem[], period: Period, process: Process = oneCoreProcess): Metrics {
  const clients = records.filter((r) => r.kind === 'client' && !r.archived);
  const tasks = records.filter((r) => r.kind === 'task' && countsInMetrics(r) && !isInternalTask(r));

  const published = tasks.filter((t) => inPeriod(t.publishedAt, period));
  const onTime = published.filter((t) => !isDay(t.due) || dayIn(new Date(t.publishedAt!)) <= t.due);

  const validated = tasks.filter((t) => t.signOff && inPeriod(t.signOff.at, period));
  const explicit = validated.filter((t) => t.signOff!.mode === 'explicit' && t.sentAt);
  const silent = validated.filter((t) => t.signOff!.mode === 'silence');
  const hours = explicit.map((t) => (new Date(t.signOff!.at).getTime() - new Date(t.sentAt!).getTime()) / 3600000).filter((h) => h >= 0);
  const rounds = validated.map((t) => t.revisionRound ?? 0);

  const perClient: ClientMetric[] = clients.map((client) => {
    const quota = client.quota && /^\d+$/.test(client.quota) ? Number(client.quota) : null;
    const delivered = published.filter((t) => t.clientId === client.id).length;
    return { clientId: client.id, name: client.name, quota, delivered, ratio: quota ? delivered / quota : null,
      evergreen: tasks.filter((t) => t.clientId === client.id && isEvergreenReserve(t, process)).length };
  });
  const sold = perClient.reduce((sum, c) => sum + (c.quota ?? 0), 0);
  const deliveredSold = perClient.filter((c) => c.quota).reduce((sum, c) => sum + c.delivered, 0);

  return {
    period,
    onTimeRate: published.length ? onTime.length / published.length : null, published: published.length, onTime: onTime.length,
    medianValidationHours: median(hours), explicitDecisions: explicit.length,
    silenceShare: validated.length ? silent.length / validated.length : null, validated: validated.length, silent: silent.length,
    roundsPerItem: rounds.length ? rounds.reduce((a, b) => a + b, 0) / rounds.length : null,
    deliveredVsSold: sold ? deliveredSold / sold : null, delivered: deliveredSold, sold,
    evergreenPerClient: clients.length ? perClient.reduce((sum, c) => sum + c.evergreen, 0) / clients.length : null,
    clients: perClient,
  };
}

/**
 * A client's content for a period, counted as the service scope counts it (lib/client-pipeline.ts
 * scopeUsage): the publishable work dated in the period (its due day, else its plan's month, else when
 * it was created), in units (a story frame is one), paid extras apart. Approved is « Validé » or
 * published, and approved work the sweep archived still counts. The target is the quota sold per month.
 */
export function clientPeriodWork(records: RecordItem[], client: RecordItem, period: Period, process: Process = oneCoreProcess) {
  const dated = (r: RecordItem) => (r.due || (r.planMonth ? `${r.planMonth}-01` : r.createdAt) || '').slice(0, 10);
  const work = records.filter((r) => (r.kind === 'task' || r.kind === 'plan_item') && r.clientId === client.id && countsInMetrics(r)
    && r.publishable !== false && r.commercialTreatment !== 'extra' && dated(r) >= period.from && dated(r) <= period.to);
  const units = (list: RecordItem[]) => list.reduce((n, r) => n + (r.scopeUnits || 1), 0);
  const quota = client.quota && /^\d+$/.test(client.quota) ? Number(client.quota) : null;
  return { planned: units(work), approved: units(work.filter((r) => isDone(r.status, process) || !!r.publishedAt)), quota };
}

/** Statuses in the studio's order. */
export const statusOrder = (process: Process = oneCoreProcess): readonly Status[] => statusIds(process);

// ---------- per-person notifications ----------
// An event with `recipients` is targeted (per-user `readBy`); one without is a broadcast (shared `read`).

export const isEventRecipient = (e: RecordItem, userId: string) => !!e.recipients?.includes(userId);
export const isEventUnreadFor = (e: RecordItem, userId: string) =>
  e.recipients ? !(e.readBy ?? []).includes(userId) : !e.read && !(e.readBy ?? []).includes(userId);

// ---------- what a client contact may see ----------

const clientHiddenTaskFields = ['assignee', 'assigneeId', 'source', 'lockOverride', 'reminders', 'timeEntries', 'internalReview', 'sentDeliverable'] as const;
const clientHiddenCommentFields = ['authorId'] as const;

/**
 * The status a client reads, whatever the studio calls its steps: the portal speaks in behaviours
 * (lib/process.ts), in the One Core's words. The studio's own steps and its internal check read as
 * « En cours ».
 */
export const portalStatuses: Record<Behaviour, Status> = { todo: 'À faire', work: 'En cours', paused: 'En pause', internal: 'En cours', client: 'À valider', done: 'Validé' };

/**
 * A task as its client sees it. Internal review is the studio's business: the client reads « En
 * cours », never the internal history, and only ever a link the studio actually sent — not a version
 * still waiting for, or refused at, internal review.
 */
export function clientTaskCopy(task: RecordItem, process: Process = oneCoreProcess): RecordItem {
  const behaviour = behaviourOf(task.status, process);
  const shown = behaviour === 'client' || behaviour === 'done' ? task.deliverable
    : behaviour === 'internal' || task.internalReview ? task.sentDeliverable
    : task.sentDeliverable ?? (task.sentAt ? task.deliverable : undefined);
  const copy: RecordItem = { ...task, status: portalStatuses[behaviour] };
  for (const key of clientHiddenTaskFields) delete copy[key];
  // The studio's own fields: only those it shows its clients (lib/process.ts FieldDef.client).
  if (copy.fields) {
    const shownToClient = new Set(fieldsFor(process, task).filter((f) => f.client).map((f) => f.id));
    const kept = Object.fromEntries(Object.entries(copy.fields).filter(([id]) => shownToClient.has(id)));
    if (Object.keys(kept).length) copy.fields = kept; else delete copy.fields;
  }
  if (shown) copy.deliverable = shown; else delete copy.deliverable;
  if (copy.history) copy.history = copy.history.filter((h) => !h.internal);
  return copy;
}

/** The portal slice of a workspace: one client, its projects, tasks, comments and client-facing events. */
export function portalView(records: RecordItem[], clientId: string, userId?: string, process: Process = oneCoreProcess): RecordItem[] {
  const client = records.find((r) => r.kind === 'client' && r.id === clientId && !r.archived);
  if (!client) return [];
  const projects = records.filter((r) => r.kind === 'project' && r.clientId === clientId && !r.archived);
  const projectIds = new Set(projects.map((p) => p.id));
  // Plan ideas not yet sent to the tasks (kind 'plan_item') come too once their plan is shared, for
  // their comment threads; the portal's task lists only ever count kind 'task'.
  const tasks = records
    .filter((r) => (r.kind === 'task' || (r.kind === 'plan_item' && !!r.planShared)) && r.clientId === clientId && !r.archived && (!r.projectId || projectIds.has(r.projectId)) && (!r.planId || r.planShared))
    .map((task) => clientTaskCopy(task, process));
  const taskIds = new Set(tasks.map((t) => t.id));
  const comments = records
    .filter((r) => r.kind === 'comment' && !!r.taskId && taskIds.has(r.taskId))
    .map((comment) => { const copy = { ...comment }; for (const key of clientHiddenCommentFields) delete copy[key]; return copy; });
  // Social posts, once the studio has scheduled them (drafts stay in the studio), without the
  // studio's working details: who wrote it, its history, storage paths and platform errors.
  const posts = records
    .filter((r) => r.kind === 'editorial_post' && r.clientId === clientId && !r.archived && (r.socialState === 'scheduled' || !!r.publishedAt))
    .map((post) => {
      const { history, author, publishingAt, mediaPath, channels, ...copy } = post;
      void history; void author; void publishingAt; void mediaPath; void channels;
      if (copy.media) copy.media = copy.media.map(({ path, ...m }) => { void path; return m; });
      if (copy.publishResults) {
        copy.publishResults = Object.fromEntries(Object.entries(copy.publishResults).filter(([, r]) => r.ok).map(([k, r]) => [k, { ok: true, at: r.at, ...(r.url ? { url: r.url } : {}) }]));
      }
      // The client sees the numbers, not why the studio couldn't read some (an account to reconnect…).
      if (copy.stats) copy.stats = Object.fromEntries(Object.entries(copy.stats).map(([k, st]) => { const { error, ...rest } = st; void error; return [k, rest]; }));
      return copy;
    });
  const postIds = new Set(posts.map((p) => p.id));
  // Meetings with this client (lib/meetings.ts), without the studio's internal ids.
  const meetings = records
    .filter((r) => r.kind === 'meeting' && r.clientId === clientId)
    .map((meeting) => { const { attendees, authorId, history, ...copy } = meeting; void attendees; void authorId; void history; return copy; });
  const meetingIds = new Set(meetings.map((m) => m.id));
  // Their shooting sessions (lib/shoots.ts): date, place, who comes and what to prepare.
  const shoots = records.filter((r) => r.kind === 'shoot' && r.clientId === clientId && !r.archived).map(clientShoot);
  const shootIds = new Set(shoots.map((s) => s.id));
  // Their content requests and where each one stands (waiting, made a task, declined with the reason).
  const requests = records.filter((r) => r.kind === 'request' && r.clientId === clientId);
  const requestIds = new Set(requests.map((r) => r.id));
  const events = records.filter((r) => r.kind === 'event' && r.audience !== 'studio' && (!r.recipients || !userId || isEventRecipient(r, userId)) && ((!!r.taskId && taskIds.has(r.taskId)) || (!!r.postId && postIds.has(r.postId)) || (!!r.meetingId && meetingIds.has(r.meetingId)) || (!!r.shootId && shootIds.has(r.shootId)) || (!!r.requestId && requestIds.has(r.requestId))));
  // Devis/factures/contrats addressed to this client — never anyone else's.
  const documents = records.filter((r) => r.kind === 'document' && r.clientId === clientId && r.docStatus !== 'draft');
  const { drive, contract, serviceScope, workflowSettings, ...visibleClient } = client;
  void drive; void contract; void serviceScope; void workflowSettings; // working offers stay private until a document is sent
  return [visibleClient, ...projects, ...tasks, ...comments, ...events, ...documents, ...posts, ...meetings, ...shoots, ...requests];
}

/** A shoot as its client sees it: the date, place, who comes and what to prepare — not the studio's ids or outside crew. */
export function clientShoot(shoot: RecordItem): RecordItem {
  const { attendees, authorId, history, externalCrew, author, ...copy } = shoot;
  void attendees; void authorId; void history; void externalCrew; void author;
  return copy;
}

// ---------- what a creative (member) may see ----------

/** A member sees every client and project, plus the tasks assigned to them and the unassigned ones they can pick up. */
export function memberView(records: RecordItem[], identities: string[], userId?: string, social = false): RecordItem[] {
  const mine = new Set(identities.map((v) => v.trim().toLowerCase()).filter(Boolean));
  const visible = (task: RecordItem) => task.assigneeId ? task.assigneeId === userId : !task.assignee?.trim() || mine.has(task.assignee.trim().toLowerCase());
  const clients = records.filter((r) => r.kind === 'client').map(({ serviceScope, ...client }) => { void serviceScope; return client; });
  const projects = records.filter((r) => r.kind === 'project');
  const tasks = records.filter((r) => r.kind === 'task' && visible(r));
  // Assigned plan ideas already have a client conversation, before promotion to a task.
  // Unassigned ideas stay in the studio's planning workspace.
  const ideas = records.filter((r) => r.kind === 'plan_item' && (!!r.assigneeId || !!r.assignee?.trim()) && visible(r));
  const taskIds = new Set([...tasks, ...ideas].map((t) => t.id));
  const comments = records.filter((r) => r.kind === 'comment' && !!r.taskId && taskIds.has(r.taskId));
  // A Social media manager also hears about the posts: client approvals, changes asked, publishing outcomes.
  // Meetings they plan or are invited to, and the notices about them.
  const meetings = records.filter((r) => r.kind === 'meeting' && !!userId && (r.authorId === userId || !!r.attendees?.includes(userId)));
  const meetingIds = new Set(meetings.map((m) => m.id));
  // Shooting sessions they shoot or planned (lib/shoots.ts), and the notices about them.
  const shoots = records.filter((r) => r.kind === 'shoot' && !!userId && (r.authorId === userId || !!r.attendees?.includes(userId)));
  const shootIds = new Set(shoots.map((s) => s.id));
  const events = records.filter((r) => r.kind === 'event' && ((!!r.taskId && taskIds.has(r.taskId)) || (social && !!r.postId && r.audience !== 'client') || (!!r.meetingId && meetingIds.has(r.meetingId) && r.audience !== 'client') || (!!r.shootId && shootIds.has(r.shootId) && r.audience !== 'client')));
  // Shared team resources — visible to every studio role, this one included. Devis/factures/
  // contrats ('document') are deliberately never added here: a member never sees them exist.
  const library = records.filter((r) => r.kind === 'library');
  // Editorial posts/platforms: same visibility as the library — every studio role sees every
  // client's posting calendar and the full platform list, no per-author scoping.
  const editorial = records.filter((r) => r.kind === 'editorial_post' || r.kind === 'platform');
  return [...clients, ...projects, ...tasks, ...ideas, ...comments, ...events, ...library, ...editorial, ...meetings, ...shoots];
}
