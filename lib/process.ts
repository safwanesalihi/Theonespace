// A studio's process: its own task statuses — any name, colour, number and order — and the pages it
// uses. Each status carries a behaviour, and the engine (lib/flow.ts, the records actions, the sweep,
// the portal, the numbers) follows behaviours, never words: « the clock runs », « the owner checks it »,
// « the client approves it », « it is done ». The One Core's six statuses are the default process and
// keep their historical French ids, so tasks made before processes existed never need migrating.
// Stored per workspace as the `meta:process` record (lib/process-server.ts); edited by the owner on
// « Personnaliser » (features/customize). Pure: shared by the browser and the server.
import { z } from 'zod';
import { checkRoles, studioRoleSchema, type StudioRole } from '@/lib/roles';

export const behaviours = ['todo', 'work', 'paused', 'internal', 'client', 'done'] as const;
export type Behaviour = (typeof behaviours)[number];
/** What each behaviour does, as the owner reads it when choosing one. */
export const behaviourLabels: Record<Behaviour, string> = {
  todo: 'Pas commencé',
  work: 'En production',
  paused: 'En pause',
  internal: 'Validation interne',
  client: 'Chez le client',
  done: 'Terminé',
};
export const behaviourHelp: Record<Behaviour, string> = {
  todo: 'Pas encore commencé ; le chrono ne tourne pas.',
  work: 'Le travail avance ; le chrono de la personne tourne (désactivable).',
  paused: 'Arrêté pour le moment ; le chrono s’arrête.',
  internal: 'Le propriétaire ou un administrateur vérifie le livrable avant le client.',
  client: 'Envoyé au client : il valide ou demande des retours dans le portail ; validation tacite à l’échéance.',
  done: 'Validé et terminé : compte dans les livraisons et les chiffres.',
};

/** Chip colours. The first six are the historical ones (they keep their stylesheet classes). */
export const statusColors = ['gray', 'blue', 'slate', 'purple', 'orange', 'green', 'indigo', 'teal', 'amber', 'pink', 'red'] as const;
export type StatusColor = (typeof statusColors)[number];
const legacyClass: Partial<Record<StatusColor, string>> = { gray: 's0', blue: 's1', slate: 's-paused', purple: 's-internal', orange: 's2', green: 's3' };
/** The CSS class that paints a chip or a dot in this colour. */
export const colorClass = (color: StatusColor) => legacyClass[color] ?? `c-${color}`;

const legacyChart: Partial<Record<StatusColor, string>> = { gray: 'todo', blue: 'doing', slate: 'paused', purple: 'internal', orange: 'review', green: 'done' };
/** The colour charts draw this status in (a CSS value). */
export const chartColorOf = (color: StatusColor) => (legacyChart[color] ? `var(--t-chart-${legacyChart[color]})` : `var(--t-st-${color}-ink)`);

/** reviewers: for an internal check, the studio roles (lib/roles.ts) that pass it; the owner and anyone allowed to review when empty. */
export type StatusDef = { id: string; label: string; color: StatusColor; behaviour: Behaviour; clock?: boolean; reviewers?: string[] };

/** Pages a studio arranges in its sidebar; Tâches and Équipe can't be turned off. */
export const pageIds = ['tasks', 'internal', 'shoots', 'requests', 'social', 'ig', 'ig-search', 'library', 'crm', 'meetings', 'team', 'activity'] as const;
export type PageId = (typeof pageIds)[number];
export const requiredPages: PageId[] = ['tasks', 'team'];
export const pageLabels: Record<PageId, string> = {
  tasks: 'Tâches', internal: 'Tâches internes', shoots: 'Shootings', requests: 'Demandes', social: 'Social', ig: 'Analyse Instagram',
  'ig-search': 'Recherche Instagram', library: 'Bibliothèque', crm: 'CRM', meetings: 'Réunions', team: 'Équipe', activity: 'Activité',
};
export const groupIds = ['work', 'content', 'studio'] as const;
export type GroupId = (typeof groupIds)[number];
export const groupLabels: Record<GroupId, string> = { work: 'Production', content: 'Contenu', studio: 'Studio' };

export type PageSetting = { on: boolean; label?: string; group: GroupId };
/**
 * A kind of work the studio delivers (a Reel, an ad campaign, an SEO article…), with its own path: the
 * statuses it goes through, in order, picked from the studio's statuses. Two work types may share a
 * status (« Chez le client »). A studio without work types has one path: every status, in order.
 */
