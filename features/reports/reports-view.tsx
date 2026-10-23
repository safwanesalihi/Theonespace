"use client";
// The dashboard's « Analyse » view — owner and administrators (features/flow/flow-page.tsx). The time the
// studio spends (per task, client, person and format), what one approved content costs in time, the pace
// from brief to approval, and how clients answer. Read from the records (lib/reports.ts); nothing writes.
import { Surface } from "@/components/ui/surface";
import { useEffect, useMemo, useState } from "react";
import { Timer } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import DashboardPeriod, { dashboardPeriod } from "@/features/dashboard/dashboard-period";
import { Chip } from "@/features/tasks/task-controls";
import type { RecordItem } from "@/lib/model";
import { reportHours, workReport, type TimeGroup } from "@/lib/reports";
import { appNowMs, formatDuration } from "@/lib/time";

const taskRows = 12;

export default function ReportsView({ records, today, onOpenTask }: { records: RecordItem[]; today: string; onOpenTask: (id: string) => void }) {
  const { t, tag } = useI18n();
  const [periodKey, setPeriodKey] = useState("month");
  const [customMonth, setCustomMonth] = useState<string>();
  const [allTasks, setAllTasks] = useState(false);
  // Clocks still running grow while the page is open.
  const [now, setNow] = useState(() => appNowMs());
  useEffect(() => { const id = setInterval(() => setNow(appNowMs()), 60_000); return () => clearInterval(id); }, []);
  const period = dashboardPeriod(today, periodKey, customMonth);
  const report = useMemo(() => workReport(records, period, now), [records, period?.from, period?.to, now]); // eslint-disable-line react-hooks/exhaustive-deps -- the period is rebuilt each render; its days are what matter
  const clientName = (task: RecordItem) => records.find((r) => r.kind === "client" && r.id === task.clientId)?.name ?? t("Interne");
  const percent = (rate: number) => new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 }).format(rate);
  const decimal = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 1 });
  const count = (n: number, one: string, many: string, vars: Record<string, string | number> = {}) => t(n === 1 ? one : many, { n, ...vars });
  const shown = allTasks ? report.tasks : report.tasks.slice(0, taskRows);
  const empty = !report.loggedMs && !report.approved;

  const groupPanel = (title: string, rows: TimeGroup[], id: string) => <Surface asChild tone="default"><section className="report-panel" aria-labelledby={id}>
    <header><h2 id={id}>{title}</h2></header>
    {!rows.length ? <p className="report-empty">{t("Rien sur la période.")}</p> : <ul className="report-bars">
      {rows.map((row) => <li key={row.key}>
        <span className="report-bar-line"><span>{t(row.label)}</span><strong>{row.ms ? formatDuration(row.ms) : "—"}</strong></span>
        <span className="report-bar" aria-hidden><span style={{ width: `${report.loggedMs ? Math.round((row.ms / report.loggedMs) * 100) : 0}%` }} /></span>
        <small>{[count(row.approved, "{n} validé", "{n} validés"), row.perApproved ? t("{d} par contenu", { d: formatDuration(row.perApproved) }) : ""].filter(Boolean).join(" · ")}</small>
      </li>)}
    </ul>}
  </section></Surface>;

  return <div className="reports-view">
    <div className="report-head">
      <DashboardPeriod value={periodKey} onChange={setPeriodKey} customMonth={customMonth} onMonthChange={(month) => { setCustomMonth(month); setPeriodKey("custom"); }} />
      <p>{t("Le temps passé et le rythme du travail, pour fixer les prix, répartir l’équipe et choisir les priorités. Le chrono d’une tâche tourne tant qu’elle est « En cours » ; seules les heures de travail comptent ({from}–{to}, du lundi au samedi).", { from: reportHours.from, to: reportHours.to })}</p>
    </div>

    <div className="report-stats">
      <Surface tone="default" className="report-stat">
        <span>{t("Temps passé")}</span>
        <strong>{report.loggedMs ? formatDuration(report.loggedMs) : "—"}</strong>
        <small>{count(report.timedTasks, "{n} tâche chronométrée", "{n} tâches chronométrées")}{report.running ? <> · <Timer size={11} /> {count(report.running, "{n} chrono en cours", "{n} chronos en cours")}</> : null}</small>
      </Surface>
      <Surface tone="default" className="report-stat">
        <span>{t("Temps moyen par contenu validé")}</span>
        <strong>{report.perApproved ? formatDuration(report.perApproved) : "—"}</strong>
        <small>{report.approvedTimed ? count(report.approvedTimed, "sur {n} contenu validé chronométré", "sur {n} contenus validés chronométrés") : t("Aucun contenu validé chronométré")}</small>
      </Surface>
      <Surface tone="default" className="report-stat">
        <span>{t("Délai de production")}</span>
        <strong>{report.cycleDays === null ? "—" : report.cycleDays < 1 ? formatDuration(report.cycleDays * 86_400_000) : t("{n} j", { n: decimal(report.cycleDays) })}</strong>
        <small>{t("Médiane, de la création à la validation")}</small>
      </Surface>
      <Surface tone="default" className="report-stat">
        <span>{t("Validés à temps")}</span>
        <strong>{report.onTimeShare === null ? "—" : percent(report.onTimeShare)}</strong>
        <small>{report.dated ? t("{a} sur {b} avec une échéance", { a: report.onTime, b: report.dated }) : t("Aucun contenu validé avec une échéance")}</small>
      </Surface>
    </div>

    {empty && <Surface tone="default" className="report-panel"><p className="report-empty">{t("Aucun temps ni validation sur la période. Le chrono démarre quand une tâche passe « En cours ».")}</p></Surface>}

    {!empty && <>
      <div className="report-grid wide">
        <Surface asChild tone="default"><section className="report-panel" aria-labelledby="report-tasks">
          <header><h2 id="report-tasks">{t("Temps par tâche")}</h2><p>{t("Sur la période, et au total depuis le début de la tâche.")}</p></header>
          {!report.tasks.length ? <p className="report-empty">{t("Aucun temps enregistré sur la période.")}</p> : <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th scope="col">{t("Tâche")}</th><th scope="col">{t("Qui")}</th><th scope="col">{t("Statut")}</th><th scope="col">{t("Période")}</th><th scope="col">{t("Total")}</th></tr></thead>
              <tbody>
                {shown.map(({ task, ms, totalMs, people }) => <tr key={task.id} tabIndex={0} onClick={() => onOpenTask(task.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpenTask(task.id); }}>
                  <th scope="row"><strong>{task.name}</strong><small>{clientName(task)}</small></th>
                  <td className="report-people">{people.join(", ")}</td>
                  <td><Chip status={task.status} /></td>
                  <td>{formatDuration(ms)}</td>
                  <td>{formatDuration(totalMs)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
          {report.tasks.length > taskRows && <button className="btn ghost report-more" onClick={() => setAllTasks(!allTasks)}>{allTasks ? t("Afficher moins") : t("Tout afficher ({n})", { n: report.tasks.length })}</button>}
        </section></Surface>

        <Surface asChild tone="default"><section className="report-panel" aria-labelledby="report-client-side">
          <header><h2 id="report-client-side">{t("Côté client")}</h2><p>{count(report.decided, "{n} décision sur la période", "{n} décisions sur la période")}</p></header>
          <dl className="report-facts">
            <div><dt>{t("Tours de retours par contenu")}</dt><dd>{report.rounds === null ? "—" : decimal(report.rounds)}</dd></div>
            <div><dt>{t("Délai de réponse du client")}</dt><dd>{report.clientHours === null ? "—" : formatDuration(report.clientHours * 3_600_000)}</dd></div>
            <div><dt>{t("Validés par silence")}</dt><dd>{report.silenceShare === null ? "—" : percent(report.silenceShare)}</dd></div>
            <div><dt>{t("Contenus validés")}</dt><dd>{report.approved}</dd></div>
          </dl>
        </section></Surface>
      </div>

      <div className="report-grid">
        {groupPanel(t("Temps par client"), report.clients, "report-clients")}
        <Surface asChild tone="default"><section className="report-panel" aria-labelledby="report-people">
          <header><h2 id="report-people">{t("Temps par personne")}</h2></header>
          {!report.people.length ? <p className="report-empty">{t("Rien sur la période.")}</p> : <ul className="report-bars">
            {report.people.map((p) => <li key={p.key}>
              <span className="report-bar-line"><span>{p.label}</span><strong>{formatDuration(p.ms)}</strong></span>
              <span className="report-bar" aria-hidden><span style={{ width: `${report.loggedMs ? Math.round((p.ms / report.loggedMs) * 100) : 0}%` }} /></span>
              <small>{count(p.tasks, "{n} tâche", "{n} tâches")}</small>
            </li>)}
          </ul>}
        </section></Surface>
        {groupPanel(t("Temps par format"), report.formats, "report-formats")}
      </div>
    </>}
  </div>;
}
