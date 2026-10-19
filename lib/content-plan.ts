// « Plan Éditorial »: a client's monthly content plan, built by hand as a mind map — the month in the
// centre, the series around it (branches), and every reel, post or story as a node on its branch. Each
// node is a real task (kind 'task', with planId), so the team assigns, dates, tracks and validates it
// like any other task. This module is pure (browser and server): the types and the small helpers.
// Storage and the API live in lib/content-plan-server.ts and app/api/content-plan/route.ts.

export type ItemType = 'reel' | 'post' | 'story';
export const itemTypes: ItemType[] = ['reel', 'post', 'story'];
export const itemTypeLabels: Record<ItemType, string> = { reel: 'Reel', post: 'Post', story: 'Story' };

export type Branch = { id: string; name: string };

export type ContentPlan = {
  id: string;
  clientId: string;
  /** YYYY-MM */
  month: string;
  branches: Branch[];
  /** Free notes for the month: the angle, events, what to confirm with the client. */
  notes: string;
  shared: boolean;
  archived: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  revision: number;
};

/** What a plan node carries on top of an ordinary task. */
export type PlanItemFields = {
  planId: string;
  planBranch: string;
  planType: ItemType;
  /** The idea: what the piece says or shows. */
  planContent: string;
  planShared?: boolean;
};

export const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const isItemType = (v: unknown): v is ItemType => v === 'reel' || v === 'post' || v === 'story';

// ---------------------------------------------------------------- months