export type WorkType = { id: string; label: string; statusIds: string[] };
/**
 * The studio's calendar rules (The One Flow's numbers, now each studio's own). lockDays: the frozen days
 * before a publishing date (0: no freeze). archiveAfterDays: approved work leaves the lists this long
 * after its approval (0: never). gates: the milestones counted back from the publishing date, in days.
 * What the client's silence does, the deadline and the rounds are the validation rules (lib/workflow-settings.ts).
 */
export const gateKeys = ['brief', 'send', 'validation', 'ready'] as const;
export type GateKey = (typeof gateKeys)[number];
export type StudioRules = { lockDays: number; archiveAfterDays: number; gates: Record<GateKey, number> };
export const defaultRules: StudioRules = { lockDays: 7, archiveAfterDays: 15, gates: { brief: 14, send: 7, validation: 5, ready: 1 } };
/**
 * A piece of information the studio keeps on its tasks, beyond the built-in ones: an ad budget, a
 * keyword, an influencer's fee… `workTypes` limits it to some kinds of work (all when empty); `client`
 * shows it in the client's portal (team only otherwise). Values live on the task (`RecordItem.fields`).
 */
export const fieldTypes = ['text', 'longtext', 'number', 'money', 'date', 'choice', 'person', 'link', 'platform'] as const;
export type FieldType = (typeof fieldTypes)[number];
export type FieldDef = { id: string; label: string; type: FieldType; options?: string[]; unit?: string; workTypes?: string[]; client?: boolean };
export type FieldValue = string | number;
/**
 * The messages the app sends on its own, and through which channel. Each studio switches each one off
 * or on (all on by default, as before). In-app notices always stay: they are the activity history.
 * Sends a person clicks on purpose (reminding an assignee, resending, notifying a client) are not here.
 */
export const notifyEvents = ['assigned', 'sent', 'changes', 'approved', 'message', 'meeting'] as const;
export type NotifyEvent = (typeof notifyEvents)[number];
export const notifyChannels = ['whatsapp', 'email'] as const;
export type NotifyChannel = (typeof notifyChannels)[number];
/** Which channel each automatic message goes through today. */
export const notifyRoutes: Record<NotifyEvent, NotifyChannel[]> = {
  assigned: ['whatsapp'], sent: ['whatsapp'], changes: ['whatsapp'], approved: ['whatsapp', 'email'], message: ['whatsapp'], meeting: ['email'],
};
export type Process = {
  preset: string;
  statuses: StatusDef[];
  pages: Record<PageId, PageSetting>;
  groups: Record<GroupId, { label?: string }>;
  workTypes?: WorkType[];
  fields?: FieldDef[];
  notifications?: Partial<Record<NotifyEvent, Partial<Record<NotifyChannel, boolean>>>>;
  /** The studio's own roles (lib/roles.ts), on top of the built-in ones. */
  roles?: StudioRole[];
  rules?: Partial<Omit<StudioRules, 'gates'>> & { gates?: Partial<Record<GateKey, number>> };
};
/** The studio's rules, each one its own or The One Flow's. */
export const rulesOf = (process: Pick<Process, 'rules'> | undefined): StudioRules => ({
  ...defaultRules, ...process?.rules, gates: { ...defaultRules.gates, ...process?.rules?.gates },
});

const label = z.string().trim().min(1, 'Donnez un nom à chaque statut.').max(40, 'Nom de statut trop long (40 caractères au plus).');
const statusSchema = z.object({
  id: z.string().trim().min(1).max(60),
  label,
  color: z.enum(statusColors),
  behaviour: z.enum(behaviours),
  clock: z.boolean().optional(),
  reviewers: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
}).strict();
const pageSchema = z.object({ on: z.boolean(), label: z.string().trim().max(40).optional(), group: z.enum(groupIds) }).strict();
const workTypeSchema = z.object({
  id: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1, 'Donnez un nom à chaque type de travail.').max(40, 'Nom de type de travail trop long (40 caractères au plus).'),
  statusIds: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
}).strict();
/**
 * The rules every path must follow: a way to start, a way to finish, one client step at most. Internal
 * checks may follow one another (an account manager, then an art director): a chain, passed in order.
 */
