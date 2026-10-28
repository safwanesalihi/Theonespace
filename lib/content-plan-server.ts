// Plan Éditorial storage (server). Each monthly plan is a 'meta' row (kept out of the records every page
// loads) holding its branches and notes; every node of the map is a real task (kind 'task', planId), so
// can have a status, an assignee, a date and a comment thread. A node starts as an idea of the plan
// (kind 'plan_item', seen nowhere else) and becomes a real task (kind 'task', same id, same comments)
// when the studio sends it — one by one or all at once. A node or a month can be archived (and
// brought back) or deleted for good — a deleted node takes its comments with it.
import { batch, database, type Statement } from '@/lib/database';
import { insertRecord, loadRecords } from '@/lib/flow-server';
import type { RecordItem, Status } from '@/lib/model';
import { behaviourOf, flowFor, oneCoreProcess, runsClock, startStatus, statusByName, type Process } from '@/lib/process';
import { loadProcess } from '@/lib/process-server';
import { approve, sendForValidation, stopClocks, submitForReview } from '@/lib/flow';
import { cleanBranches, monthLabel, nextMonth, type Branch, type ContentPlan, type ImportedPlan, type ItemType, type PlanItemFields } from '@/lib/content-plan';

export class PlanError extends Error { constructor(message: string, public status = 400) { super(message); } }

