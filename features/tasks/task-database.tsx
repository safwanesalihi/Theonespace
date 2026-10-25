"use client";
// The task database: the same tasks as a table, a board or a calendar, with search, filters, sort, quick
// chips, grouping, multi-select deletion, inline creation and a side panel. Used on the Tâches pages and
// on a client's « Tâches » tab.
import {
  Archive, ArrowUpRight, Briefcase, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Clock, Columns3, FileText, Filter, Inbox, Layers, Link as LinkIcon, List, Maximize2, MessageSquare, MoreHorizontal, PenLine,
  Plus, Search, Sparkles, Trash2, X,
} from "lucide-react";
import { Blank } from "@/components/empty-state";
import DatePicker from "@/components/date-picker";
import Avatar from "@/components/profile-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Surface } from "@/components/ui/surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hoursLeft, revisionState } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { dayKey, type Priority, type RecordItem, type Status } from "@/lib/model";
import { behaviourOf, isDone, startStatus, statusClassOf, statusLabel, type Process } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import { taskStatusOrder } from "@/lib/task-sort";
import { appCalendarNow, appNow, appNowMs, formatDuration } from "@/lib/time";
import { isStudioRole } from "@/lib/workspace";
import ClientMark from "@/features/clients/client-mark";
import type { StudioActions, StudioData, StudioLookups, StudioRoles } from "@/features/workspace/screen-props";
import { commentCounts, groupTasks as groupTaskList, timerTotals, type GroupBy, type QuickFilter } from "./model";
import { TaskConversation } from "./task-conversation";
import { Chip, CourtChip, Pick, StatusPick } from "./task-controls";
import TaskPriority from "./task-priority";
import type { TaskListView } from "./use-task-list-view";

export type TaskDatabaseProps = {
  data: StudioData;
  roles: StudioRoles;
  lookups: StudioLookups;
  actions: StudioActions;
  list: TaskListView;
  /** The list before its quick chip (the chips count on it), and after. */
  baseFiltered: RecordItem[];
  filtered: RecordItem[];
  quickTests: Record<Exclude<QuickFilter, "">, (t: RecordItem) => boolean>;
  assigneeOptions: string[];
  /** The client whose page this is (new tasks are created for them). */
  currentClient?: RecordItem | null;
  submitInlineTask: () => Promise<void>;
};
/** Everything the database's parts read, in one typed object. */
type TaskDatabaseContext = StudioData & StudioRoles & StudioLookups & StudioActions & TaskListView
  & Omit<TaskDatabaseProps, "data" | "roles" | "lookups" | "actions" | "list">
  & { tr: ReturnType<typeof useI18n>["t"]; tag: string; rtl: boolean; process: Process };

export function TaskDatabase({ data, roles, lookups, actions, list, ...rest }: TaskDatabaseProps) {
  const { t: tr, tag, rtl } = useI18n();
  const process = useProcess();
  const ctx: TaskDatabaseContext = { ...data, ...roles, ...lookups, ...actions, ...list, ...rest, tr, tag, rtl, process };
  return <TaskDatabaseBody ctx={ctx} />;
}

function groupTasks(ctx: TaskDatabaseContext, items: RecordItem[]): { key: string; label: string; mark?: React.ReactNode; items: RecordItem[] }[] {
  const { clients, today, cname, avatarOf, groupBy, tr, process } = ctx;
  return groupTaskList(items, groupBy, { tr, cname, clientOf: (id) => clients.find((x) => x.id === id), today, process }).map((g) => ({
    ...g,
    mark: g.mark?.kind === "status" ? <Chip status={g.mark.status} />
      : g.mark?.kind === "client" ? <ClientMark name={g.mark.client.name} logo={g.mark.client.logo} size="sm" />
      : g.mark?.kind === "assignee" ? <Avatar name={g.mark.name} avatar={avatarOf(g.mark.name)} />
      : null,
  }));
}

