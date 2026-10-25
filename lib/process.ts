// A studio's process: its own task statuses — any name, colour, number and order — and the pages it
// uses. Each status carries a behaviour, and the engine (lib/flow.ts, the records actions, the sweep,
// the portal, the numbers) follows behaviours, never words: « the clock runs », « the owner checks it »,
// « the client approves it », « it is done ». The One Core's six statuses are the default process and
// keep their historical French ids, so tasks made before processes existed never need migrating.
// Stored per workspace as the `meta:process` record (lib/process-server.ts); edited by the owner on
// « Personnaliser » (features/customize). Pure: shared by the browser and the server.
import { z } from 'zod';

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

export type StatusDef = { id: string; label: string; color: StatusColor; behaviour: Behaviour; clock?: boolean };

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
export type Process = {
  preset: string;
  statuses: StatusDef[];
  pages: Record<PageId, PageSetting>;
  groups: Record<GroupId, { label?: string }>;
};

const label = z.string().trim().min(1, 'Donnez un nom à chaque statut.').max(40, 'Nom de statut trop long (40 caractères au plus).');
const statusSchema = z.object({
  id: z.string().trim().min(1).max(60),
  label,
  color: z.enum(statusColors),
  behaviour: z.enum(behaviours),
  clock: z.boolean().optional(),
}).strict();
const pageSchema = z.object({ on: z.boolean(), label: z.string().trim().max(40).optional(), group: z.enum(groupIds) }).strict();
export const processSchema = z.object({
  preset: z.string().trim().min(1).max(40),
  statuses: z.array(statusSchema).min(1, 'Gardez au moins un statut.').max(20, 'Vingt statuts au plus.'),
  pages: z.object(Object.fromEntries(pageIds.map((id) => [id, pageSchema])) as Record<PageId, typeof pageSchema>).strict(),
  groups: z.object(Object.fromEntries(groupIds.map((id) => [id, z.object({ label: z.string().trim().max(40).optional() }).strict()])) as Record<GroupId, z.ZodObject<{ label: z.ZodOptional<z.ZodString> }>>).strict(),
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
  const count = (b: Behaviour) => p.statuses.filter((s) => s.behaviour === b).length;
  if (!count('done')) issue('Il faut au moins un statut « Terminé ».');
  if (!count('todo') && !count('work')) issue('Il faut au moins un statut pour commencer (« Pas commencé » ou « En production »).');
  if (count('internal') > 1) issue('Un seul statut « Validation interne ».');
  if (count('client') > 1) issue('Un seul statut « Chez le client ».');
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
  const parsed = processSchema.safeParse(filled);
  return parsed.success ? parsed.data as Process : oneCoreProcess;
}

/** A fresh id for a status the owner adds. */
export const newStatusId = () => `st-${crypto.randomUUID().slice(0, 8)}`;