function checkPath(statuses: StatusDef[], issue: (message: string) => void, where = '') {
  const count = (b: Behaviour) => statuses.filter((s) => s.behaviour === b).length;
  if (!count('done')) issue(`Il faut au moins un statut « Terminé »${where}.`);
  if (!count('todo') && !count('work')) issue(`Il faut au moins un statut pour commencer (« Pas commencé » ou « En production »)${where}.`);
  if (count('client') > 1) issue(`Un seul statut « Chez le client »${where}.`);
}
export const processSchema = z.object({
  preset: z.string().trim().min(1).max(40),
  statuses: z.array(statusSchema).min(1, 'Gardez au moins un statut.').max(40, 'Quarante statuts au plus.'),
  pages: z.object(Object.fromEntries(pageIds.map((id) => [id, pageSchema])) as Record<PageId, typeof pageSchema>).strict(),
  groups: z.object(Object.fromEntries(groupIds.map((id) => [id, z.object({ label: z.string().trim().max(40).optional() }).strict()])) as Record<GroupId, z.ZodObject<{ label: z.ZodOptional<z.ZodString> }>>).strict(),
  workTypes: z.array(workTypeSchema).max(30, 'Trente types de travail au plus.').optional(),
  fields: z.array(z.object({
    id: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1, 'Donnez un nom à chaque champ.').max(40, 'Nom de champ trop long (40 caractères au plus).'),
    type: z.enum(fieldTypes),
    options: z.array(z.string().trim().min(1).max(60)).max(30, 'Trente choix au plus.').optional(),
    unit: z.string().trim().max(12).optional(),
    workTypes: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    client: z.boolean().optional(),
  }).strict()).max(40, 'Quarante champs au plus.').optional(),
  roles: z.array(studioRoleSchema).max(20, 'Vingt rôles au plus.').optional(),
  notifications: z.object(Object.fromEntries(notifyEvents.map((e) => [e,
    z.object(Object.fromEntries(notifyChannels.map((c) => [c, z.boolean().optional()])) as Record<NotifyChannel, z.ZodOptional<z.ZodBoolean>>).strict().optional(),
  ])) as Record<NotifyEvent, z.ZodOptional<z.ZodObject<Record<NotifyChannel, z.ZodOptional<z.ZodBoolean>>>>>).strict().optional(),
  rules: z.object({
    lockDays: z.number().int().min(0).max(30, 'Trente jours de gel au plus.').optional(),
    archiveAfterDays: z.number().int().min(0).max(365, 'Un an au plus avant l’archivage.').optional(),
    gates: z.object(Object.fromEntries(gateKeys.map((k) => [k, z.number().int().min(0).max(90, 'Quatre-vingt-dix jours au plus pour une étape.').optional()])) as Record<GateKey, z.ZodOptional<z.ZodNumber>>).strict().optional(),
  }).strict().optional(),
}).strict().superRefine((p, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set<string>(), names = new Set<string>();
  for (const s of p.statuses) {
    if (ids.has(s.id)) issue('Deux statuts portent le même identifiant.');
    ids.add(s.id);
    const name = s.label.trim().toLowerCase();
    if (names.has(name)) issue('Deux statuts portent le même nom.');
    names.add(name);
  }
  if (!p.workTypes?.length) {
    if (p.statuses.length > 20) issue('Vingt statuts au plus.');
    checkPath(p.statuses, issue);
  } else {
    // With work types, each path follows the rules on its own; the studio's statuses are their pool.
    const typeIds = new Set<string>(), typeNames = new Set<string>();
    for (const w of p.workTypes) {
      if (typeIds.has(w.id)) issue('Deux types de travail portent le même identifiant.');
      typeIds.add(w.id);
      const name = w.label.trim().toLowerCase();
      if (typeNames.has(name)) issue('Deux types de travail portent le même nom.');
      typeNames.add(name);
      if (new Set(w.statusIds).size !== w.statusIds.length) issue(`« ${w.label} » passe deux fois par le même statut.`);
      if (w.statusIds.some((id) => !ids.has(id))) { issue(`« ${w.label} » utilise un statut qui n’existe pas.`); continue; }
      checkPath(w.statusIds.map((id) => p.statuses.find((s) => s.id === id)!), issue, ` dans « ${w.label} »`);
    }
  }
  if (p.fields?.length) {
    const fieldIds = new Set<string>(), fieldNames = new Set<string>();
    const types = new Set((p.workTypes ?? []).map((w) => w.id));
    for (const f of p.fields) {
      if (fieldIds.has(f.id)) issue('Deux champs portent le même identifiant.');
      fieldIds.add(f.id);
      const name = f.label.trim().toLowerCase();
      if (fieldNames.has(name)) issue('Deux champs portent le même nom.');
      fieldNames.add(name);
      if (f.type === 'choice' && !f.options?.length) issue(`Ajoutez au moins un choix à « ${f.label} ».`);
      if (f.workTypes?.some((id) => !types.has(id))) issue(`« ${f.label} » vise un type de travail qui n’existe pas.`);
    }
  }
  if (p.roles?.length) checkRoles(p.roles, issue);
  const roleIds = new Set((p.roles ?? []).map((r) => r.id));
  for (const st of p.statuses) {
    if (st.reviewers?.length && st.behaviour !== 'internal') issue(`« ${st.label} » n’est pas une validation interne : personne ne la valide.`);
    if (st.reviewers?.some((id) => !roleIds.has(id))) issue(`« ${st.label} » est validé par un rôle qui n’existe pas.`);
  }
  if (requiredPages.some((id) => !p.pages[id].on)) issue('Les pages Tâches et Équipe restent toujours actives.');
});