function QuickChips({ ctx }: { ctx: TaskDatabaseContext }) {
  const { view, quick, setQuick, groupBy, setGroupBy, setFolded, tr, baseFiltered, quickTests } = ctx;
  const chips: [QuickFilter, string][] = [["", "Toutes"], ["active", "Actives"], ["mine", "Mes tâches"], ["late", "En retard"], ["week", "Cette semaine"], ["review", "À valider"], ["nodate", "Sans date"]];
  return (
    <div className="quick-chips" role="group" aria-label={tr("Filtres rapides")}>
      {chips.map(([key, label]) => {
        // Approved tasks are done: they don't count.
        const n = (key ? baseFiltered.filter(quickTests[key]) : baseFiltered).filter((t) => !isDone(t.status, ctx.process)).length;
        if (key && !n && quick !== key) return null;
        return (
          <button key={key || "all"} type="button" className={`quick-chip${quick === key ? " on" : ""}${key === "late" ? " warn" : ""}`} aria-pressed={quick === key} onClick={() => setQuick(key)}>
            {tr(label)}<small>{n}</small>
          </button>
        );
      })}
      {view === "table" && (
        <label className="group-pick">
          <Layers size={14} />
          <select value={groupBy} onChange={(e) => { setGroupBy(e.target.value as GroupBy); setFolded(new Set()); }} aria-label={tr("Grouper par")}>
            <option value="none">{tr("Sans groupe")}</option>
            <option value="status">{tr("Grouper par statut")}</option>
            <option value="client">{tr("Grouper par client")}</option>
            <option value="assignee">{tr("Grouper par personne")}</option>
            <option value="due">{tr("Grouper par échéance")}</option>
          </select>
        </label>
      )}
    </div>
  );
}

