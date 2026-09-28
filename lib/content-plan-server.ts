// Plan Éditorial storage (server). Each monthly plan is a 'meta' row (kept out of the records every page
// loads) holding its branches and notes; every node of the map is a real task (kind 'task', planId), so
// it has a status, an assignee, a date and a comment thread like any task. Nothing is ever deleted: a
// node, a branch's nodes or a whole plan are archived.
import { batch, database, type Statement } from '@/lib/database';
import { insertRecord, loadRecords } from '@/lib/flow-server';
import { statuses, type RecordItem, type Status } from '@/lib/model';
import { cleanBranches, monthLabel, nextMonth, type Branch, type ContentPlan, type ItemType, type PlanItemFields } from '@/lib/content-plan';

export class PlanError extends Error { constructor(message: string, public status = 400) { super(message); } }

type Db = ReturnType<typeof database>;
const planRowId = (ws: string, id: string) => `content-plan:${ws}:${id}`;
const parse = <T>(data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as T;

export type PlanItem = RecordItem & PlanItemFields;
export const isPlanItem = (r: RecordItem): r is PlanItem => r.kind === 'task' && typeof (r as Partial<PlanItem>).planId === 'string';

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
  text: "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'task'",
  params: [item.id, ws, JSON.stringify(item)],
});

export async function planItems(ws: string, planId: string, rows?: RecordItem[]): Promise<PlanItem[]> {
  return (rows ?? await loadRecords(ws)).filter(isPlanItem).filter((t) => t.planId === planId)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt.localeCompare(b.createdAt));
}

const activeFor = async (ws: string, clientId: string, month: string, except?: string) =>
  (await listPlans(ws, clientId)).find((p) => p.month === month && !p.archived && p.id !== except);

const newItem = (ws: string, owner: string, plan: ContentPlan, fields: { name: string; planBranch: string; planType: ItemType; planContent?: string; due?: string }, note: string) => {
  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(), kind: 'task', revision: 1, name: fields.name, clientId: plan.clientId, status: 'À faire' as Status, publishable: true,
    ...(fields.due ? { due: fields.due } : {}), createdAt: now, history: [{ text: note, date: now }],
    planId: plan.id, planBranch: fields.planBranch, planType: fields.planType, planContent: fields.planContent ?? '', planShared: plan.shared,
    description: fields.planContent ?? '',
  } as PlanItem;
  return { task, statement: insertRecord(task, owner, ws) };
};

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

/** Takes a branch off the map; its nodes are archived with it (never deleted). */
export async function removeBranch(ws: string, planId: string, branchId: string) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  if (!plan.branches.some((b) => b.id === branchId)) throw new PlanError('Branche introuvable.', 404);
  const items = (await planItems(ws, planId)).filter((i) => i.planBranch === branchId && !i.archived);
  await batch(database(), [
    planUpdate(ws, { ...plan, branches: plan.branches.filter((b) => b.id !== branchId), updatedAt: new Date().toISOString() }),
    ...items.map((i) => taskUpdate(ws, { ...i, archived: true })),
  ]);
  return items.length;
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
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  const month = nextMonth(plan.month);
  if (await activeFor(ws, plan.clientId, month)) throw new PlanError(`Un plan existe déjà pour ${monthLabel(month)}.`, 409);
  const now = new Date().toISOString();
  const next: ContentPlan = { ...plan, id: crypto.randomUUID(), month, shared: false, archived: false, createdAt: now, createdBy: actor, updatedAt: now, revision: 1 };
  const statements: Statement[] = [planInsert(ws, next)];
  for (const i of (await planItems(ws, planId)).filter((x) => !x.archived)) {
    statements.push(newItem(ws, owner, next, { name: i.name, planBranch: i.planBranch, planType: i.planType, planContent: i.planContent }, `Copié depuis ${monthLabel(plan.month)}`).statement);
  }
  await batch(database(), statements);
  return next;
}

// ---------------------------------------------------------------- nodes

export async function addItem(ws: string, owner: string, planId: string, input: { name: string; planBranch: string; planType: ItemType; due?: string }) {
  const plan = await getPlan(ws, planId);
  if (!plan || plan.archived) throw new PlanError('Plan introuvable.', 404);
  if (!plan.branches.some((b) => b.id === input.planBranch)) throw new PlanError('Branche introuvable.', 404);
  const { task, statement } = newItem(ws, owner, plan, input, `Ajouté au Plan Éditorial (${monthLabel(plan.month)})`);
  await database().query(statement.text, statement.params);
  return task;
}

export type ItemPatch = { name?: string; due?: string; status?: Status; planBranch?: string; planType?: ItemType; planContent?: string; deliverable?: string; archived?: boolean; assigneeId?: string | null };

export async function updateItem(ws: string, itemId: string, patch: ItemPatch, revision: number, assignee?: { name: string; userId: string } | null) {
  const item = (await loadRecords(ws)).find((r) => r.id === itemId && isPlanItem(r)) as PlanItem | undefined;
  if (!item) throw new PlanError('Élément introuvable.', 404);
  if (item.revision !== revision) throw new PlanError('Cet élément a changé : actualisez avant de réessayer.', 409);
  if (patch.planBranch !== undefined) {
    const plan = await getPlan(ws, item.planId);
    if (!plan?.branches.some((b) => b.id === patch.planBranch)) throw new PlanError('Branche introuvable.', 404);
  }
  if (patch.status !== undefined && !statuses.includes(patch.status)) throw new PlanError('Statut invalide.');
  const next: PlanItem = { ...item };
  for (const key of ['name', 'status', 'planBranch', 'planType', 'planContent', 'deliverable', 'archived'] as const) {
    if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key];
  }
  if (patch.due !== undefined) { if (patch.due) next.due = patch.due; else delete next.due; }
  if (patch.assigneeId !== undefined) {
    if (assignee) { next.assignee = assignee.name; next.assigneeId = assignee.userId; } else { delete next.assignee; delete next.assigneeId; }
  }
  next.description = next.planContent;
  const changed = await database().query(
    "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'task' AND revision = $4 RETURNING id",
    [item.id, ws, JSON.stringify(next), revision],
  );
  if (!changed.length) throw new PlanError('Cet élément a changé : actualisez avant de réessayer.', 409);
  return { ...next, revision: revision + 1 };
}
