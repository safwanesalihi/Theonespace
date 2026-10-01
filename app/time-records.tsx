"use client";
import { appDayKey, formatTimestamp } from "@/lib/time";
// The dashboard's time panel: who is on the clock right now, the time logged over a period, and
// the latest sessions. Read from the tasks' own time entries — the clock itself is driven by the
// task status ("En cours" starts it, anything else stops it), so nothing here writes time.
// Managers and viewers see the whole studio; a member sees their own time only.
import { Surface } from "@/components/ui/surface";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Pause, Timer } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Avatar from "@/app/profile-avatar";
import { useI18n } from "@/app/locale-provider";
import type { RecordItem } from "@/lib/model";
import type { WorkspaceMember } from "@/lib/workspace";
import { formatClock, formatDuration, overlapMs, periodStart, type Period, type TimeEntry } from "@/lib/time";

type Session = TimeEntry & { task: RecordItem; running: boolean };

export default function TimeRecords({
  tasks,
  members,
  userId,
  scope,
  clientName,
  onOpenTask,
  onPause,
}: {
  tasks: RecordItem[];
  members: WorkspaceMember[];
  userId: string;
  scope: "team" | "own";
  clientName: (id?: string) => string;
  onOpenTask: (id: string) => void;
  /** Pauses a task (which stops its clock). Absent for read-only roles. */
  onPause?: (task: RecordItem) => void;
}) {
  const { t, tag } = useI18n();
  const [period, setPeriod] = useState<Period>("week");
  const [now, setNow] = useState(() => Date.now());

  const sessions = useMemo<Session[]>(
    () =>
      tasks.flatMap((task) =>
        (task.timeEntries ?? [])
          .filter((e) => scope === "team" || e.userId === userId)
          .map((e) => ({ ...e, task, running: !e.end })),
      ),
    [tasks, scope, userId],
  );
  const running = sessions.filter((s) => s.running).sort((a, b) => a.start.localeCompare(b.start));

  // A running clock ticks every second; otherwise a minute is precise enough for the totals.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), running.length ? 1000 : 60000);
    return () => clearInterval(id);
  }, [running.length]);

  const from = periodStart(period, new Date(now));
  const inPeriod = sessions
    .map((s) => ({ ...s, ms: overlapMs(s, from, now) }))
    .filter((s) => s.ms > 0 || s.running);
  const total = inPeriod.reduce((sum, s) => sum + s.ms, 0);

  const group = (key: (s: (typeof inPeriod)[number]) => string) => {
    const map = new Map<string, { key: string; ms: number; running: boolean; sample: (typeof inPeriod)[number] }>();
    for (const s of inPeriod) {
      const k = key(s);
      const prev = map.get(k);
      map.set(k, { key: k, ms: (prev?.ms ?? 0) + s.ms, running: !!prev?.running || s.running, sample: prev?.sample ?? s });
    }
    return [...map.values()].sort((a, b) => b.ms - a.ms);
  };
  // The team view ranks people; a member, who only sees themselves, gets their tasks instead.
  const rows = scope === "team" ? group((s) => s.userId) : group((s) => s.task.id);
  const max = Math.max(1, ...rows.map((r) => r.ms));
  const recent = [...inPeriod].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 8);

  const person = (id: string) => members.find((m) => m.userId === id);
  const nameOf = (id: string, fallback: string) => person(id)?.name || fallback;
  const titlesOf = (id: string) => (person(id)?.titles ?? []).map((title) => t(title)).join(" · ");
  const clock = (iso: string) => formatTimestamp(iso, tag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = (iso: string) => formatTimestamp(iso, tag, { weekday: "short", day: "numeric", month: "short" });
  const todayKey = appDayKey(new Date(now));

  return (
    <Surface asChild tone="default"><section className="work-panel time-panel">
      <div className="section-head">
        <div>
          <h2>
            {t(scope === "team" ? "Temps enregistré" : "Mon temps")}
            <span className="neutral-badge">{formatDuration(total)}</span>
          </h2>
          <p>{t("Le chronomètre tourne tant qu’une tâche est « En cours ».")}</p>
        </div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="today">{t("Aujourd’hui")}</TabsTrigger>
            <TabsTrigger value="week">{t("Semaine")}</TabsTrigger>
            <TabsTrigger value="month">{t("Mois")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {running.length > 0 && (
        <div className="time-running" aria-live="off">
          {running.map((s) => (
            <div key={`${s.task.id}:${s.userId}:${s.start}`} className="time-running-row">
              <span className="time-live-dot" aria-hidden="true" />
              {scope === "team" && <Avatar name={nameOf(s.userId, s.name)} avatar={person(s.userId)?.avatar} />}
              <button type="button" className="time-running-task" onClick={() => onOpenTask(s.task.id)}>
                <small>
                  {scope === "team" ? `${nameOf(s.userId, s.name)} · ` : ""}
                  {clientName(s.task.clientId)}
                </small>
                <strong>{s.task.name}</strong>
              </button>
              <span className="time-clock">{formatClock(now - Date.parse(s.start))}</span>
              {onPause && s.task.status === "En cours" && (s.userId === userId || scope === "team") && (
                <button type="button" className="btn time-pause" onClick={() => onPause(s.task)} aria-label={t("Mettre « {name} » en pause", { name: s.task.name })}>
                  <Pause size={13} />
                  <span>{t("Pause")}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {inPeriod.length ? (
        <div className="time-columns">
          <div>
            <h3>{t(scope === "team" ? "Par personne" : "Par tâche")}</h3>
            <ul className="time-bars">
              {rows.map((r) => (
                <li key={r.key}>
                  {scope === "team" ? (
                    <div className="time-bar-label">
                      <Avatar name={nameOf(r.key, r.sample.name)} avatar={person(r.key)?.avatar} />
                      <span>
                        <strong>{nameOf(r.key, r.sample.name)}</strong>
                        {titlesOf(r.key) && <small>{titlesOf(r.key)}</small>}
                      </span>
                    </div>
                  ) : (
                    <button type="button" className="time-bar-label" onClick={() => onOpenTask(r.key)}>
                      <span>
                        <strong>{r.sample.task.name}</strong>
                        <small>{clientName(r.sample.task.clientId)}</small>
                      </span>
                    </button>
                  )}
                  <span className="time-bar-track">
                    <span className={`time-bar-fill ${r.running ? "running" : ""}`} style={{ width: `${Math.max(3, (r.ms / max) * 100)}%` }} />
                  </span>
                  <span className="time-bar-value">{formatDuration(r.ms)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>{t("Dernières sessions")}</h3>
            <ul className="time-sessions">
              {recent.map((s) => (
                <li key={`${s.task.id}:${s.userId}:${s.start}`}>
                  <button type="button" onClick={() => onOpenTask(s.task.id)}>
                    <span>
                      <strong>{s.task.name}</strong>
                      <small>
                        {scope === "team" ? `${nameOf(s.userId, s.name)} · ` : ""}
                        {appDayKey(s.start) === todayKey ? "" : `${day(s.start)} · `}
                        {clock(s.start)} – {s.running ? t("en cours") : clock(s.end!)}
                      </small>
                    </span>
                    <span className="time-session-value">{s.running ? formatClock(now - Date.parse(s.start)) : formatDuration(s.ms)}</span>
                    <ArrowUpRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="time-empty">
          <Timer size={20} />
          <p>{t("Aucun temps enregistré sur cette période.")}</p>
        </div>
      )}
    </section></Surface>
  );
}