function PeekPanel({ ctx }: { ctx: TaskDatabaseContext }) {
  const { clients, allTasks, workspace, busy, manager, member, writable, archived, cname, pname, avatarOf, link, duePill, navigate, open, update, peekId, setPeekId, tr, rtl, filtered } = ctx;
  const t = peekId ? allTasks.find((x) => x.id === peekId) : undefined;
  const index = t ? filtered.findIndex((x) => x.id === t.id) : -1;
  const go = (step: number) => { const next = filtered[index + step]; if (next) setPeekId(next.id); };

  const c = t ? clients.find((x) => x.id === t.clientId) : undefined;
  return (
    <Sheet open={!!t} onOpenChange={(o) => { if (!o) setPeekId(null); }}>
      <SheetContent side={rtl ? "left" : "right"} className="peek-panel" showCloseButton={false}>
        {t && <>
          <div className="peek-head">
            <div className="peek-nav">
              <button type="button" className="icon-button" aria-label={tr("Tâche précédente")} title={tr("Tâche précédente (↑)")} disabled={index <= 0} onClick={() => go(-1)}><ChevronUp size={16} /></button>
              <button type="button" className="icon-button" aria-label={tr("Tâche suivante")} title={tr("Tâche suivante (↓)")} disabled={index < 0 || index >= filtered.length - 1} onClick={() => go(1)}><ChevronDown size={16} /></button>
              {index >= 0 && <small>{index + 1} / {filtered.length}</small>}
            </div>
            <div className="inline">
              <button type="button" className="btn" onClick={() => navigate({ page: "task", id: t.id })}><Maximize2 size={14} />{tr("Ouvrir")}</button>
              <button type="button" className="icon-button" aria-label={tr("Fermer")} onClick={() => setPeekId(null)}><X size={16} /></button>
            </div>
          </div>
          <div className="peek-body">
            <p className="peek-client">{c ? <ClientMark name={c.name} logo={c.logo} size="sm" /> : null}{cname(t.clientId)}{t.projectId ? ` / ${pname(t.projectId)}` : ""}</p>
            <SheetTitle className="peek-title">{t.name}</SheetTitle>
            <SheetDescription className="sr-only">{tr("Aperçu de la tâche")}</SheetDescription>
            <dl className="peek-props">
              <div><dt>{tr("Statut")}</dt><dd>
                <StatusPick allowApproval={manager} member={member} task={t} disabled={archived(t) || busy || workspace?.role === "viewer"}
                  onChange={(s) => void update(t, { status: s }, tr("Statut : {status}", { status: tr(s) }))} />
              </dd></div>
              <div><dt>{tr("Échéance")}</dt><dd>{duePill(t)}</dd></div>
              <div><dt>{tr("Assigné")}</dt><dd className="inline"><Avatar name={t.assignee} avatar={avatarOf(t.assignee)} />{t.assignee || tr("Non assigné")}</dd></div>
              <div><dt>{tr("Priorité")}</dt><dd><TaskPriority priority={t.priority} /></dd></div>
              <div><dt>{tr("Camp")}</dt><dd><CourtChip task={t} /></dd></div>
              {link(t) && <div><dt>{tr("Livrable")}</dt><dd><a className="file-pill" href={link(t)} target="_blank" rel="noopener noreferrer"><FileText size={13} />{tr("Ouvrir")}<ArrowUpRight size={12} /></a></dd></div>}
            </dl>
            {t.description && <p className="peek-description">{t.description}</p>}
            <div className="peek-actions">
              <button type="button" className="btn" disabled={!writable || archived(t)} onClick={() => open("task", t)}><PenLine size={14} />{tr("Modifier")}</button>
            </div>
            <div className="peek-chat">
              <TaskConversation key={t.id} task={t} data={ctx} roles={ctx} lookups={ctx} actions={ctx} />
            </div>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  );
}

function TaskTable({ ctx, items }: { ctx: TaskDatabaseContext; items: RecordItem[] }) {
  const { records, clients, projects, members, workspace, busy, owner, manager, member, writable, archived, cname, pname, avatarOf, link, duePill, open, update, mutate, setError, setNotice, statusFilter, groupBy, folded, setFolded, peekId, setPeekId, inlineTask, setInlineTask, selectedTasks, setSelectedTasks, tr, currentClient, submitInlineTask } = ctx;
  // A modern list rather than a spreadsheet: one line per task — its status, title and what matters
  // about it underneath — then who, when and where it stands. Selection only for those who may delete.
  const selecting = manager;
  const picked = items.filter((t) => selectedTasks.has(t.id));
  const allPicked = !!items.length && picked.length === items.length;
  const toggle = (id: string) => setSelectedTasks((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const deletePicked = async () => {
    if (!window.confirm(tr("Supprimer {n} tâches, avec leurs commentaires ? C’est définitif.", { n: picked.length }))) return;
    try {
      await mutate({ action: "delete-many", kind: "task", items: picked.map((t) => ({ id: t.id, revision: t.revision })) });
      setSelectedTasks(new Set());
      setNotice(tr("{n} tâches supprimées.", { n: picked.length }));
    } catch (e) {
      setError(tr((e as Error).message));
    }
  };
  const comments = commentCounts(records);
  const groups = groupBy === "none" ? null : groupTasks(ctx, items);
  const timeOf = (t: RecordItem) => timerTotals(t.timeEntries, appNowMs()).reduce((acc, x) => acc + x.ms, 0);
  const row = (t: RecordItem) => {
    const c = clients.find((x) => x.id === t.clientId);
    const status = t.status ?? startStatus(ctx.process);
    const spent = owner || manager ? timeOf(t) : 0;
    return (
      <div key={t.id} role="row" className={`tl-row${selectedTasks.has(t.id) ? " selected" : ""}${peekId === t.id ? " peeked" : ""}${isDone(status, ctx.process) ? " done" : ""}`}>
        {selecting && (
          <input type="checkbox" className="row-check" checked={selectedTasks.has(t.id)} aria-label={tr("Sélectionner {name}", { name: t.name })} onChange={() => toggle(t.id)} />
        )}
        <span className={`tl-dot ${statusClassOf(status, ctx.process)}`} title={tr(statusLabel(status, ctx.process))} aria-hidden="true" />
        <button type="button" className="tl-main" onClick={() => setPeekId(t.id)} title={tr("Aperçu")}>
          <strong>{t.name}</strong>
          <span className="tl-meta">
            {c ? <ClientMark name={c.name} logo={c.logo} size="sm" /> : <Briefcase size={13} />}
            <span className="tl-client">{cname(t.clientId)}</span>
            {t.projectId && <span className="tl-sep">{pname(t.projectId)}</span>}
            {!!comments.get(t.id) && <span className="tl-icon" title={tr("Commentaires")}><MessageSquare size={12} />{comments.get(t.id)}</span>}
            {link(t) && <span className="tl-icon" title={tr("Livrable")}><LinkIcon size={12} /></span>}
            {spent > 0 && <span className="tl-icon" title={tr("Temps")}><Clock size={12} />{formatDuration(spent)}</span>}

            {t.request && <span className="flag-pill"><Inbox size={11} />{tr("Demande")}</span>}
            {t.evergreen && <span className="flag-pill" title={tr("Réserve evergreen")}><Sparkles size={11} /></span>}
            {t.publishable === false && <span className="flag-pill"><PenLine size={11} />{tr("Interne")}</span>}
            {revisionState(t).overBudget && <span className="flag-pill warn">{tr("Hors forfait")}</span>}
          </span>
        </button>
        <span className="tl-court"><CourtChip task={t} /></span>
        <span className="tl-priority" role="cell"><TaskPriority priority={t.priority} /></span>
        <span className="tl-person" title={t.assignee || tr("Non assigné")}><Avatar name={t.assignee} avatar={avatarOf(t.assignee)} /></span>
        <span className="tl-due">{duePill(t)}</span>
        <span className="tl-status">
          <StatusPick
            allowApproval={manager}
            member={member}
            task={t}
            disabled={archived(t) || busy || workspace?.role === "viewer"}
            onChange={(s) => void update(t, { status: s }, tr("Statut : {status}", { status: tr(s) }))}
          />
        </span>
        <span className="row-actions">
          <button className="icon-button" aria-label={tr("Modifier {name}", { name: t.name })} disabled={!writable || archived(t)} onClick={() => open("task", t)}>
            <PenLine size={14} />
          </button>
          {manager && (
            <button className="icon-button danger" aria-label={tr("Supprimer {name}", { name: t.name })} onClick={() => open("delete", t)}>
              <Trash2 size={14} />
            </button>
          )}
        </span>
      </div>
    );
  };
  return (
    <>
      {selecting && picked.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label={tr("Sélection")}>
          <strong>{tr("{n} sélectionnées", { n: picked.length })}</strong>
          <button type="button" className="btn ghost" onClick={() => setSelectedTasks(new Set())}>{tr("Désélectionner")}</button>
          <button type="button" className="btn danger primary" disabled={busy} onClick={() => void deletePicked()}><Trash2 size={14} />{tr("Supprimer")}</button>
        </div>
      )}
      <div className="task-list" role="table" aria-label={tr("Tâches")}>
        <div className="tl-head" role="row">
          {selecting && (
            <input type="checkbox" className="row-check" checked={allPicked} aria-label={tr("Tout sélectionner")}
              ref={(el) => { if (el) el.indeterminate = picked.length > 0 && !allPicked; }}
              onChange={() => setSelectedTasks(allPicked ? new Set() : new Set(items.map((t) => t.id)))} />
          )}
          <span className="tl-head-main">
            {(() => {
              const open = items.filter((t) => !isDone(t.status, ctx.process)).length, done = items.length - open;
              return <>{open === 1 ? tr("1 tâche") : tr("{n} tâches", { n: open })}{done > 0 && <em className="tl-head-done">{tr("+ {n} validées", { n: done })}</em>}</>;
            })()}
          </span>
          <span className="tl-court">{tr("Camp")}</span>
          <span className="tl-priority" role="columnheader">{tr("Priorité")}</span>
          <span className="tl-person">{tr("Assigné")}</span>
          <span className="tl-due">{tr("Échéance")}</span>
          <span className="tl-status">{tr("Statut")}</span>
          <span className="row-actions" />
        </div>
        {groups
          ? groups.map((g) => (
              <section key={`group:${g.key}`} className="tl-group">
                <button type="button" className="group-toggle" aria-expanded={!folded.has(g.key)} onClick={() => setFolded((cur) => { const next = new Set(cur); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}>
                  <ChevronRight size={15} className="group-chevron" />
                  {g.mark}
                  <span>{g.label}</span>
                  <small>{g.items.filter((t) => !isDone(t.status, ctx.process)).length || g.items.length}</small>
                </button>
                {!folded.has(g.key) && g.items.map(row)}
              </section>
            ))
          : items.map(row)}
        {inlineTask?.view === "table" && (
          <div className="tl-add-form">
            <input
              type="text"
              autoFocus
              className="inline-input"
              placeholder={tr("Nom de la tâche...")}
              value={inlineTask.name || ""}
              onChange={(e) => setInlineTask({ ...inlineTask, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") void submitInlineTask(); if (e.key === "Escape") setInlineTask(null); }}
            />
            <StatusPick allowApproval={manager} member={member} task={inlineTask} onChange={(st) => setInlineTask({ ...inlineTask, status: st })} />
                  <Select
                    disabled={!!currentClient}
                    value={inlineTask.clientId || "internal"}
                    onValueChange={v => setInlineTask({...inlineTask, clientId: v, projectId: ""})}
                  >
                    <SelectTrigger className="inline-input w-full h-8 px-2" aria-label={tr("Client")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!currentClient && <SelectItem value="internal">{tr("Interne")}</SelectItem>}
                      {(currentClient ? [currentClient] : clients.filter(c => !c.archived)).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={inlineTask.projectId || "none"} onValueChange={v => setInlineTask({...inlineTask, projectId: v === "none" ? "" : v})}>
                    <SelectTrigger className="inline-input w-full h-8 px-2" aria-label={tr("Projet")}>
                      <SelectValue placeholder={tr("Projet")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tr("Aucun")}</SelectItem>
                      {projects
                         .filter(p => !p.archived && (
                           inlineTask.clientId && inlineTask.clientId !== "internal"
                             ? p.clientId === inlineTask.clientId
                             : (!p.clientId || p.clientId === "internal")
                         ))
                         .map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={inlineTask.assignee || "unassigned"} onValueChange={v => setInlineTask({...inlineTask, assignee: v === "unassigned" ? "" : v})}>
                    <SelectTrigger className="inline-input w-full h-8 px-2" aria-label={tr("Assigné")}>
                      <SelectValue>
                        {inlineTask.assignee ? (
                          <span className="flex items-center gap-2">
                            <Avatar name={inlineTask.assignee} avatar={avatarOf(inlineTask.assignee)} />
                            <span className="truncate">{inlineTask.assignee}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{tr("Non assigné")}</span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">{tr("Non assigné")}</SelectItem>
                      {members.filter((m) => isStudioRole(m.role)).map(m => (
                        <SelectItem key={m.userId} value={m.name || "unknown"}>
                          <span className="flex items-center gap-2">
                            <Avatar name={m.name || "?"} avatar={m.avatar} />
                            {m.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
            <DatePicker className="inline-input" label={tr("Échéance")} value={inlineTask.due || ""} onChange={(v) => setInlineTask({ ...inlineTask, due: v })} placeholder="jj/mm/aaaa" />
            <Select value={inlineTask.priority || "Moyenne"} onValueChange={(v) => setInlineTask({ ...inlineTask, priority: v as Priority })}>
              <SelectTrigger className="inline-input w-28 h-8 px-2" aria-label={tr("Priorité")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Basse">{tr("Basse")}</SelectItem>
                <SelectItem value="Moyenne">{tr("Moyenne")}</SelectItem>
                <SelectItem value="Haute">{tr("Haute")}</SelectItem>
                <SelectItem value="Urgente">{tr("Urgente")}</SelectItem>
              </SelectContent>
            </Select>
            <button className="btn primary" onClick={() => void submitInlineTask()}><Check size={14} /> {tr("Valider")}</button>
            <button className="icon-button" aria-label={tr("Annuler")} onClick={() => setInlineTask(null)}><X size={16} /></button>
          </div>
        )}
        {!items.length && (
          <Blank
            title={tr("Aucune tâche trouvée")}
            text={
              manager
                ? "Créez une tâche ou ajustez les filtres."
                : "Aucune tâche assignée ou à prendre ici. Ajustez les filtres ou attendez la prochaine attribution."
            }
          />
        )}
        {manager && inlineTask?.view !== "table" && (
          <button
            className="add-row tl-add"
            disabled={busy}
            onClick={() => setInlineTask({ view: "table", status: statusFilter || startStatus(ctx.process), clientId: currentClient?.id || "internal" })}
          >
            <Plus size={15} />
            {tr("Nouvelle tâche")}
          </button>
        )}
      </div>
    </>
  );
}

function Board({ ctx }: { ctx: TaskDatabaseContext }) {
  const { records, clients, tasks, busy, manager, member, writable, archived, cname, avatarOf, dateLabel, link, duePill, open, update, setPeekId, showArchived, inlineTask, setInlineTask, draggingTaskId, setDraggingTaskId, dragOverStatus, setDragOverStatus, tr, filtered, currentClient, submitInlineTask } = ctx;
  const boardComments = commentCounts(records);
  return (
    <div className="board">
      {taskStatusOrder(ctx.process).map((s) => {
        const draggingTask = tasks.find((t) => t.id === draggingTaskId);
        // A member moves work along and asks for the internal check; the owner and administrators
        // move a task anywhere; nobody else sends to the client or marks done by hand (lib/process.ts).
        const behaviour = behaviourOf(s, ctx.process);
        const statusReachable = member
          ? ["todo", "work", "paused", "internal"].includes(behaviour)
          : manager || (behaviour !== "client" && behaviour !== "done");
        const dropAllowed =
          !!draggingTask &&
          writable &&
          !busy &&
          !archived(draggingTask) &&
          draggingTask.status !== s &&
          statusReachable;
        return (
          <section
            className={`board-column ${dragOverStatus === s ? (dropAllowed ? "drag-over" : "drag-over-blocked") : ""}`}
            key={s}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOverStatus(s);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = dropAllowed ? "move" : "none";
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDragOverStatus(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverStatus(null);
              const t = tasks.find(
                (t) => t.id === e.dataTransfer.getData("text/plain"),
              );
              if (
                t &&
                writable &&
                !busy &&
                !archived(t) &&
                t.status !== s &&
                statusReachable
              )
                void update(t, { status: s });
            }}
          >
            <header>
              <Chip status={s} />
              <small>{filtered.filter((t) => t.status === s).length}</small>
              {manager && (
                <button
                  aria-label={tr("Créer une tâche {status}", {
                    status: tr(statusLabel(s, ctx.process)),
                  })}
                  onClick={() => setInlineTask({ view: "board", status: s, clientId: currentClient?.id || "internal" })}
                >
                  <Plus size={16} />
                </button>
              )}
            </header>
            {filtered
              .filter((t) => t.status === s)
              .map((t) => (
                <Surface asChild tone="default" key={t.id}><article
                  className={`board-card ${draggingTaskId === t.id ? "dragging" : ""}`}
                  draggable={writable && !showArchived && !busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", t.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingTaskId(t.id);
                  }}
                  onDragEnd={() => {
                    setDraggingTaskId(null);
                    setDragOverStatus(null);
                  }}
                >
                  <small className="board-client">
                    {(() => { const c = clients.find((x) => x.id === t.clientId); return c ? <ClientMark name={c.name} logo={c.logo} size="sm" /> : null; })()}
                    {cname(t.clientId)}
                  </small>
                  <button
                    className="board-name"
                    onClick={() => setPeekId(t.id)}
                  >
                    {t.name}
                  </button>
                  {link(t) && (
                    <a
                      className="file-pill"
                      href={link(t)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FileText size={13} />
                      {tr("Livrable")}
                      <ArrowUpRight size={12} />
                    </a>
                  )}
                  <TaskPriority priority={t.priority} />
                  <footer>
                    <Avatar name={t.assignee} avatar={avatarOf(t.assignee)} />
                    {duePill(t)}
                    {(() => { const n = boardComments.get(t.id) ?? 0; return n ? <span className="row-comments"><MessageSquare size={12} />{n}</span> : null; })()}
                    <CourtChip task={t} />
                    <button
                      aria-label={tr("Modifier {name}", { name: t.name })}
                      disabled={!writable || archived(t)}
                      onClick={() => open("task", t)}
                    >
                      <MoreHorizontal size={17} />
                    </button>
                  </footer>
                  {behaviour === "client" && (
                    <div className={`flag-pill ${Math.round(hoursLeft(t, appNow()) ?? 0) <= 24 ? 'warn' : ''}`}>
                      <Clock size={11} />{" "}
                      {tr("Tacite dans {n} h", {
                        n: Math.max(
                          0,
                          Math.ceil((hoursLeft(t, appNow()) ?? 0) * 100) / 100,
                        ),
                      })}
                    </div>
                  )}
                  {behaviour === "done" && t.publishedAt && (
                    <div className="flag-pill">
                      <CheckCircle2 size={11} />{" "}
                      {tr("Publié le {date}", {
                        date: dateLabel(t.publishedAt.slice(0, 10)),
                      })}
                    </div>
                  )}
                </article></Surface>
              ))}
            {manager && (
              <>
                {inlineTask?.view === "board" && inlineTask?.status === s && (
                  <div className="board-inline-add">
                    <input
                      autoFocus
                      type="text"
                      className="inline-input w-full"
                      placeholder={tr("Nom de la tâche...")}
                      value={inlineTask.name || ""}
                      onChange={(e) => setInlineTask({ ...inlineTask, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitInlineTask();
                        if (e.key === "Escape") setInlineTask(null);
                      }}
                    />
                    <div className="board-inline-actions">
                      <button className="btn primary" onClick={() => void submitInlineTask()}>
                        <Check size={13} /> {tr("Ajouter")}
                      </button>
                      <button className="icon-button" onClick={() => setInlineTask(null)}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
                <button
                  className="add-row"
                  onClick={() => setInlineTask({ view: "board", status: s, clientId: currentClient?.id || "internal" })}
                >
                  <Plus size={14} />
                  {tr("Nouvelle tâche")}
                </button>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TaskCalendar({ ctx, items, readOnly = false }: { ctx: TaskDatabaseContext; items: RecordItem[]; readOnly?: boolean }) {
  const { today, manager, navigate, month, setMonth, calendarMode, setCalendarMode, inlineTask, setInlineTask, tr, tag, rtl, currentClient, submitInlineTask } = ctx;
  const start = new Date(month);
  start.setDate(1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (calendarMode === "week") {
    start.setTime(month.getTime());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  }
  const days = Array.from(
    { length: calendarMode === "week" ? 7 : 42 },
    (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    },
  );
  return (
    <Surface asChild tone="default"><div className="calendar-wrap">
      <div className="calendar-toolbar">
        <button className="btn" onClick={() => setMonth(appCalendarNow())}>
          {tr("Aujourd’hui")}
        </button>
        <button
          className="icon-button"
          aria-label={tr("Période précédente")}
          onClick={() =>
            setMonth(
              new Date(
                month.getFullYear(),
                month.getMonth() - (calendarMode === "month" ? 1 : 0),
                calendarMode === "month" ? 1 : month.getDate() - 7,
              ),
            )
          }
        >
          {rtl ? <ChevronRight /> : <ChevronLeft />}
        </button>
        <button
          className="icon-button"
          aria-label={tr("Période suivante")}
          onClick={() =>
            setMonth(
              new Date(
                month.getFullYear(),
                month.getMonth() + (calendarMode === "month" ? 1 : 0),
                calendarMode === "month" ? 1 : month.getDate() + 7,
              ),
            )
          }
        >
          {rtl ? <ChevronLeft /> : <ChevronRight />}
        </button>
        <h2>
          {month.toLocaleDateString(tag, { month: "long", year: "numeric" })}
        </h2>
        <div className="grow" />
        <Tabs value={calendarMode} onValueChange={setCalendarMode}>
          <TabsList>
            <TabsTrigger value="month">{tr("Mois")}</TabsTrigger>
            <TabsTrigger value="week">{tr("Semaine")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="calendar-grid">
        <div className="weekdays">
          {["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."].map(
            (d) => (
              <span key={d}>{tr(d)}</span>
            ),
          )}
        </div>
        <div className="calendar-days">
          {days.map((d) => {
            const key = dayKey(d);
            const events = items.filter((t) => t.due === key);
            return (
              <div
                className={`calendar-day ${d.getMonth() !== month.getMonth() ? "outside" : ""}`}
                key={key}
              >
                <header>
                  <span className={key === today ? "today" : ""}>
                    {d.getDate()}
                  </span>
                  {!readOnly && manager && (
                    <button
                      aria-label={tr("Créer une tâche le {day}", { day: key })}
                      onClick={() =>
                        setInlineTask({ view: "calendar", due: key, status: startStatus(ctx.process), clientId: currentClient?.id || "internal" })
                      }
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </header>
                {events.map((t) => (
                  <button
                    key={t.id}
                    className="calendar-event"
                    onClick={() => navigate({ page: readOnly ? "review" : "task", id: t.id })}
                  >
                    <strong>{t.name}</strong>
                    <Chip status={t.status} />
                  </button>
                ))}
                {inlineTask?.view === "calendar" && inlineTask?.due === key && (
                  <div className="calendar-inline-add">
                    <input
                      autoFocus
                      type="text"
                      className="inline-input w-full"
                      placeholder={tr("Nom de la tâche...")}
                      value={inlineTask.name || ""}
                      onChange={(e) => setInlineTask({ ...inlineTask, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitInlineTask();
                        if (e.key === "Escape") setInlineTask(null);
                      }}
                    />
                    <div className="board-inline-actions">
                      <button className="btn primary" style={{fontSize:"var(--t-size-caption)", padding:"2px 8px"}} onClick={() => void submitInlineTask()}>
                        <Check size={11} /> {tr("OK")}
                      </button>
                      <button className="icon-button" onClick={() => setInlineTask(null)}>
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div></Surface>
  );
}

function Toolbar({ ctx }: { ctx: TaskDatabaseContext }) {
  const { manager, open, view, setView, query, setQuery, statusFilter, assigneeFilter, courtFilter, filterOpen, setFilterOpen, sort, setSort, tr } = ctx;
  return (
    <div className="database-toolbar">
      <Tabs value={view} onValueChange={setView}>
        <TabsList variant="line">
          <TabsTrigger value="table">
            <List size={16} />
            {tr("Table")}
          </TabsTrigger>
          <TabsTrigger value="board">
            <Columns3 size={16} />
            {tr("Tableau")}
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarDays size={16} />
            {tr("Calendrier")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="toolbar-actions">
        <label className="search-input">
          <Search size={15} />
          <input
            aria-label={tr("Rechercher une tâche")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("Rechercher…")}
          />
        </label>
        <button
          className={`btn ghost ${filterOpen ? "selected" : ""}`}
          onClick={() => setFilterOpen(!filterOpen)}
        >
          <Filter size={15} />
          {tr("Filtrer")}
          {(statusFilter || assigneeFilter || courtFilter) && (
            <span className="filter-dot" />
          )}
        </button>
        <Pick
          label={tr("Trier les tâches")}
          value={sort}
          onChange={setSort}
          items={[
            { value: "due", label: tr("Échéance") },
            { value: "name", label: tr("Nom") },
            { value: "status", label: tr("Statut") },
          ]}
        />
        {manager && (
          <button className="btn primary" onClick={() => open("task")}>
            <Plus size={16} />
            {tr("Nouveau")}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskDatabaseBody({ ctx }: { ctx: TaskDatabaseContext }) {
  const { view, statusFilter, setStatusFilter, assigneeFilter, setAssigneeFilter, courtFilter, setCourtFilter, filterOpen, showArchived, setShowArchived, tr, filtered, assigneeOptions } = ctx;
  return (
    <>
      <Toolbar ctx={ctx} />
      <QuickChips ctx={ctx} />
      <PeekPanel ctx={ctx} />
      {filterOpen && (
        <div className="filters">
          <span>{tr("Statut")}</span>
          <Pick
            label={tr("Filtrer par statut")}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as Status | "")}
            items={ctx.process.statuses.map((st) => ({ value: st.id, label: tr(st.label) }))}
            emptyLabel={tr("Tous")}
          />
          <span>{tr("Assigné")}</span>
          <Pick
            label={tr("Filtrer par personne")}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            items={assigneeOptions}
            emptyLabel={tr("Tous")}
          />
          <span>{tr("Camp")}</span>
          <Pick
            label={tr("Filtrer par camp")}
            value={courtFilter}
            onChange={setCourtFilter}
            items={[
              { value: "studio", label: tr("Studio") },
              { value: "client", label: tr("Client") },
              { value: "done", label: tr("Terminé") },
            ]}
            emptyLabel={tr("Tous")}
          />
          <button
            className="btn ghost"
            onClick={() => {
              setStatusFilter("");
              setAssigneeFilter("");
              setCourtFilter("");
              setShowArchived(false);
            }}
          >
            {tr("Réinitialiser")}
          </button>
          <button
            className={`btn ${showArchived ? "selected" : ""}`}
            onClick={() => setShowArchived(!showArchived)}
          >
            <Archive size={14} />
            {tr(
              showArchived ? "Archives affichées" : "Afficher les archives",
            )}
          </button>
        </div>
      )}
      {view === "table" ? (
        <TaskTable ctx={ctx} items={filtered} />
      ) : view === "board" ? (
        <Board ctx={ctx} />
      ) : (
        // The tasks' own calendar: their due dates. What goes out, and when, is the Plan éditorial's.
        <TaskCalendar ctx={ctx} items={filtered.filter((t) => !!t.due)} />
      )}
    </>
  );
}