const defaultPages: Record<PageId, PageSetting> = {
  tasks: { on: true, group: 'work' }, internal: { on: true, group: 'work' }, shoots: { on: true, group: 'work' }, requests: { on: true, group: 'work' },
  social: { on: true, group: 'content' }, ig: { on: true, group: 'content' }, 'ig-search': { on: true, group: 'content' }, library: { on: true, group: 'content' },
  crm: { on: true, group: 'studio' }, meetings: { on: true, group: 'studio' }, team: { on: true, group: 'studio' }, activity: { on: true, group: 'studio' },
};
export const defaultGroups = (): Process['groups'] => ({ work: {}, content: {}, studio: {} });
/** Every page with a setting: the defaults, then what the studio chose. */
export const withPages = (pages: Partial<Record<PageId, Partial<PageSetting>>> = {}): Record<PageId, PageSetting> =>
  Object.fromEntries(pageIds.map((id) => [id, { ...defaultPages[id], ...pages[id] }])) as Record<PageId, PageSetting>;

/** The One Core's process: the six historical statuses, with their French ids, and every page. */
export const oneCoreProcess: Process = {
  preset: 'one-core',
  statuses: [
    { id: 'À faire', label: 'À faire', color: 'gray', behaviour: 'todo' },
    { id: 'En cours', label: 'En cours', color: 'blue', behaviour: 'work' },
    { id: 'En pause', label: 'En pause', color: 'slate', behaviour: 'paused' },
    { id: 'Validation interne', label: 'Validation interne', color: 'purple', behaviour: 'internal' },
    { id: 'À valider', label: 'À valider', color: 'orange', behaviour: 'client' },
    { id: 'Validé', label: 'Validé', color: 'green', behaviour: 'done' },
  ],
  pages: withPages(),
  groups: defaultGroups(),
};

// ---------- reading a process ----------

export const statusDef = (status: string | undefined, process: Process = oneCoreProcess) =>
  process.statuses.find((s) => s.id === status) ?? oneCoreProcess.statuses.find((s) => s.id === status);
/** What a status does. An unknown one (a status deleted elsewhere, an old import) reads as work in progress. */
export const behaviourOf = (status: string | undefined, process: Process = oneCoreProcess): Behaviour =>
  statusDef(status ?? startStatus(process), process)?.behaviour ?? 'work';
export const is = (status: string | undefined, behaviour: Behaviour, process: Process = oneCoreProcess) => behaviourOf(status, process) === behaviour;
export const isDone = (status: string | undefined, process: Process = oneCoreProcess) => is(status, 'done', process);
/** The first status with this behaviour, in the studio's order. */
export const firstOf = (process: Process, behaviour: Behaviour) => process.statuses.find((s) => s.behaviour === behaviour)?.id;
/** Where a new task starts: the first « not started » status, else the first in production. */
export const startStatus = (process: Process = oneCoreProcess) =>
  firstOf(process, 'todo') ?? firstOf(process, 'work') ?? process.statuses[0].id;