type Db = ReturnType<typeof database>;
const planRowId = (ws: string, id: string) => `content-plan:${ws}:${id}`;
const parse = <T>(data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as T;

export type PlanItem = RecordItem & PlanItemFields;
export const isPlanItem = (r: RecordItem): r is PlanItem => (r.kind === 'task' || r.kind === 'plan_item') && typeof (r as Partial<PlanItem>).planId === 'string';
/** Sent to the tasks: a real task now, in the task lists, the calendar and the dashboard. */
export const isPushed = (r: RecordItem) => r.kind === 'task';

export type SignOffActor = { name: string; email?: string };
/**
 * A real task (kind 'task') changing status goes through the same transitions as the main path
 * (/api/records), by what the status does (lib/process.ts): to the client starts the approval clock and
 * history (sendForValidation), « done » records the studio sign-off (approve), anything else stops the
 * clock and clears an old sign-off. Plan ideas (kind 'plan_item') are left as they are until they are
 * sent as tasks. The route has already restricted « done » to the owner and administrators.
 */
function withTransition<T extends RecordItem>(task: T, from: Status | undefined, now: string, actor: SignOffActor = { name: 'Studio' }, process: Process = oneCoreProcess): T {
  if (task.kind !== 'task' || task.status === from) return task;
  const next = behaviourOf(task.status, process), before = behaviourOf(from, process);
  const chosen = { status: task.status };
  const unsigned = before === 'done' ? { validatedAt: undefined, signOff: undefined } : {};
  if (next !== before && next === 'internal') return { ...submitForReview({ ...task, status: from }, now, undefined, process), ...chosen } as T;
  if (next !== before && next === 'client') return { ...sendForValidation({ ...task, status: from, ...unsigned }, now, process), ...chosen } as T;
  if (next !== before && next === 'done') return { ...approve({ ...task, status: from }, { mode: 'studio', by: actor.name, email: actor.email, at: now, round: task.revisionRound ?? 0 }, process), ...chosen } as T;
  const left: T = { ...task, approvalDueAt: undefined, ...(next === 'done' ? {} : unsigned) };
  return (runsClock(left.status, process) ? left : stopClocks(left, now)) as T;
}

/** A stored plan, with defaults for the fields an older row may lack. */
const normalize = (raw: Partial<ContentPlan>, revision: number): ContentPlan => ({
  id: String(raw.id), clientId: String(raw.clientId), month: String(raw.month),
  branches: cleanBranches(raw.branches), notes: typeof raw.notes === 'string' ? raw.notes : '',
  shared: !!raw.shared, archived: !!raw.archived,
  createdAt: String(raw.createdAt ?? ''), createdBy: String(raw.createdBy ?? ''), updatedAt: String(raw.updatedAt ?? raw.createdAt ?? ''),
  revision,
});

export async function listPlans(ws: string, clientId?: string, db: Db = database()): Promise<ContentPlan[]> {
  const rows = await db.query<{ data: unknown; revision: number }>(
    "SELECT data, revision FROM records WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2)", [ws, `content-plan:${ws}:`],
  );
  return rows.map((r) => normalize(parse(r.data), r.revision))
    .filter((p) => !clientId || p.clientId === clientId)
    .sort((a, b) => b.month.localeCompare(a.month));
}

export async function getPlan(ws: string, id: string, db: Db = database()): Promise<ContentPlan | null> {
  const row = (await db.query<{ data: unknown; revision: number }>("SELECT data, revision FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [planRowId(ws, id), ws]))[0];
  return row ? normalize(parse(row.data), row.revision) : null;
}

const stored = ({ revision: _revision, ...plan }: ContentPlan) => { void _revision; return JSON.stringify(plan); };
const planInsert = (ws: string, plan: ContentPlan): Statement => ({
  text: "INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)",
  params: [planRowId(ws, plan.id), ws, stored(plan)],
});
const planUpdate = (ws: string, plan: ContentPlan): Statement => ({
  text: "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'",
  params: [planRowId(ws, plan.id), ws, stored(plan)],
});
const taskUpdate = (ws: string, item: PlanItem): Statement => ({
  text: "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind IN ('task', 'plan_item')",
  params: [item.id, ws, JSON.stringify(item)],
});

export async function planItems(ws: string, planId: string, rows?: RecordItem[]): Promise<PlanItem[]> {
  return (rows ?? await loadRecords(ws)).filter(isPlanItem).filter((t) => t.planId === planId)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt.localeCompare(b.createdAt));
}

const activeFor = async (ws: string, clientId: string, month: string, except?: string) =>
  (await listPlans(ws, clientId)).find((p) => p.month === month && !p.archived && p.id !== except);

const newItem = (ws: string, owner: string, plan: ContentPlan, fields: { name: string; planBranch: string; planType: ItemType; planContent?: string; due?: string; status?: string; deliverable?: string }, note: string, process: Process) => {
  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(), kind: 'plan_item', revision: 1, name: fields.name, clientId: plan.clientId, status: statusByName(process, fields.status) ?? startStatus(flowFor(process)), publishable: true,
    ...(fields.due ? { due: fields.due } : {}), ...(fields.deliverable ? { deliverable: fields.deliverable } : {}), createdAt: now, history: [{ text: note, date: now }],
    planId: plan.id, planMonth: plan.month, planBranch: fields.planBranch, planType: fields.planType, planContent: fields.planContent ?? '', planShared: plan.shared,
    description: fields.planContent ?? '',
  } as PlanItem;
  return { task, statement: insertRecord(task, owner, ws) };
};

/** Deletes plan tasks for good, with their comments, notices and the files and voice notes sent in them. */
const deleteStatements = (ws: string, ids: string[]): Statement[] => (ids.length ? [
  {
    text: `DELETE FROM assets WHERE workspace_id = $1 AND kind = 'audio' AND id IN (
             SELECT data->>'audio' FROM records WHERE workspace_id = $1 AND kind = 'comment' AND data->>'taskId' = ANY($2::text[]) AND data ? 'audio')`,
    params: [ws, ids],
  },
  {
    text: `DELETE FROM assets WHERE workspace_id = $1 AND kind = 'file' AND id IN (
             SELECT f->>'id' FROM records c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.data->'attachments') = 'array' THEN c.data->'attachments' ELSE '[]'::jsonb END) f
             WHERE c.workspace_id = $1 AND c.kind = 'comment' AND c.data->>'taskId' = ANY($2::text[]))`,
    params: [ws, ids],
  },
  { text: "DELETE FROM records WHERE workspace_id = $1 AND kind IN ('comment', 'event') AND data->>'taskId' = ANY($2::text[])", params: [ws, ids] },
  { text: "DELETE FROM records WHERE workspace_id = $1 AND kind IN ('task', 'plan_item') AND id = ANY($2::text[]) AND data ? 'planId'", params: [ws, ids] },
] : []);

// ---------------------------------------------------------------- plans

/** A new, empty month — or one that starts from the branches of the client's latest plan. */
export async function createPlan(ws: string, actor: string, clientId: string, month: string, copyBranches: boolean) {
  if (await activeFor(ws, clientId, month)) throw new PlanError(`Un plan existe déjà pour ${monthLabel(month)}.`, 409);
  const previous = copyBranches ? (await listPlans(ws, clientId)).find((p) => !p.archived && p.month < month) : undefined;
  const now = new Date().toISOString();
  const plan: ContentPlan = {
    id: crypto.randomUUID(), clientId, month, notes: '', shared: false, archived: false,
    branches: previous?.branches.map((b) => ({ ...b })) ?? [], createdAt: now, createdBy: actor, updatedAt: now, revision: 1,
  };
  const insert = planInsert(ws, plan);
  await database().query(insert.text, insert.params);
  return plan;
}

export type PlanPatch = { branches?: Branch[]; notes?: string };
export async function updatePlan(ws: string, planId: string, patch: PlanPatch, revision: number) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  if (plan.revision !== revision) throw new PlanError('Ce plan a changé : actualisez avant de réessayer.', 409);
  const next: ContentPlan = { ...plan, updatedAt: new Date().toISOString() };
  if (patch.branches !== undefined) {
    next.branches = cleanBranches(patch.branches);
    // A branch that still carries nodes is removed with remove-branch (its nodes are archived), not here.
    const items = await planItems(ws, planId);
    const kept = new Set(next.branches.map((b) => b.id));
    if (items.some((i) => !i.archived && plan.branches.some((b) => b.id === i.planBranch) && !kept.has(i.planBranch))) {
      throw new PlanError('Cette branche contient encore des contenus.', 409);
    }
  }
  if (patch.notes !== undefined) next.notes = patch.notes.slice(0, 5000);
  const changed = await database().query(
    "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'meta' AND revision = $4 RETURNING id",
    [planRowId(ws, planId), ws, stored(next), revision],
  );
  if (!changed.length) throw new PlanError('Ce plan a changé : actualisez avant de réessayer.', 409);
  return { ...next, revision: revision + 1 };
}

