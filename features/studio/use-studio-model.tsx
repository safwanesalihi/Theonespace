"use client";
// What the studio derives from the workspace's records: clients, sub-projects and tasks, the lookups
// every screen uses (names, avatars, dates, due labels, archive state), the task list as filtered, and
// the client or task the route points at. Each piece is recomputed only when what it depends on
// changes — the records change on a load or a save, not on every keystroke or opened dialog.
import type { Process } from "@/lib/process";
import { useMemo } from "react";
import { Clock } from "lucide-react";
import { safeLink, type RecordItem } from "@/lib/model";
import type { WorkspaceRoute } from "@/lib/navigation";
import { formatTimestamp } from "@/lib/time";
import { isStudioRole, memberName, type WorkspaceMember } from "@/lib/workspace";
import { archivedIndex, dueTone, filterTasks, quickTests as taskQuickTests } from "@/features/tasks/model";
import type { TaskListView } from "@/features/tasks/use-task-list-view";
import type { StudioLookups } from "@/features/workspace/screen-props";
import type { SessionUser } from "@/features/workspace/use-workspace-session";

/** The first record of each id, as `Array.find` would return it. */
function byId(records: RecordItem[]) {
  const map = new Map<string, RecordItem>();
  for (const r of records) if (!map.has(r.id)) map.set(r.id, r);
  return map;
}

export function useStudioModel({ records, members, user, today, route, list, tr, tag, studioProcess }: {
  records: RecordItem[];
  /** The studio's process (lib/process.ts); this hook runs above the ProcessProvider. */
  studioProcess: Process;
  members: WorkspaceMember[];
  user: SessionUser;
  today: string;
  route: WorkspaceRoute;
  list: Pick<TaskListView, "showArchived" | "statusFilter" | "assigneeFilter" | "courtFilter" | "query" | "sort" | "quick">;
  tr: (text: string, vars?: Record<string, string | number>) => string;
  tag: string;
}) {
  const clients = useMemo(() => records.filter((r) => r.kind === "client"), [records]);
  const projects = useMemo(() => records.filter((r) => r.kind === "project"), [records]);
  const archived = useMemo(() => archivedIndex(records), [records]);
  const allTasks = useMemo(() => records.filter((r) => r.kind === "task"), [records]);
  const tasks = useMemo(() => allTasks.filter((r) => !archived(r)), [allTasks, archived]);
  const clientsById = useMemo(() => byId(clients), [clients]);
  const projectsById = useMemo(() => byId(projects), [projects]);
  // A person by display name or e-mail: the first member matching either, in roster order.
  const membersByName = useMemo(() => {
    const map = new Map<string, WorkspaceMember>();
    for (const m of members) for (const key of [memberName(m), m.email]) if (key && !map.has(key)) map.set(key, m);
    return map;
  }, [members]);
  const assigneeOptions = useMemo(() => [
    ...new Set([
      ...members.filter((m) => isStudioRole(m.role)).map(memberName),
      ...allTasks.map((t) => t.assignee || "").filter(Boolean),
    ]),
  ], [members, allTasks]);

  const lookups = useMemo<StudioLookups>(() => {
    const cname = (id?: string) =>
      id === "internal" ? "Agence" : (id && clientsById.get(id)?.name) || tr("Client");
    const avatarOf = (name?: string) => (name ? membersByName.get(name)?.avatar : undefined);
    const titlesOf = (name?: string) => (name && membersByName.get(name)?.titles) || [];
    const pname = (id?: string) => (id && projectsById.get(id)?.name) || tr("Aucun sous-projet");
    const dateLabel = (date?: string) =>
      date
        ? new Date(date + "T12:00:00").toLocaleDateString(tag, {
            day: "numeric",
            month: "short",
          })
        : tr("Sans date");
    const timeLabel = (date?: string) =>
      date
        ? formatTimestamp(date, tag, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit", hourCycle: "h23",
          })
        : "";
    const link = (t: RecordItem) => safeLink(t.deliverable || "");
    // Due dates in words: late by n days, today, tomorrow, or the date.
    const dueInfo: StudioLookups["dueInfo"] = (t) => {
      const { tone, days } = dueTone(t, today, studioProcess);
      if (tone === "none") return { tone, label: tr("Sans date") };
      if (tone === "late") return { tone, label: tr("En retard · {n} j", { n: -days! }) };
      if (tone === "today") return { tone, label: tr("Aujourd’hui") };
      if (tone === "soon" && days === 1) return { tone, label: tr("Demain") };
      return { tone, label: dateLabel(t.due) };
    };
    const duePill = (t: RecordItem) => {
      const d = dueInfo(t);
      return <span className={`due-pill ${d.tone}`}>{d.tone === "late" && <Clock size={11} />}{d.label}</span>;
    };
    return { archived, cname, pname, avatarOf, titlesOf, dateLabel, timeLabel, link, dueInfo, duePill };
  }, [archived, clientsById, projectsById, membersByName, tr, tag, today, studioProcess]);

  const { showArchived, statusFilter, assigneeFilter, courtFilter, query, sort, quick } = list;
  const baseFiltered = useMemo(() => filterTasks(
    allTasks,
    { showArchived, route, statusFilter, assigneeFilter, courtFilter, query, sort },
    { archived, cname: lookups.cname, tag, process: studioProcess },
  ), [allTasks, showArchived, route, statusFilter, assigneeFilter, courtFilter, query, sort, archived, lookups, tag, studioProcess]);
  // Quick chips on the task list (Mes tâches, En retard…), counted on the list as filtered above.
  const quickTests = useMemo(() => taskQuickTests(user, today, studioProcess), [user, today, studioProcess]);
  const filtered = useMemo(() => (quick ? baseFiltered.filter(quickTests[quick]) : baseFiltered), [quick, baseFiltered, quickTests]);

  // What the route points at.
  const client = (route.id && clientsById.get(route.id)) || null;
  const task = records.find((r) => (r.kind === "task" || r.kind === "plan_item") && r.id === route.id) || null;
  const currentClient =
    route.page === "portal"
      ? clients.find((c) => c.id === route.id)
      : route.page === "review"
        ? clients.find((c) => c.id === task?.clientId)
        : client;

  return { clients, projects, tasks, allTasks, assigneeOptions, lookups, baseFiltered, quickTests, filtered, client, task, currentClient };
}
