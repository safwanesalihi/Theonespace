"use client";
// The CRM's analysis (lib/crm.ts crmInsights): over the prospects that arrived in the period, how many of
// the closed ones were won, what a won client is worth each month, which sources bring clients, and why
// the others were lost. Read-only; the board is where prospects move.
import { Surface } from "@/components/ui/surface";
import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/locale-provider";
import { crmInsights, insightPeriods, type InsightPeriod } from "@/lib/crm";
import type { RecordItem } from "@/lib/model";
import { CountUp } from "@/features/dashboard/flow-pipeline";

const periodLabels: Record<InsightPeriod, string> = { quarter: "90 derniers jours", year: "12 derniers mois", all: "Depuis le début" };

export default function CrmInsights({ prospects, today }: { prospects: RecordItem[]; today: string }) {
  const { t, tag } = useI18n();
  const [period, setPeriod] = useState<InsightPeriod>("year");
  const insights = useMemo(() => crmInsights(prospects, today, period), [prospects, today, period]);
  const percent = (rate: number) => new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 }).format(rate);
  const money = (n: number) => `${n.toLocaleString(tag)} MAD`;
  const day = (iso: string) => new Date(iso).toLocaleDateString(tag, { day: "numeric", month: "short" });

  return <div className="crm-insights">
    <div className="crm-insights-head">
      <p>{t("Les chiffres portent sur les prospects arrivés sur la période.")}</p>
      <Select value={period} onValueChange={(v) => setPeriod(v as InsightPeriod)}>
        <SelectTrigger className="pick crm-period" aria-label={t("Période")}><SelectValue /></SelectTrigger>
        <SelectContent>{(Object.keys(insightPeriods) as InsightPeriod[]).map((p) => <SelectItem key={p} value={p}>{t(periodLabels[p])}</SelectItem>)}</SelectContent>
      </Select>
    </div>

    <div className="crm-summary">
      <Surface tone="default" className="crm-stat">
        <span>{t("Taux de conversion")}</span>
        <strong>{insights.winRate === null ? "—" : percent(insights.winRate)}</strong>
        <small>{insights.closed ? t("{won} gagnés sur {closed} clos", { won: insights.won, closed: insights.closed }) : t("Aucun prospect clos sur la période")}</small>
      </Surface>
      <Surface tone="default" className="crm-stat">
        <span>{t("Valeur moyenne d’un client gagné")}</span>
        <strong>{insights.averageDeal === null ? "—" : <><CountUp value={insights.averageDeal} format={(n) => n.toLocaleString(tag)} /> <small>MAD{t("/mois")}</small></>}</strong>
        <small>{t("Valeur mensuelle estimée des prospects gagnés")}</small>
      </Surface>
      <Surface tone="default" className="crm-stat">
        <span>{t("Revenu mensuel gagné")}</span>
        <strong><CountUp value={insights.wonValue} format={(n) => n.toLocaleString(tag)} /> <small>MAD</small></strong>
        <small>{t("{n} clients gagnés · {open} prospects encore ouverts", { n: insights.won, open: insights.open })}</small>
      </Surface>
    </div>

    {!insights.prospects ? <Surface tone="default" className="crm-panel"><p className="crm-empty">{t("Aucun prospect arrivé sur cette période.")}</p></Surface> : <div className="crm-insight-grid">
      <Surface asChild tone="default"><section className="crm-panel" aria-labelledby="crm-sources-title">
        <header><h2 id="crm-sources-title">{t("Sources qui rapportent")}</h2><p>{t("D’où viennent vos prospects, et lesquels deviennent des clients.")}</p></header>
        <div className="crm-table-wrap">
          <table className="crm-sources">
            <thead><tr><th scope="col">{t("Source")}</th><th scope="col">{t("Prospects")}</th><th scope="col">{t("Gagnés")}</th><th scope="col">{t("Conversion")}</th><th scope="col">{t("Valeur gagnée")}</th></tr></thead>
            <tbody>
              {insights.sources.map((s) => <tr key={s.source || "__none"}>
                <th scope="row">{s.source ? t(s.source) : t("Non précisée")}</th>
                <td>{s.prospects}</td>
                <td>{s.won}</td>
                <td>{s.winRate === null ? <span className="crm-muted">{t("Aucun clos")}</span>
                  : <span className="crm-rate"><span className="crm-bar won" aria-hidden><span style={{ width: `${Math.round(s.winRate * 100)}%` }} /></span>{percent(s.winRate)}</span>}</td>
                <td>{s.wonValue ? money(s.wonValue) : "—"}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section></Surface>

      <Surface asChild tone="default"><section className="crm-panel" aria-labelledby="crm-lost-title">
        <header><h2 id="crm-lost-title">{t("Pourquoi les prospects sont perdus")}</h2><p>{t("La raison choisie quand un prospect passe en « Perdu ».")}</p></header>
        {!insights.lost ? <p className="crm-empty">{t("Aucun prospect perdu sur la période.")}</p> : <>
          <ul className="crm-reasons">
            {insights.lostReasons.map((r) => <li key={r.reason || "__none"}>
              <span className="crm-reason-line"><span>{r.reason ? t(r.reason) : t("Non précisée")}</span><small>{r.count} · {percent(r.share)}</small></span>
              <span className="crm-bar lost" aria-hidden><span style={{ width: `${Math.round(r.share * 100)}%` }} /></span>
            </li>)}
          </ul>
          <h3>{t("Derniers perdus")}</h3>
          <ul className="crm-recent-lost">
            {insights.recentLost.map((p) => <li key={p.id}>
              <strong>{p.name}</strong>
              <small>{[p.lostReason ? t(p.lostReason) : t("Non précisée"), p.closedAt ? day(p.closedAt) : ""].filter(Boolean).join(" · ")}</small>
              {p.lostNote && <p dir="auto">{p.lostNote}</p>}
            </li>)}
          </ul>
        </>}
      </section></Surface>
    </div>}
  </div>;
}