/** Takes a branch off the map and deletes its nodes. */
export async function removeBranch(ws: string, planId: string, branchId: string) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  if (!plan.branches.some((b) => b.id === branchId)) throw new PlanError('Branche introuvable.', 404);
  const items = (await planItems(ws, planId)).filter((i) => i.planBranch === branchId);
  await batch(database(), [
    planUpdate(ws, { ...plan, branches: plan.branches.filter((b) => b.id !== branchId), updatedAt: new Date().toISOString() }),
    ...deleteStatements(ws, items.map((i) => i.id)),
  ]);
  return items.filter((i) => !i.archived).length;
}

/** Deletes a whole month for good: the plan and every one of its nodes. */
export async function deletePlan(ws: string, planId: string) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  const items = await planItems(ws, planId);
  await batch(database(), [
    ...deleteStatements(ws, items.map((i) => i.id)),
    { text: "DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", params: [planRowId(ws, plan.id), ws] },
  ]);
  return items.length;
}

/** Deletes one node for good. */
export async function deleteItem(ws: string, itemId: string) {
  const item = (await loadRecords(ws)).find((r) => r.id === itemId && isPlanItem(r));
  if (!item) throw new PlanError('Élément introuvable.', 404);
  await batch(database(), deleteStatements(ws, [item.id]));
}

/**
 * « Modifier en JSON »: the month becomes exactly what the file says. Branches and nodes that carry
 * the id of one of this month's keep it (and their comments, assignee, history); new ones are created;
 * the live nodes left out of the file are deleted. Returns what changed.
 */
