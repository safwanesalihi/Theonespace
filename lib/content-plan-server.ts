// Plan Éditorial storage (server). A client's content profile and each monthly plan are 'meta' rows (kept
// out of the records every page loads); every reel and post of a plan is a real task (kind 'task') with
// the plan fields of lib/content-plan.ts, so the team assigns, tracks and validates it like any task.
// Nothing is ever deleted: a plan is archived, and its tasks with it.
import { batch, database, type Statement } from '@/lib/database';
import { insertRecord, loadRecords } from '@/lib/flow-server';
import type { RecordItem, Status } from '@/lib/model';
import {
  buildSkeleton, checkDraft, itemDescription, monthLabel, nextMonth, normalizeProfile, profileGaps,
  type ContentPlan, type ContentProfile, type Draft, type PlanItemFields, type PlanProductionRow, type Skeleton,
} from '@/lib/content-plan';
import { draftPlan } from '@/lib/content-plan-ai';

export class PlanError extends Error { constructor(message: string, public status = 400) { super(message); } }

type Db = ReturnType<typeof database>;
const profileId = (ws: string, clientId: string) => `content-profile:${ws}:${clientId}`;
const planRowId = (ws: string, id: string) => `content-plan:${ws}:${id}`;
const parse = <T>(data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as T;

export type PlanItem = RecordItem & PlanItemFields;
export const isPlanItem = (r: RecordItem): r is PlanItem => r.kind === 'task' && typeof (r as Partial<PlanItem>).planId === 'string';

// ---------------------------------------------------------------- profile

export async function readProfile(ws: string, clientId: string, db: Db = database()): Promise<ContentProfile | null> {
  const row = (await db.query<{ data: unknown }>("SELECT data FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [profileId(ws, clientId), ws]))[0];
  return row ? normalizeProfile(parse(row.data)) : null;
}

export async function saveProfile(ws: string, clientId: string, input: unknown, actor: string, db: Db = database()) {
  const profile = { ...normalizeProfile(input), updatedAt: new Date().toISOString(), updatedBy: actor };
  await db.query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1`,
    [profileId(ws, clientId), ws, JSON.stringify({ ...profile, clientId })],
  );
  return profile;
}

// ---------------------------------------------------------------- plans

export async function listPlans(ws: string, clientId?: string, db: Db = database()): Promise<ContentPlan[]> {
  const rows = await db.query<{ data: unknown; revision: number }>(
    "SELECT data, revision FROM records WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2)", [ws, `content-plan:${ws}:`],
  );
  return rows.map((r) => ({ ...parse<ContentPlan>(r.data), revision: r.revision }))
    .filter((p) => !clientId || p.clientId === clientId)
    .sort((a, b) => b.month.localeCompare(a.month));
}

export async function getPlan(ws: string, id: string, db: Db = database()): Promise<ContentPlan | null> {
  const row = (await db.query<{ data: unknown; revision: number }>("SELECT data, revision FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [planRowId(ws, id), ws]))[0];
  return row ? { ...parse<ContentPlan>(row.data), revision: row.revision } : null;
}

const planStatement = (ws: string, plan: ContentPlan, insert = false): Statement => insert
  ? { text: "INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)", params: [planRowId(ws, plan.id), ws, JSON.stringify(plan)] }
  : { text: "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", params: [planRowId(ws, plan.id), ws, JSON.stringify(plan)] };

export async function planItems(ws: string, planId: string, rows?: RecordItem[]): Promise<PlanItem[]> {
  return (rows ?? await loadRecords(ws)).filter(isPlanItem).filter((t) => t.planId === planId)
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '') || a.planCode.localeCompare(b.planCode, 'fr', { numeric: true }));
}

const taskUpdate = (ws: string, item: PlanItem): Statement => ({
  text: "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'task'",
  params: [item.id, ws, JSON.stringify(item)],
});

// ---------------------------------------------------------------- generation

/** Titles and formats of the client's two previous plans, for the AI to avoid. */
async function previousTitles(ws: string, clientId: string, month: string, rows: RecordItem[]) {
  const before = (await listPlans(ws, clientId)).filter((p) => p.month < month && !p.archived).slice(0, 2);
  const items = rows.filter(isPlanItem).filter((t) => before.some((p) => p.id === t.planId));
  return items.map((t) => `${before.find((p) => p.id === t.planId)!.month} · ${t.name} · ${t.planFormat}`);
}

type Applied = { fields: Omit<PlanItemFields, 'planId' | 'planLocked'>; name: string };
function applyDraftItem(it: ReturnType<typeof checkDraft>['items'][number]): Applied {
  const fields = {
    planCode: it.code, planType: it.type, planSerie: it.serie, planFormat: it.format, planHook: it.hook,
    planContent: it.contenu, planCta: it.cta, planPeople: it.personnes, planShoot: it.jour_tournage,
  };
  return { fields, name: `${it.code} · ${it.titre || it.serie || it.format || (it.type === 'reel' ? 'Reel' : 'Post')}` };
}

function sectionsFrom(draft: Partial<Draft>, skeleton: Skeleton) {
  const notes = new Map((draft.stories?.notes ?? []).map((n) => [n.name, n.note]));
  const production: PlanProductionRow[] = [];
  for (const day of skeleton.shootDays) {
    const planned = (draft.production?.jours ?? []).find((j) => j.jour === day.label);
    const lines = (planned?.elements ?? []).map((e) => `${e.contenu}${e.duree ? ` (${e.duree})` : ''}`).filter(Boolean);
    production.push({ step: `Tournage ${day.label}`, date: day.date, content: lines.join('\n') || '—' });
  }
  return {
    overview: String(draft.overview ?? '').trim(),
    stories: skeleton.stories.map((s) => ({ ...s, note: notes.get(s.name) ?? s.note })),
    specialStories: (draft.stories?.special ?? []).filter((s) => s?.date?.startsWith(`${skeleton.month}-`)).map((s) => ({ date: s.date, name: String(s.name ?? ''), type: String(s.type ?? ''), note: String(s.note ?? '') })).sort((a, b) => a.date.localeCompare(b.date)),
    production,
    reserve: (draft.production?.reserve ?? []).map(String).filter(Boolean),
    questions: (draft.questions_client ?? []).map((q) => ({ text: String(q), done: false })).filter((q) => q.text),
  };
}

export async function generatePlan(ws: string, owner: string, actor: string, clientId: string, month: string, focus: string) {
  const profile = await readProfile(ws, clientId);
  if (!profile) throw new PlanError('Remplissez d’abord le profil contenu du client.');
  const gaps = profileGaps(profile);
  if (gaps.length) throw new PlanError(`Profil contenu incomplet : ${gaps.join(', ')}.`);
  const existing = (await listPlans(ws, clientId)).find((p) => p.month === month && !p.archived);
  if (existing) throw new PlanError(`Un plan existe déjà pour ${monthLabel(month)} : archivez-le ou régénérez-le.`, 409);
  const rows = await loadRecords(ws);
  const skeleton = buildSkeleton(profile, month);
  const ai = await draftPlan({ profile, skeleton, focus, previous: await previousTitles(ws, clientId, month, rows) });
  if (!ai.ok) throw new PlanError(ai.error, 502);
  const { items } = checkDraft(ai.draft, skeleton, profile);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const plan: ContentPlan = {
    id, clientId, month, focus, ...sectionsFrom(ai.draft, skeleton),
    counts: { reels: items.filter((i) => i.type === 'reel').length, posts: items.filter((i) => i.type === 'post').length },
    quotas: { reels: profile.quotas.reels, posts: profile.quotas.posts },
    shootDays: skeleton.shootDays, warnings: ai.problems, shared: false, archived: false,
    generatedWith: ai.model, createdAt: now, createdBy: actor, updatedAt: now, revision: 1,
  };
  // Every slot becomes a task — a slot the AI left empty too, so the counts always match the quotas.
  const statements: Statement[] = [planStatement(ws, plan, true)];
  for (const slot of skeleton.slots) {
    const drafted = items.find((i) => i.code === slot.code);
    const applied = drafted ? applyDraftItem(drafted) : { name: `${slot.code} · À écrire`, fields: { planCode: slot.code, planType: slot.type, planSerie: slot.serie, planFormat: '', planHook: '', planContent: '', planCta: '', planPeople: [], planShoot: '' } };
    const task: PlanItem = {
      id: crypto.randomUUID(), kind: 'task', revision: 1, name: applied.name, clientId, due: slot.date, status: 'À faire', publishable: true,
      createdAt: now, history: [{ text: `Créé par le Plan Éditorial (${monthLabel(month)})`, date: now }],
      planId: id, ...applied.fields, planLocked: false, planShared: false,
      description: itemDescription(applied.fields),
    } as PlanItem;
    statements.push(insertRecord(task, owner, ws));
  }
  await batch(database(), statements);
  return plan;
}

/** Regenerates the unlocked items (all of them, or one) and, for the whole plan, its sections. */
export async function regenerate(ws: string, planId: string, onlyItemId?: string) {
  const plan = await getPlan(ws, planId);
  if (!plan || plan.archived) throw new PlanError('Plan introuvable.', 404);
  const profile = await readProfile(ws, plan.clientId);
  if (!profile) throw new PlanError('Profil contenu introuvable.');
  const rows = await loadRecords(ws);
  const items = await planItems(ws, planId, rows);
  const target = onlyItemId ? items.filter((i) => i.id === onlyItemId) : items.filter((i) => !i.planLocked && !i.archived);
  if (onlyItemId && !target.length) throw new PlanError('Élément introuvable.', 404);
  if (target.some((i) => i.planLocked)) throw new PlanError('Cet élément est verrouillé : déverrouillez-le pour le régénérer.', 409);
  const whole = !onlyItemId;
  // The slots as they stand now (a date or a series may have been edited by hand).
  const skeleton: Skeleton = {
    ...buildSkeleton(profile, plan.month), shootDays: plan.shootDays,
    slots: items.map((i) => ({ code: i.planCode, date: i.due ?? `${plan.month}-01`, type: i.planType, serie: i.planSerie })),
  };
  const codes = target.map((i) => i.planCode);
  if (!codes.length && !whole) return { plan, changed: 0 };
  const fixed = items.filter((i) => !codes.includes(i.planCode)).map((i) => ({ code: i.planCode, titre: i.name, format: i.planFormat }));
  const ai = await draftPlan({ profile, skeleton, focus: plan.focus, previous: await previousTitles(ws, plan.clientId, plan.month, rows), fixed }, { codes, sections: whole });
  if (!ai.ok) throw new PlanError(ai.error, 502);
  const { items: drafted } = checkDraft(ai.draft, skeleton, profile, { codes, sections: whole });
  const now = new Date().toISOString();
  const statements: Statement[] = [];
  let changed = 0;
  for (const item of target) {
    const d = drafted.find((x) => x.code === item.planCode);
    if (!d) continue;
    const applied = applyDraftItem({ ...d, serie: item.planSerie, date: item.due ?? d.date, type: item.planType });
    const next: PlanItem = { ...item, ...applied.fields, name: applied.name, description: itemDescription(applied.fields), history: [...(item.history ?? []), { text: 'Régénéré par l’IA', date: now }] };
    statements.push(taskUpdate(ws, next));
    changed++;
  }
  const updated: ContentPlan = whole
    ? { ...plan, ...sectionsFrom(ai.draft, skeleton), shootDays: plan.shootDays, warnings: ai.problems, generatedWith: ai.model, updatedAt: now }
    : { ...plan, warnings: [...plan.warnings.filter((w) => !w.startsWith(`${target[0].planCode} `)), ...ai.problems], updatedAt: now };
  statements.push(planStatement(ws, updated));
  await batch(database(), statements);
  return { plan: updated, changed };
}

// ---------------------------------------------------------------- editing

const editable = ['name', 'due', 'status', 'planSerie', 'planFormat', 'planHook', 'planContent', 'planCta', 'planPeople', 'planShoot', 'planLocked', 'deliverable'] as const;
export type ItemPatch = Partial<Pick<PlanItem, (typeof editable)[number]>> & { assigneeId?: string | null };

export async function updateItem(ws: string, itemId: string, patch: ItemPatch, revision: number, assignee?: { name: string; userId: string } | null) {
  const item = (await loadRecords(ws)).find((r) => r.id === itemId && isPlanItem(r)) as PlanItem | undefined;
  if (!item) throw new PlanError('Élément introuvable.', 404);
  if (item.revision !== revision) throw new PlanError('Cet élément a changé : actualisez avant de réessayer.', 409);
  const next: PlanItem = { ...item };
  for (const key of editable) if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key];
  if (patch.assigneeId !== undefined) {
    if (assignee) { next.assignee = assignee.name; next.assigneeId = assignee.userId; } else { delete next.assignee; delete next.assigneeId; }
  }
  next.description = itemDescription(next);
  const changed = await database().query(
    "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'task' AND revision = $4 RETURNING id",
    [item.id, ws, JSON.stringify(next), revision],
  );
  if (!changed.length) throw new PlanError('Cet élément a changé : actualisez avant de réessayer.', 409);
  return next;
}

export type PlanPatch = Partial<Pick<ContentPlan, 'overview' | 'focus' | 'stories' | 'specialStories' | 'production' | 'reserve' | 'questions'>>;
export async function updatePlan(ws: string, planId: string, patch: PlanPatch, revision: number) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  if (plan.revision !== revision) throw new PlanError('Ce plan a changé : actualisez avant de réessayer.', 409);
  const next: ContentPlan = { ...plan, ...patch, updatedAt: new Date().toISOString() };
  const changed = await database().query(
    "UPDATE records SET data = $3::jsonb, revision = revision + 1 WHERE id = $1 AND workspace_id = $2 AND kind = 'meta' AND revision = $4 RETURNING id",
    [planRowId(ws, planId), ws, JSON.stringify(next), revision],
  );
  if (!changed.length) throw new PlanError('Ce plan a changé : actualisez avant de réessayer.', 409);
  return next;
}

/** Shared with the client or not: the plan and its tasks (the portal hides plan tasks until then). */
export async function setShared(ws: string, planId: string, shared: boolean) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  const items = await planItems(ws, planId);
  await batch(database(), [
    planStatement(ws, { ...plan, shared, updatedAt: new Date().toISOString() }),
    ...items.map((i) => taskUpdate(ws, { ...i, planShared: shared } as PlanItem)),
  ]);
}

/** Archive (never delete): the plan and the tasks that were still open; unarchive puts back those same tasks. */
export async function setArchived(ws: string, planId: string, archived: boolean) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  if (!archived && (await listPlans(ws, plan.clientId)).some((p) => p.month === plan.month && !p.archived && p.id !== plan.id)) {
    throw new PlanError(`Un autre plan est actif pour ${monthLabel(plan.month)} : archivez-le d’abord.`, 409);
  }
  const items = await planItems(ws, planId);
  const affected = archived ? items.filter((i) => !i.archived) : items.filter((i) => (i as PlanItem & { archivedWithPlan?: boolean }).archivedWithPlan);
  await batch(database(), [
    planStatement(ws, { ...plan, archived, updatedAt: new Date().toISOString() }),
    ...affected.map((i) => {
      const next = { ...i, archived } as PlanItem & { archivedWithPlan?: boolean };
      if (archived) next.archivedWithPlan = true; else delete next.archivedWithPlan;
      return taskUpdate(ws, next);
    }),
  ]);
}

/** A copy of the plan on next month's slots (R1 → R1…), without the AI; locks, statuses and people reset. */
export async function duplicateToNextMonth(ws: string, owner: string, actor: string, planId: string) {
  const plan = await getPlan(ws, planId);
  if (!plan) throw new PlanError('Plan introuvable.', 404);
  const profile = await readProfile(ws, plan.clientId);
  if (!profile) throw new PlanError('Profil contenu introuvable.');
  const month = nextMonth(plan.month);
  if ((await listPlans(ws, plan.clientId)).some((p) => p.month === month && !p.archived)) throw new PlanError(`Un plan existe déjà pour ${monthLabel(month)}.`, 409);
  const source = await planItems(ws, planId);
  const skeleton = buildSkeleton(profile, month);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const next: ContentPlan = {
    ...plan, id, month, focus: '', shared: false, archived: false, warnings: [], revision: 1,
    counts: { reels: skeleton.slots.filter((s) => s.type === 'reel').length, posts: skeleton.slots.filter((s) => s.type === 'post').length },
    quotas: { reels: profile.quotas.reels, posts: profile.quotas.posts },
    shootDays: skeleton.shootDays, specialStories: [],
    stories: skeleton.stories.map((s) => ({ ...s, note: plan.stories.find((o) => o.name === s.name)?.note ?? s.note })),
    production: skeleton.shootDays.map((d) => ({ step: `Tournage ${d.label}`, date: d.date, content: plan.production.find((p) => p.step === `Tournage ${d.label}`)?.content ?? '—' })),
    questions: plan.questions.map((q) => ({ ...q, done: false })),
    generatedWith: `Copie de ${monthLabel(plan.month)}`, createdAt: now, createdBy: actor, updatedAt: now,
  };
  const statements: Statement[] = [planStatement(ws, next, true)];
  for (const slot of skeleton.slots) {
    const from = source.find((s) => s.planCode === slot.code);
    const fields = {
      planCode: slot.code, planType: slot.type, planSerie: slot.serie, planFormat: from?.planFormat ?? '', planHook: from?.planHook ?? '',
      planContent: from?.planContent ?? '', planCta: from?.planCta ?? '', planPeople: from?.planPeople ?? [], planShoot: from?.planShoot ?? '',
    };
    statements.push(insertRecord({
      id: crypto.randomUUID(), kind: 'task', revision: 1, clientId: plan.clientId, due: slot.date, status: 'À faire' as Status, publishable: true,
      name: from ? from.name : `${slot.code} · À écrire`, createdAt: now, history: [{ text: `Copié depuis ${monthLabel(plan.month)}`, date: now }],
      planId: id, ...fields, planLocked: false, planShared: false, description: itemDescription(fields),
    } as PlanItem, owner, ws));
  }
  await batch(database(), statements);
  return next;
}