/** Where work goes back to (client changes, an internal refusal, a new version of approved work). */
export const workStatus = (process: Process = oneCoreProcess) => firstOf(process, 'work') ?? startStatus(process);
/** Whether a person's clock runs while a task is in this status. */
export const runsClock = (status: string | undefined, process: Process = oneCoreProcess) => {
  const def = statusDef(status, process);
  return def?.behaviour === 'work' && def.clock !== false;
};
export const statusLabel = (status: string | undefined, process: Process = oneCoreProcess) => statusDef(status, process)?.label ?? status ?? '';
export const statusClassOf = (status: string | undefined, process: Process = oneCoreProcess) => colorClass(statusDef(status, process)?.color ?? 'gray');
/** Statuses in the studio's order (a task in an unknown status keeps it, shown last). */
export const statusIds = (process: Process = oneCoreProcess) => process.statuses.map((s) => s.id);
/** The steps a deliverable passes through, for the task page's stepper: everything but pauses. */
export const stepIds = (process: Process = oneCoreProcess) => process.statuses.filter((s) => s.behaviour !== 'paused').map((s) => s.id);
/** Statuses a team member may set by hand: work and pauses — the internal check, the client and « done » go through their own steps. */
export const manualIds = (process: Process = oneCoreProcess) =>
  process.statuses.filter((s) => s.behaviour === 'todo' || s.behaviour === 'work' || s.behaviour === 'paused').map((s) => s.id);

/**
 * In a chain of internal checks, the check that comes next on the path (pauses skipped), or null when
 * this one is the last: passing it then sends the work to the client, or finishes it when the path has
 * no client step. Give it the task's own path (flowFor).
 */
export function nextCheck(process: Process, status: string | undefined) {
  const path = process.statuses.filter((s) => s.behaviour !== 'paused');
  const i = path.findIndex((s) => s.id === status);
  if (i < 0 || path[i].behaviour !== 'internal') return null;
  const next = path[i + 1];
  return next?.behaviour === 'internal' ? next.id : null;
}

/** A status named by its id or its label (an imported file, the assistant), else undefined. */
export function statusByName(process: Process, name: string | undefined) {
  if (!name) return undefined;
  const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return process.statuses.find((s) => s.id === name)?.id ?? process.statuses.find((s) => plain(s.label) === plain(name))?.id;
}

/** A stored process, checked; anything unreadable is the One Core's. */
export function readProcess(raw: unknown): Process {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  const filled = value && typeof value === 'object' ? { ...value, pages: withPages((value as Process).pages), groups: { ...defaultGroups(), ...(value as Process).groups } } : value;
  // A work type still naming a status removed since keeps the rest of its path; one with no status left
  // is dropped. A single stale reference must never send the whole studio back to the One Core's process.
  if (filled && Array.isArray((filled as Process).workTypes) && Array.isArray((filled as Process).statuses)) {
    const known = new Set((filled as Process).statuses.map((s) => s?.id));
    (filled as Process).workTypes = (filled as Process).workTypes!
      .map((w) => ({ ...w, statusIds: Array.isArray(w?.statusIds) ? w.statusIds.filter((id) => known.has(id)) : [] }))
      .filter((w) => w.statusIds.length);
  }
  // A check naming a studio role removed since keeps the others (none left: the usual reviewers pass it).
  if (filled && Array.isArray((filled as Process).statuses)) {
    const roleIds = new Set(Array.isArray((filled as Process).roles) ? (filled as Process).roles!.map((r) => r?.id) : []);
    (filled as Process).statuses = (filled as Process).statuses.map((st) => (Array.isArray(st?.reviewers) ? { ...st, reviewers: st.reviewers.filter((id) => roleIds.has(id)) } : st));
  }
  // A field aimed at a work type removed since keeps the others (none left: it applies to every task).
  if (filled && Array.isArray((filled as Process).fields)) {
    const types = new Set(((filled as Process).workTypes ?? []).map((w) => w?.id));
    (filled as Process).fields = (filled as Process).fields!.map((f) => (Array.isArray(f?.workTypes) ? { ...f, workTypes: f.workTypes.filter((id) => types.has(id)) } : f));
  }
  const parsed = processSchema.safeParse(filled);
  if (parsed.success) return parsed.data as Process;
  // Work types that no longer hold together: the studio keeps its statuses and pages, with one path.
  if (filled && (filled as Process).workTypes) {
    const { workTypes, ...single } = filled as Process; void workTypes;
    if (single.fields) single.fields = single.fields.map(({ workTypes: aimed, ...field }) => { void aimed; return field; });
    const fallback = processSchema.safeParse(single);
    if (fallback.success) return fallback.data as Process;
  }
  return oneCoreProcess;
}

// ---------- work types ----------

