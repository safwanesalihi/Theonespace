"use client";
// How the person is looking at the task list: table, board or calendar; search, filters, sort, quick
// chip, grouping and folded groups; the task in the side panel; the inline « new task » row; the ticked
// rows and the card being dragged. The navigation keeps the savable part in each history entry, so Back
// returns to the same view.
import { useCallback, useMemo, useState } from "react";
import type { RecordItem, Status } from "@/lib/model";
import { appCalendarNow } from "@/lib/time";
import type { GroupBy, QuickFilter } from "./model";

/** The new task typed in place, in the table, a board column or a calendar day. */
export type InlineTask = Partial<RecordItem> & { view?: string };

export function useTaskListView() {
  const [view, setView] = useState("table"),
    [query, setQuery] = useState(""),
    [statusFilter, setStatusFilter] = useState<Status | "">(""),
    [assigneeFilter, setAssigneeFilter] = useState(""),
    [courtFilter, setCourtFilter] = useState(""),
    [filterOpen, setFilterOpen] = useState(false),
    [sort, setSort] = useState("status"),
    // The task list's quick chip, grouping (and folded groups), and the task open in the side panel.
    [quick, setQuick] = useState<QuickFilter>(""),
    [groupBy, setGroupBy] = useState<GroupBy>("none"),
    [folded, setFolded] = useState<Set<string>>(() => new Set()),
    [peekId, setPeekId] = useState<string | null>(null),
    [showArchived, setShowArchived] = useState(false),
    [month, setMonth] = useState(
      () => { const day = appCalendarNow(); return new Date(day.getFullYear(), day.getMonth(), 1); },
    ),
    [calendarMode, setCalendarMode] = useState("month");
  const [inlineTask, setInlineTask] = useState<InlineTask | null>(null);
  // Tasks ticked in the table, for deleting several at once.
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(() => new Set());
  // Kanban drag feedback: which card is being dragged, and which column it's currently over.
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null),
    [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

  /** What a new history entry starts with, and what each entry saves. */
  const defaultListView = useMemo(() => { const day = appCalendarNow(); return { view: "table", query: "", quick: "" as QuickFilter, statusFilter: "" as Status | "", assigneeFilter: "", courtFilter: "", showArchived: false, sort: "status", groupBy: "none" as GroupBy, folded: [] as string[], peekId: null as string | null, filterOpen: false, month: new Date(day.getFullYear(), day.getMonth(), 1).toISOString(), calendarMode: "month" }; }, []);
  const listView = useMemo(() => ({ view, query, quick, statusFilter, assigneeFilter, courtFilter, showArchived, sort, groupBy, folded: [...folded], peekId, filterOpen, month: month.toISOString(), calendarMode }), [view, query, quick, statusFilter, assigneeFilter, courtFilter, showArchived, sort, groupBy, folded, peekId, filterOpen, month, calendarMode]);
  const restoreListView = useCallback((saved: typeof defaultListView) => {
    setView(saved.view); setQuery(saved.query); setQuick(saved.quick); setStatusFilter(saved.statusFilter);
    setAssigneeFilter(saved.assigneeFilter); setCourtFilter(saved.courtFilter); setShowArchived(saved.showArchived);
    setSort(saved.sort); setGroupBy(saved.groupBy); setFolded(new Set(saved.folded)); setPeekId(saved.peekId);
    setFilterOpen(saved.filterOpen); setMonth(new Date(saved.month)); setCalendarMode(saved.calendarMode);
  }, []);

  return {
    view, setView, query, setQuery, statusFilter, setStatusFilter, assigneeFilter, setAssigneeFilter, courtFilter, setCourtFilter,
    filterOpen, setFilterOpen, sort, setSort, quick, setQuick, groupBy, setGroupBy, folded, setFolded, peekId, setPeekId,
    showArchived, setShowArchived, month, setMonth, calendarMode, setCalendarMode, inlineTask, setInlineTask,
    selectedTasks, setSelectedTasks, draggingTaskId, setDraggingTaskId, dragOverStatus, setDragOverStatus,
    defaultListView, listView, restoreListView,
  };
}

export type TaskListView = ReturnType<typeof useTaskListView>;
