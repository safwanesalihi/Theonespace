"use client";
// A task's small controls, shared by every task view: its status chip and picker, which side holds it
// (the court), a list picker, the assignee picker and the time logged on it.
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import Avatar from "@/components/profile-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { courtLabels, courtOf, type Court } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem, Status } from "@/lib/model";
import { behaviourOf, fitsTask, flowFor, startStatus, statusClassOf, statusLabel, type Behaviour, type Process } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import { appNowMs, formatDuration } from "@/lib/time";
import { timerTotals } from "./model";

// A symbol per behaviour (lib/process.ts), so a studio's own statuses read like the One Core's.
export const behaviourSymbols: Record<Behaviour, string> = { todo: "○", work: "◐", paused: "‖", internal: "◑", client: "●", done: "✓" };
export const statusSymbol = (status: string | undefined, process: Process) => behaviourSymbols[behaviourOf(status, process)];
export function CourtChip({ task }: { task: RecordItem }) {
  const { t: tr } = useI18n();
  const c: Court = courtOf(task, useProcess());
  return (
    <span className={`court ${c}`} title={tr("Qui doit agir")}>
      <i />
      {tr(courtLabels[c])}
    </span>
  );
}
// Read-only breakdown of the time logged on a task. The clock itself is driven by the task's
// status: moving it to a status where the clock runs starts an entry, moving it away stops it (see `patch`).
export function TimeTracker({ task }: { task: RecordItem }) {
  const { t: tr } = useI18n();
  const [nowMs, setNowMs] = useState(() => appNowMs());
  useEffect(() => {
    const id = setInterval(() => setNowMs(appNowMs()), 30000);
    return () => clearInterval(id);
  }, []);
  const totals = timerTotals(task.timeEntries, nowMs);
  return (
    <div className="time-tracker">
      {totals.length > 0 ? (
        <ul className="time-breakdown">
          {totals.map((p) => (
            <li key={p.userId}>
              <span>
                {p.name}
                {p.running ? ` · ${tr("en cours")}` : ""}
              </span>
              <strong>{formatDuration(p.ms)}</strong>
            </li>
          ))}
          {totals.length > 1 && (
            <li className="time-total">
              <span>{tr("Total")}</span>
              <strong>
                {formatDuration(totals.reduce((sum, p) => sum + p.ms, 0))}
              </strong>
            </li>
          )}
        </ul>
      ) : (
        <p className="empty-state">{tr("Aucun temps enregistré pour cette tâche.")}</p>
      )}
    </div>
  );
}
/** A status chip in the studio's colour and words. */
export function Chip({ status }: { status?: Status }) {
  const { t: tr } = useI18n();
  const process = useProcess();
  const shown = status || startStatus(process);
  return (
    <span className={`status ${statusClassOf(shown, process)}`}>
      <span aria-hidden="true">{statusSymbol(shown, process)}</span>
      {tr(statusLabel(shown, process))}
    </span>
  );
}

export function StatusPick({
  task,
  disabled,
  allowApproval = true,
  member = false,
  onChange,
}: {
  // Only the status, the name, the work type and the client are read, so the inline "new task" row — a
  // partial record that has no id yet — can use the same control as a saved task.
  task: { status?: Status; name?: string; workType?: string; clientId?: string };
  disabled?: boolean;
  allowApproval?: boolean;
  member?: boolean;
  onChange: (s: Status) => void;
}) {
  const { t: tr } = useI18n();
  // Only the statuses on this task's path (its work type, lib/process.ts flowFor).
  const process = flowFor(useProcess(), task);
  const current = task.status || startStatus(process);
  // A member moves work along and asks for the internal check; sending to the client and « done »
  // stay with the owner and administrators (the server says the same, lib/process.ts behaviours).
  const options = process.statuses.filter((s) => s.id === task.status || fitsTask(s, task)).filter((s) =>
    member ? ["todo", "work", "paused", "internal"].includes(s.behaviour) || s.id === task.status
      : allowApproval || (s.behaviour !== "client" && s.behaviour !== "done") || s.id === task.status);
  return (
    <Select
      value={current}
      disabled={disabled}
      onValueChange={(v) => {
        if (v !== task.status) onChange(v as Status);
      }}
    >
      <SelectTrigger
        aria-label={tr("Changer le statut de {name}", { name: task.name ?? "" })}
        className={`status-pick ${statusClassOf(current, process)}`}
      >
        <span className={`status ${statusClassOf(current, process)}`}>
          <span aria-hidden="true">{statusSymbol(current, process)}</span>
          {tr(statusLabel(current, process))}
          <ChevronDown size={11} className="status-caret" />
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="inline">
              <span aria-hidden="true">{behaviourSymbols[s.behaviour]}</span>
              {tr(s.label)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Pick({
  value,
  onChange,
  items,
  label,
  emptyLabel = "—",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  items: string[] | { value: string; label: string }[];
  label: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const { t: tr } = useI18n();
  return (
    <Select
      disabled={disabled}
      value={value || "__none"}
      onValueChange={(v) => onChange(v === "__none" ? "" : v)}
    >
      <SelectTrigger aria-label={label} className="pick">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">{emptyLabel}</SelectItem>
        {items.map((i) =>
          typeof i === "string" ? (
            <SelectItem key={i} value={i}>
              {tr(i)}
            </SelectItem>
          ) : (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );

}
export function AssigneePick({
  value,
  onChange,
  items,
  label,
  emptyLabel = "—",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; avatar?: string | null; hint?: string }[];
  label: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      value={value || "__none"}
      onValueChange={(v) => onChange(v === "__none" ? "" : v)}
    >
      <SelectTrigger aria-label={label} className="pick assignee-pick">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">{emptyLabel}</SelectItem>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            <span className="inline">
              <Avatar name={i.value} avatar={i.avatar} />
              {i.value}
              {i.hint && <small className="assignee-hint">{i.hint}</small>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