/** The task's work type: the one it names, else the studio's first; none for a studio without work types. */
export const workTypeOf = (process: Process, id?: string) =>
  process.workTypes?.find((w) => w.id === id) ?? process.workTypes?.[0];

const flows = new WeakMap<Process, Map<string, Process>>();
/**
 * The process as one task sees it: only the statuses of its work type's path, in that path's order. Every
 * transition (where a task starts, goes back to work, is checked, sent, approved) reads this, so a Reel
 * and an SEO article each follow their own path. A studio without work types gets its whole process.
 */
export function flowFor(process: Process, task?: { workType?: string } | null): Process {
  const type = workTypeOf(process, task?.workType);
  if (!type) return process;
  let cache = flows.get(process);
  if (!cache) flows.set(process, (cache = new Map()));
  let flow = cache.get(type.id);
  if (!flow) {
    const byId = new Map(process.statuses.map((s) => [s.id, s]));
    const statuses = type.statusIds.map((id) => byId.get(id)).filter((s): s is StatusDef => !!s);
    flow = { ...process, statuses: statuses.length ? statuses : process.statuses };
    cache.set(type.id, flow);
  }
  return flow;
}

/**
 * Where a task lands when its work type changes: the new path's first status with the same behaviour
 * (work in progress stays in progress), else the new path's start.
 */
export function statusInFlow(process: Process, status: string | undefined, workType?: string) {
  const flow = flowFor(process, { workType });
  if (status && flow.statuses.some((s) => s.id === status)) return status;
  const behaviour = statusDef(status, process)?.behaviour;
  return (behaviour && firstOf(flow, behaviour)) || startStatus(flow);
}

// ---------- notifications ----------

/** Whether the studio sends this automatic message through this channel (on unless switched off). */
export const notifies = (process: Pick<Process, 'notifications'>, event: NotifyEvent, channel: NotifyChannel) =>
  process.notifications?.[event]?.[channel] !== false;

// ---------- custom fields ----------

/** The studio's fields that apply to this task: those for every work type, and those for its own. */
export function fieldsFor(process: Process, task?: { workType?: string } | null): FieldDef[] {
  if (!process.fields?.length) return [];
  const type = workTypeOf(process, task?.workType)?.id;
  return process.fields.filter((f) => !f.workTypes?.length || (!!type && f.workTypes.includes(type)));
}

const isDayValue = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
/**
 * The values sent for a task's fields, checked against their types: only this task's fields, empty ones
 * dropped, numbers as numbers, a date as YYYY-MM-DD, a choice among its options, a link in https, a
 * person among the team (`people`: their ids). An error names the field in the studio's own words.
 */
export function checkFieldValues(process: Process, task: { workType?: string }, values: unknown, people?: Set<string>): { values: Record<string, FieldValue> } | { error: string } {
  if (values === undefined || values === null) return { values: {} };
  if (typeof values !== 'object' || Array.isArray(values)) return { error: 'Champs invalides.' };
  const defs = new Map(fieldsFor(process, task).map((f) => [f.id, f]));
  const out: Record<string, FieldValue> = {};
  for (const [id, raw] of Object.entries(values as Record<string, unknown>)) {
    // An empty value is nothing to keep, even for a field of another work type (a task just moved).
    if (raw === '' || raw === null || raw === undefined) continue;
    const def = defs.get(id);
    if (!def) return { error: 'Ce champ ne fait pas partie de ce type de travail.' };
    const bad = { error: `Valeur invalide pour « ${def.label} ».` };
    if (def.type === 'number' || def.type === 'money') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(',', '.').trim()) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > 1e12 || (def.type === 'money' && n < 0)) return bad;
      out[id] = def.type === 'money' ? Math.round(n * 100) / 100 : n;
      continue;
    }
    if (typeof raw !== 'string') return bad;
    const v = raw.trim();
    if (!v) continue;
    if (v.length > (def.type === 'longtext' ? 5000 : 500)) return { error: `« ${def.label} » est trop long.` };
    if (def.type === 'date' && !isDayValue(v)) return bad;
    if (def.type === 'choice' && !def.options?.includes(v)) return bad;
    if (def.type === 'link' && !/^https:\/\/[^\s]+$/i.test(v)) return { error: `« ${def.label} » doit être un lien https://.` };
    if (def.type === 'person' && people && !people.has(v)) return bad;
    out[id] = v;
  }
  return { values: out };
}

/** A fresh id for a status the owner adds. */
export const newStatusId = () => `st-${crypto.randomUUID().slice(0, 8)}`;