export async function replaceFromFile(ws: string, owner: string, planId: string, file: ImportedPlan, actor?: SignOffActor) {
  const [plan, studioProcess] = await Promise.all([getPlan(ws, planId), loadProcess(ws)]);
  if (!plan || plan.archived) throw new PlanError('Plan introuvable.', 404);
  if (file.month && file.month !== plan.month) throw new PlanError(`Ce fichier est pour ${monthLabel(file.month)}, pas pour ${monthLabel(plan.month)}.`);
  const items = await planItems(ws, planId);
  const byId = new Map(items.filter((i) => !i.archived).map((i) => [i.id, i]));
  const branches: Branch[] = [];
  const now = new Date().toISOString();
  const next: ContentPlan = { ...plan, notes: file.notes, updatedAt: now };
  const statements: Statement[] = [];
  const kept = new Set<string>();
  let created = 0, updated = 0;
  for (const b of file.branches) {
    const known = (b.id && plan.branches.find((x) => x.id === b.id)) || plan.branches.find((x) => x.name.toLocaleLowerCase('fr') === b.name.toLocaleLowerCase('fr'));
    const id = known && !branches.some((x) => x.id === known.id) ? known.id : crypto.randomUUID();
    if (branches.length >= 24) throw new PlanError('24 branches au plus par mois.');
    branches.push({ id, name: b.name });
    for (const it of b.items) {
      const current = it.id ? byId.get(it.id) : undefined;
      if (current && !kept.has(current.id)) {
        kept.add(current.id);
        let changedItem: PlanItem = {
          ...current, name: it.name, planType: it.planType, planBranch: id, planContent: it.planContent, description: it.planContent,
          status: statusByName(studioProcess, it.status) ?? current.status ?? startStatus(flowFor(studioProcess, current)),
        };
        if (it.due) changedItem.due = it.due; else delete changedItem.due;
        if (it.deliverable) changedItem.deliverable = it.deliverable; else delete changedItem.deliverable;
        // A real task whose status moved to « À valider » / « Validé » gets its approval clock and sign-off like on the main path.
        changedItem = withTransition(changedItem, current.status, now, actor, studioProcess);
        if (JSON.stringify(changedItem) !== JSON.stringify(current)) {
          changedItem.history = [...(changedItem.history ?? current.history ?? []), { text: 'Modifié depuis le JSON du Plan Éditorial', date: now }];
          statements.push(taskUpdate(ws, changedItem));
          updated++;
        }
      } else {
        const { id: _drop, ...fields } = it; void _drop;
        statements.push(newItem(ws, owner, next, { ...fields, planBranch: id }, `Ajouté depuis le JSON du Plan Éditorial (${monthLabel(plan.month)})`, studioProcess).statement);
        created++;
      }
    }
  }
  next.branches = branches;
  const gone = [...byId.keys()].filter((id) => !kept.has(id));
  await batch(database(), [planUpdate(ws, next), ...statements, ...deleteStatements(ws, gone)]);
  return { plan: next, created, updated, deleted: gone.length };
}


/** Shared with the client or not: the plan and its nodes (the portal hides plan tasks until then). */
export async function setShared(ws: string, planId: string, shared: boolean) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  const items = await planItems(ws, planId);
  await batch(database(), [
    planUpdate(ws, { ...plan, shared, updatedAt: new Date().toISOString() }),
    ...items.map((i) => taskUpdate(ws, { ...i, planShared: shared })),
  ]);
}

/** Archive (never delete): the plan and its open nodes; unarchive puts back those same nodes. */
export async function setArchived(ws: string, planId: string, archived: boolean) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  if (!archived && await activeFor(ws, plan.clientId, plan.month, plan.id)) {
    throw new PlanError(`Un autre plan est actif pour ${monthLabel(plan.month)} : archivez-le d’abord.`, 409);
  }
  const items = await planItems(ws, planId);
  const affected = archived ? items.filter((i) => !i.archived) : items.filter((i) => (i as PlanItem & { archivedWithPlan?: boolean }).archivedWithPlan);
  await batch(database(), [
    planUpdate(ws, { ...plan, archived, updatedAt: new Date().toISOString() }),
    ...affected.map((i) => {
      const next = { ...i, archived } as PlanItem & { archivedWithPlan?: boolean };
      if (archived) next.archivedWithPlan = true; else delete next.archivedWithPlan;
      return taskUpdate(ws, next);
    }),
  ]);
}

