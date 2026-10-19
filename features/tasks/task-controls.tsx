"use client";
// A task's small controls, shared by every task view: its status chip and picker, which side holds it
// (the court), a list picker, the assignee picker and the time logged on it.
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import Avatar from "@/components/profile-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { courtLabels, courtOf, type Court } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { statusClass, statuses, type RecordItem, type Status } from "@/lib/model";
import { appNowMs, formatDuration } from "@/lib/time";
import { timerTotals } from "./model";

// Keyed by status, not by position: a new status never shifts the others' symbols.
export const statusSymbols: Record<Status, string> = { "À faire": "○", "En cours": "◐", "En pause": "‖", "Validation interne": "◑", "À valider": "●", "Validé": "✓" };
export function CourtChip({ task }: { task: RecordItem }) {
  const { t: tr } = useI18n();
  const c: Court = courtOf(task);
  return (
    <span className={`court ${c}`} title={tr("Qui doit agir")}>
      <i />
      {tr(courtLabels[c])}
    </span>
  );
}
// Read-only breakdown of the time logged on a task. The clock itself is driven by the task's
// status: moving it to "En cours" starts an entry, moving it away stops it (see `patch`).
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
export function Chip({ status = "À faire" }: { status?: Status }) {
  const { t: tr } = useI18n();
  return (
    <span className={`status ${statusClass[status]}`}>
      <span aria-hidden="true">{statusSymbols[status]}</span>
      {tr(status)}
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
  // Only the status and the name are read, so the inline "new task" row — a partial record that
  // has no id yet — can use the same control as a saved task.
  task: { status?: Status; name?: string };
  disabled?: boolean;
  allowApproval?: boolean;
  member?: boolean;
  onChange: (s: Status) => void;
}) {
  const { t: tr } = useI18n();
  return (
    <Select
      value={task.status || "À faire"}
      disabled={disabled}
      onValueChange={(v) => {
        if (v !== task.status) onChange(v as Status);
      }}
    >
      <SelectTrigger
        aria-label={tr("Changer le statut de {name}", { name: task.name ?? "" })}
        className={`status-pick ${statusClass[task.status || "À faire"]}`}
      >
        <span
          className={`status ${statusClass[task.status || "À faire"]}`}
        >
          <span aria-hidden="true">
            {statusSymbols[task.status || "À faire"]}
          </span>
          {tr(task.status || "À faire")}
          <ChevronDown size={11} className="status-caret" />
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {(member
          ? statuses.filter(
              (s) =>
                s === "À faire" ||
                s === "En cours" ||
                s === "En pause" ||
                s === "Validation interne" ||
                s === task.status,
            )
          : allowApproval
            ? [...statuses]
            : statuses.filter((s) => s !== "À valider" && s !== "Validé")
        ).map((s) => (
          <SelectItem key={s} value={s}>
            <span className="inline">
              <span aria-hidden="true">
                {statusSymbols[s]}
              </span>
              {tr(s)}
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
