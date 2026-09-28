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
