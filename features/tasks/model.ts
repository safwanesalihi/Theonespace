// The task list's rules, without React: which tasks show (filters, quick chips, archived parents), how
// they group and sort, when they are due, and how much time was logged. Tested in tests/task-model.mjs.
import { courtOf, shiftDay } from "@/lib/flow";
import type { RecordItem, Status } from "@/lib/model";
import { compareTasks, taskStatusOrder } from "@/lib/task-sort";
import { behaviourOf, isDone, oneCoreProcess, startStatus, type Process } from "@/lib/process";

export type QuickFilter = "" | "active" | "mine" | "late" | "week" | "review" | "nodate";
export type GroupBy = "none" | "status" | "client" | "assignee" | "due";
export type DueTone = "none" | "done" | "late" | "today" | "soon" | "later";
type Translate = (text: string, vars?: Record<string, string | number>) => string;

/**
 * Per-person time tracking: raw start/end entries grouped by who logged them, summing closed spans
 * plus the live span for anyone still running (`nowMs` lets the caller freeze or live-tick the total).
 */
export function timerTotals(
  entries: { userId: string; name: string; start: string; end?: string }[] = [],
  nowMs: number,
) {
  const byUser = new Map<string, { userId: string; name: string; ms: number; running: boolean }>();
  for (const e of entries) {
    const ms = Math.max(0, (e.end ? new Date(e.end).getTime() : nowMs) - new Date(e.start).getTime());
    const prev = byUser.get(e.userId);
    byUser.set(e.userId, { userId: e.userId, name: e.name, ms: (prev?.ms || 0) + ms, running: !!prev?.running || !e.end });
  }
  return [...byUser.values()].sort((a, b) => b.ms - a.ms);
}

/**
 * Whether a record sits in the archive: archived itself, or under an archived client or sub-project.
 * Built once per records list; each lookup is then constant time instead of a scan of every client.
 */
export function archivedIndex(records: RecordItem[]) {
  const clients = new Set<string>(), projects = new Set<string>();
  for (const r of records) {
    if (r.kind === "client" && r.archived) clients.add(r.id);
    else if (r.kind === "project" && r.archived) projects.add(r.id);
  }
  return (r: RecordItem) =>
    !!r.archived || (!!r.clientId && clients.has(r.clientId)) || (!!r.projectId && projects.has(r.projectId));
}

/** How many comments each task has, in one pass over the records. */
export function commentCounts(records: RecordItem[]) {
  const counts = new Map<string, number>();
  for (const r of records) if (r.kind === "comment" && r.taskId) counts.set(r.taskId, (counts.get(r.taskId) ?? 0) + 1);
  return counts;
}