export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
/** « Octobre 2026 » — for server-side history lines; the interface formats months in its own language. */
export const monthLabel = (month: string) => `${monthNames[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export const nextMonth = (month: string, by = 1) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// ---------------------------------------------------------------- branches

/** Branches as typed in the page: named, unique ids, at most 24. */
export function cleanBranches(input: unknown): Branch[] {
  const seen = new Set<string>();
  const out: Branch[] = [];
  for (const b of Array.isArray(input) ? input : []) {
    const id = text((b as Branch)?.id, 64), name = text((b as Branch)?.name, 80);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
    if (out.length === 24) break;
  }
  return out;
}

/** The counts shown in the centre of the map. */
export function countItems(items: { planType: ItemType; archived?: boolean }[]) {
  const live = items.filter((i) => !i.archived);
  return { reel: live.filter((i) => i.planType === 'reel').length, post: live.filter((i) => i.planType === 'post').length, story: live.filter((i) => i.planType === 'story').length };
}

// ---------------------------------------------------------------- a ready plan uploaded as JSON
// {
//   "month": "2026-10",                       // optional when importing into an open month
//   "notes": "L’angle du mois…",              // optional
//   "branches": [
//     { "name": "Orientation", "items": [
//       { "type": "reel", "title": "BTS ou DUT ?", "date": "2026-10-01", "idea": "…", "status": "À faire", "drive": "https://…" }
//     ] }
//   ]
// }
// Only "branches[].name", "items[].type" and "items[].title" are required. A month exported for editing
// (planToFile) also carries the "id" of each branch and content, so saving it back updates them in place. A public copy of this
// format, filled in, is public/plan-editorial-modele.json.

export type ImportedItem = { id?: string; name: string; planType: ItemType; due?: string; planContent: string; status?: string; deliverable?: string };
export type ImportedPlan = { month?: string; notes: string; branches: { id?: string; name: string; items: ImportedItem[] }[] };

const typeAliases: Record<string, ItemType> = { reel: 'reel', reels: 'reel', video: 'reel', vidéo: 'reel', post: 'post', posts: 'post', carrousel: 'post', carousel: 'post', story: 'story', stories: 'story' };
export const planStatuses = ['À faire', 'En cours', 'Validation interne', 'À valider', 'Validé'];

/** Reads an uploaded plan; returns the plan, or the list of problems (in French, with where they are). */
export function parsePlanFile(input: unknown): { plan: ImportedPlan } | { errors: string[] } {
  const errors: string[] = [];
  const data = input as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { errors: ['Le fichier doit contenir un objet JSON avec « branches ».'] };
  const month = data.month === undefined || data.month === '' ? undefined : data.month;
  if (month !== undefined && !isMonth(month)) errors.push('« month » doit être au format AAAA-MM, par exemple 2026-10.');
  if (!Array.isArray(data.branches) || !data.branches.length) return { errors: [...errors, '« branches » doit être une liste d’au moins une branche.'] };
  if (data.branches.length > 24) errors.push('24 branches au plus.');
  const branches: ImportedPlan['branches'] = [];
  let total = 0;
  data.branches.slice(0, 24).forEach((raw, b) => {
    const branch = raw as Record<string, unknown>;
    const name = text(branch?.name, 80);
    const where = `Branche ${b + 1}${name ? ` (« ${name} »)` : ''}`;
    if (!name) errors.push(`${where} : « name » manque.`);
    const items: ImportedItem[] = [];
    const list = branch?.items ?? [];
    if (!Array.isArray(list)) { errors.push(`${where} : « items » doit être une liste.`); return; }
    list.forEach((rawItem, i) => {
      const it = rawItem as Record<string, unknown>;
      const at = `${where}, contenu ${i + 1}`;
      const title = text(it?.title ?? it?.name, 160);
      const type = typeAliases[String(it?.type ?? '').trim().toLowerCase()];
      const due = it?.date === undefined || it?.date === '' || it?.date === null ? undefined : it.date;
      const status = it?.status === undefined || it?.status === '' ? undefined : String(it.status).trim();
      const drive = text(it?.drive ?? it?.link, 500);
      if (!title) errors.push(`${at} : « title » manque.`);
      if (!type) errors.push(`${at} : « type » doit être reel, post ou story.`);
      if (due !== undefined && !isDay(due)) errors.push(`${at} : « date » doit être au format AAAA-MM-JJ.`);
      if (status !== undefined && !planStatuses.includes(status)) errors.push(`${at} : « status » doit être ${planStatuses.join(', ')}.`);
      if (drive && !/^https:\/\//i.test(drive)) errors.push(`${at} : « drive » doit commencer par https://.`);
      const id = text(it?.id, 64);
      if (title && type) items.push({ ...(id ? { id } : {}), name: title, planType: type, planContent: text(it?.idea ?? it?.content, 3000), ...(due ? { due: due as string } : {}), ...(status ? { status } : {}), ...(drive ? { deliverable: drive } : {}) });
    });
    total += items.length;
    const id = text(branch?.id, 64);
    if (name) branches.push({ ...(id ? { id } : {}), name, items });
  });
  if (total > 300) errors.push('300 contenus au plus par fichier.');
  if (errors.length) return { errors: errors.slice(0, 20) };
  return { plan: { ...(month ? { month: month as string } : {}), notes: text(data.notes, 5000), branches } };
}

/** A month as the JSON the studio edits (« Modifier en JSON »): same format as an upload, with the ids. */
export function planToFile(plan: { month: string; notes: string; branches: Branch[] }, items: { id: string; name: string; planBranch: string; planType: ItemType; due?: string; planContent?: string; status?: string; deliverable?: string; archived?: boolean }[]) {
  const live = items.filter((i) => !i.archived);
  const item = (i: (typeof live)[number]) => ({
    id: i.id, type: i.planType, title: i.name, ...(i.due ? { date: i.due } : {}), ...(i.planContent ? { idea: i.planContent } : {}),
    status: i.status ?? 'À faire', ...(i.deliverable ? { drive: i.deliverable } : {}),
  });
  const orphans = live.filter((i) => !plan.branches.some((b) => b.id === i.planBranch));
  return {
    month: plan.month,
    notes: plan.notes,
    branches: [
      ...plan.branches.map((b) => ({ id: b.id, name: b.name, items: live.filter((i) => i.planBranch === b.id).map(item) })),
      ...(orphans.length ? [{ name: 'Sans branche', items: orphans.map(item) }] : []),
    ],
  };
}