/** Next month with the same branches and the same nodes (titles, types, ideas), undated and « À faire ». */
export async function duplicateToNextMonth(ws: string, owner: string, actor: string, planId: string) {
  const [plan, studioProcess] = await Promise.all([getPlan(ws, planId), loadProcess(ws)]);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  const month = nextMonth(plan.month);
  if (await activeFor(ws, plan.clientId, month)) throw new PlanError(`Un plan existe déjà pour ${monthLabel(month)}.`, 409);
  const now = new Date().toISOString();
  const next: ContentPlan = { ...plan, id: crypto.randomUUID(), month, shared: false, archived: false, createdAt: now, createdBy: actor, updatedAt: now, revision: 1 };
  const statements: Statement[] = [planInsert(ws, next)];
  for (const i of (await planItems(ws, planId)).filter((x) => !x.archived)) {
    statements.push(newItem(ws, owner, next, { name: i.name, planBranch: i.planBranch, planType: i.planType, planContent: i.planContent }, `Copié depuis ${monthLabel(plan.month)}`, studioProcess).statement);
  }
  await batch(database(), statements);
  return next;
}

/** A ready plan from a JSON file: a new month, or added to an open one (branches matched by name). */
export async function importPlan(ws: string, owner: string, actor: string, clientId: string, file: ImportedPlan, intoPlanId?: string) {
  const studioProcess = await loadProcess(ws);
  let plan: ContentPlan;
  let fresh = false;
  if (intoPlanId) {
    const found = await getPlan(ws, intoPlanId);
    if (!found || found.archived || found.clientId !== clientId) throw new PlanError('Plan introuvable.', 404);
    plan = found;
  } else {
    if (!file.month) throw new PlanError('Le fichier doit indiquer « month » (AAAA-MM) pour créer un mois.');
    if (await activeFor(ws, clientId, file.month)) throw new PlanError(`Un plan existe déjà pour ${monthLabel(file.month)} : ouvrez-le et importez-y le fichier.`, 409);
    const now = new Date().toISOString();
    plan = { id: crypto.randomUUID(), clientId, month: file.month, notes: '', branches: [], shared: false, archived: false, createdAt: now, createdBy: actor, updatedAt: now, revision: 1 };
    fresh = true;
  }
  const branches = [...plan.branches];
  const idFor = (name: string) => {
    const same = branches.find((b) => b.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'));
    if (same) return same.id;
    if (branches.length >= 24) throw new PlanError('24 branches au plus par mois.');
    const b = { id: crypto.randomUUID(), name };
    branches.push(b);
    return b.id;
  };
  const note = `Importé dans le Plan Éditorial (${monthLabel(plan.month)})`;
  const next: ContentPlan = {
    ...plan, updatedAt: new Date().toISOString(),
    notes: file.notes ? (plan.notes ? `${plan.notes}\n\n${file.notes}` : file.notes).slice(0, 5000) : plan.notes,
  };
  const inserts: Statement[] = [];
  let count = 0;
  for (const b of file.branches) {
    const branchId = idFor(b.name);
    for (const it of b.items) { inserts.push(newItem(ws, owner, next, { ...it, planBranch: branchId }, note, studioProcess).statement); count++; }
  }
  next.branches = branches;
  await batch(database(), [fresh ? planInsert(ws, next) : planUpdate(ws, next), ...inserts]);
  return { plan: next, branches: file.branches.length, items: count };
}

// ---------------------------------------------------------------- nodes

/** Sends plan ideas to the tasks: these ones, or every idea of the month still in the plan. */
export async function pushItems(ws: string, planId: string, itemIds?: string[], actor?: SignOffActor) {
  const [plan, studioProcess] = await Promise.all([getPlan(ws, planId), loadProcess(ws)]);
  if (!plan || plan.archived) throw new PlanError('Plan introuvable.', 404);
  const items = (await planItems(ws, planId)).filter((i) => !i.archived && !isPushed(i) && (!itemIds || itemIds.includes(i.id)));
  if (itemIds && items.length !== new Set(itemIds).size) throw new PlanError('Élément introuvable ou déjà envoyé.', 404);
  const now = new Date().toISOString();
  await batch(database(), items.map((i) => {
    const pushed = { ...i, kind: 'task', history: [...(i.history ?? []), { text: `Envoyé en tâche depuis le Plan Éditorial (${monthLabel(plan.month)})`, date: now }] } as PlanItem;
    // An idea already in internal review, with the client or done becomes a task with that step's state set.
    const task = ['internal', 'client', 'done'].includes(behaviourOf(pushed.status, studioProcess)) ? withTransition(pushed, startStatus(flowFor(studioProcess, pushed)), now, actor, studioProcess) : pushed;
    return {
      text: "UPDATE records SET kind = 'task', data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'plan_item'",
      params: [i.id, ws, JSON.stringify(task)],
    };
  }));
  return items.length;
}

export async function addItem(ws: string, owner: string, planId: string, input: { name: string; planBranch: string; planType: ItemType; due?: string }) {
  const [plan, studioProcess] = await Promise.all([getPlan(ws, planId), loadProcess(ws)]);
  if (!plan || plan.archived) throw new PlanError('Plan introuvable.', 404);
  if (!plan.branches.some((b) => b.id === input.planBranch)) throw new PlanError('Branche introuvable.', 404);
  const { task, statement } = newItem(ws, owner, plan, input, `Ajouté au Plan Éditorial (${monthLabel(plan.month)})`, studioProcess);
  await database().query(statement.text, statement.params);
  return task;
}

export type ItemPatch = { name?: string; due?: string; status?: Status; planBranch?: string; planType?: ItemType; planContent?: string; deliverable?: string; archived?: boolean; assigneeId?: string | null };

export async function updateItem(ws: string, itemId: string, patch: ItemPatch, revision: number, assignee?: { name: string; userId: string } | null, actor?: SignOffActor) {
  const [rows, studioProcess] = await Promise.all([loadRecords(ws), loadProcess(ws)]);
  const item = rows.find((r) => r.id === itemId && isPlanItem(r)) as PlanItem | undefined;
  if (!item) throw new PlanError('Élément introuvable.', 404);
  if (item.revision !== revision) throw new PlanError('Cet élément a changé : actualisez avant de réessayer.', 409);
  if (patch.planBranch !== undefined) {
    const plan = await getPlan(ws, item.planId);
    if (!plan?.branches.some((b) => b.id === patch.planBranch)) throw new PlanError('Branche introuvable.', 404);
  }
  if (patch.status !== undefined && !studioProcess.statuses.some((s) => s.id === patch.status)) throw new PlanError('Statut invalide.');
  const next: PlanItem = { ...item };
  for (const key of ['name', 'status', 'planBranch', 'planType', 'planContent', 'deliverable', 'archived'] as const) {
    if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key];
  }
  if (patch.due !== undefined) { if (patch.due) next.due = patch.due; else delete next.due; }
  if (patch.assigneeId !== undefined) {
    if (assignee) { next.assignee = assignee.name; next.assigneeId = assignee.userId; } else { delete next.assignee; delete next.assigneeId; }
  }
  next.description = next.planContent;
  const saved = withTransition(next, item.status, new Date().toISOString(), actor, studioProcess);
  const changed = await database().query(
    "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind IN ('task', 'plan_item') AND revision = $4 RETURNING id",
    [item.id, ws, JSON.stringify(saved), revision],
  );
  if (!changed.length) throw new PlanError('Cet élément a changé : actualisez avant de réessayer.', 409);
  return { ...saved, revision: revision + 1 };
}