/** When a task is due, in words the list can colour: late, today, this week, later, done or undated. */
export function dueTone(task: Pick<RecordItem, "due" | "status">, today: string, process: Process = oneCoreProcess): { tone: DueTone; days: number | null } {
  if (!task.due) return { tone: "none", days: null };
  if (isDone(task.status, process)) return { tone: "done", days: null };
  const days = Math.round((Date.parse(`${task.due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days < 0) return { tone: "late", days };
  if (days === 0) return { tone: "today", days };
  if (days === 1) return { tone: "soon", days };
  return { tone: days <= 6 ? "soon" : "later", days };
}

/** A task is someone's when assigned to them by id, or (older tasks) by their name or e-mail. */
export const isMineTask = (task: RecordItem, user: { id: string; name: string; email: string }) =>
  task.assigneeId
    ? task.assigneeId === user.id
    : !!task.assignee && [user.name, user.email].some((v) => v && v.toLowerCase() === task.assignee!.trim().toLowerCase());

/** The quick chips of the task list (Mes tâches, En retard…). */
export function quickTests(user: { id: string; name: string; email: string }, today: string, process: Process = oneCoreProcess): Record<Exclude<QuickFilter, "">, (t: RecordItem) => boolean> {
  const open = (t: RecordItem) => !isDone(t.status, process);
  return {
    active: open,
    mine: (t) => isMineTask(t, user),
    late: (t) => !!t.due && t.due < today && open(t),
    week: (t) => !!t.due && t.due >= today && t.due <= shiftDay(today, 6) && open(t),
    review: (t) => behaviourOf(t.status, process) === "client",
    nodate: (t) => !t.due && open(t),
  };
}

export type TaskFilters = {
  showArchived: boolean;
  /** The page the list sits on: a client's tasks, the internal tasks, or all client tasks. */
  route: { page: string; id?: string; tab?: string };
  statusFilter: Status | "";
  assigneeFilter: string;
  courtFilter: string;
  query: string;
  sort: string;
};

/** The task list before its quick chip: archive state, page, filters and search, then sorted. */
export function filterTasks(
  allTasks: RecordItem[],
  filters: TaskFilters,
  { archived, cname, tag, process = oneCoreProcess }: { archived: (r: RecordItem) => boolean; cname: (id?: string) => string; tag: string; process?: Process },
) {
  const { showArchived, route, statusFilter, assigneeFilter, courtFilter, query, sort } = filters;
  let list = allTasks.filter((t) => (showArchived ? archived(t) : !archived(t)));
  if (route.page === "client") list = list.filter((t) => t.clientId === route.id);
  if (route.page === "internal") list = list.filter((t) => t.clientId === "internal");
  if (route.page === "tasks" && route.tab !== "all") list = list.filter((t) => t.clientId !== "internal");
  if (statusFilter) list = list.filter((t) => t.status === statusFilter);
  if (assigneeFilter) list = list.filter((t) => t.assignee === assigneeFilter);
  if (courtFilter) list = list.filter((t) => courtOf(t, process) === courtFilter);
  if (query) {
    const needle = query.toLowerCase();
    list = list.filter((t) => `${t.name} ${cname(t.clientId)} ${t.assignee}`.toLowerCase().includes(needle));
  }
  return list.sort((a, b) => compareTasks(a, b, sort, tag, process));
}

/** What a group header shows next to its label. */
export type GroupMark =
  | { kind: "status"; status: Status }
  | { kind: "client"; client: RecordItem }
  | { kind: "assignee"; name?: string }
  | null;
export type TaskGroup = { key: string; label: string; mark: GroupMark; items: RecordItem[] };

/** The task list's groups (by status, client, person or due date), in their display order. */
export function groupTasks(
  items: RecordItem[],
  groupBy: GroupBy,
  { tr, cname, clientOf, today, process = oneCoreProcess }: { tr: Translate; cname: (id?: string) => string; clientOf: (id?: string) => RecordItem | undefined; today: string; process?: Process },
): TaskGroup[] {
  const statusOrder = taskStatusOrder(process);
  const out = new Map<string, TaskGroup & { order: string }>();
  for (const t of items) {
    let key: string, label: string, order: string, mark: GroupMark = null;
    if (groupBy === "status") {
      const s = t.status ?? startStatus(process);
      key = `s:${s}`; label = ""; order = String(statusOrder.indexOf(s) < 0 ? 99 : statusOrder.indexOf(s)).padStart(2, "0"); mark = { kind: "status", status: s };
    } else if (groupBy === "client") {
      const c = clientOf(t.clientId);
      key = `c:${t.clientId}`; label = cname(t.clientId); order = t.clientId === "internal" ? "0" : `1${label.toLowerCase()}`; mark = c ? { kind: "client", client: c } : null;
    } else if (groupBy === "assignee") {
      key = `a:${t.assignee || ""}`; label = t.assignee || tr("Non assigné"); order = t.assignee ? `0${label.toLowerCase()}` : "1"; mark = { kind: "assignee", name: t.assignee };
    } else {
      const tone = dueTone(t, today, process).tone;
      const bucket = tone === "late" ? ["0", "En retard"] : tone === "today" ? ["1", "Aujourd’hui"] : tone === "soon" ? ["2", "Cette semaine"] : tone === "later" ? ["3", "Plus tard"] : tone === "done" ? ["5", "Validées"] : ["4", "Sans date"];
      key = `d:${bucket[0]}`; label = tr(bucket[1]); order = bucket[0];
    }
    if (!out.has(key)) out.set(key, { key, label, mark, items: [], order });
    out.get(key)!.items.push(t);
  }
  return [...out.values()].sort((a, b) => a.order.localeCompare(b.order)).map(({ key, label, mark, items }) => ({ key, label, mark, items }));
}
