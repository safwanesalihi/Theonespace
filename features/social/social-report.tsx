"use client";
import { formatTimestamp } from "@/lib/time";
// The Social report (lib/social-report.ts) on screen: for a period and a client (or all of them), what
// went out, what it reached and earned, week by week, per network, the best posts, and the audience's
// growth. The studio refreshes the numbers and exports them; a client sees their own in the portal.
// Printing the page (« Imprimer / PDF ») gives the client-ready report.
import { Surface } from "@/components/ui/surface";
import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2, Printer, RefreshCw, TriangleAlert } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendArea } from "@/features/dashboard/dashboard-charts";
import NetworkIcon from "@/components/network-icon";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem } from "@/lib/model";
import { networkLabels } from "@/lib/social";
import { periodFor, periodLabels, reportCsv, socialReport, type FollowerHistory, type PeriodKey } from "@/lib/social-report";

export default function SocialReportView({
  records, clients, workspaceId, today, fixedClientId, canRefresh, onNotice, onError,
}: {
  records: RecordItem[];
  clients: RecordItem[];
  workspaceId: string;
  today: string;
  /** The client the report is locked to (a client's portal, a client's Social tab). */
  fixedClientId?: string;
  /** The studio refreshes and exports; a client only reads. */
  canRefresh: boolean;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const { t, tag } = useI18n();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("30");
  const [clientFilter, setClientFilter] = useState("");
  const [histories, setHistories] = useState<FollowerHistory[]>([]);
  const [busy, setBusy] = useState(false);
  const clientId = fixedClientId || clientFilter || undefined;
  const period = periodFor(periodKey, today);
  const report = useMemo(() => socialReport(records, histories, period, { clientId, locale: tag }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- period derives from periodKey and today
    [records, histories, periodKey, today, clientId, tag]);
  const clientName = (id?: string) => (id === "internal" ? t("Agence") : clients.find((c) => c.id === id)?.name || "");

  useEffect(() => {
    let live = true;
    fetch(`/api/social/insights${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`, { headers: { "X-Workspace-Id": workspaceId }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { histories: [] }))
      .then((d: { histories?: FollowerHistory[] }) => { if (live) setHistories(d.histories ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, [workspaceId, clientId]);

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/social/insights", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Id": workspaceId }, body: JSON.stringify({ clientId: clientId || "" }),
      });
      const data = (await response.json().catch(() => ({}))) as { posts?: number; failed?: number; histories?: FollowerHistory[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Actualisation impossible. Réessayez.");
      setHistories(data.histories ?? []);
      onNotice(t("{n} publications mesurées.", { n: data.posts ?? 0 }) + (data.failed ? ` ${t("{n} à revoir.", { n: data.failed })}` : ""));
      // The posts' numbers arrive with the page's next refresh of the workspace (a few seconds).
    } catch (e) { onError(t((e as Error).message)); }
    finally { setBusy(false); }
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([reportCsv(records, period, clientName, clientId)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `rapport-social-${clientId ? clientName(clientId).replace(/\W+/g, "-").toLowerCase() + "-" : ""}${period.from}_${period.to}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString(tag));
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString(tag, { maximumFractionDigits: 1 })} %`);
  const delta = (v: number | null) => (v === null || v === 0 ? "" : `${v > 0 ? "+" : ""}${v.toLocaleString(tag)}`);
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" });
  const tiles: [string, string, string?][] = [
    [t("Publications"), n(report.totals.posts)],
    [t("Portée et vues"), n(report.totals.reach + report.totals.views)],
    [t("Interactions"), n(report.totals.interactions), t("J’aime, commentaires, partages, enregistrements")],
    [t("Taux d’engagement"), pct(report.totals.engagement), t("Interactions ÷ portée")],
    [t("Abonnés"), n(report.totals.followers), delta(report.totals.followersDelta) && t("{delta} sur la période", { delta: delta(report.totals.followersDelta) })],
  ];

  return (
    <div className="social-report">
      <div className="social-report-toolbar no-print">
        <div className="social-report-periods" role="group" aria-label={t("Période")}>
          {(Object.keys(periodLabels) as PeriodKey[]).map((key) => (
            <button key={key} type="button" className={periodKey === key ? "selected" : ""} aria-pressed={periodKey === key} onClick={() => setPeriodKey(key)}>{t(periodLabels[key])}</button>
          ))}
        </div>
        {!fixedClientId && (
          <Select value={clientFilter || "__all"} onValueChange={(v) => setClientFilter(v === "__all" ? "" : v)}>
            <SelectTrigger className="pick social-report-client" aria-label={t("Client")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("Tous les clients")}</SelectItem>
              <SelectItem value="internal">{t("Agence")}</SelectItem>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <span className="grow" />
        {canRefresh && (
          <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
            {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}{t("Actualiser les statistiques")}
          </button>
        )}
        {canRefresh && <button type="button" className="btn" onClick={exportCsv}><Download size={15} />{t("Exporter CSV")}</button>}
        <button type="button" className="btn" onClick={() => window.print()}><Printer size={15} />{t("Imprimer / PDF")}</button>
      </div>

      <header className="social-report-head">
        <h2>{t("Rapport social")}{clientId ? ` — ${clientName(clientId)}` : ""}</h2>
        <p>{day(period.from)} → {day(period.to)}{report.measuredAt ? ` · ${t("Mesuré le {date}", { date: formatTimestamp(report.measuredAt, tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })}` : ""}</p>
      </header>

      <div className="social-report-tiles">
        {tiles.map(([label, value, detail]) => (
          <Surface asChild tone="default" key={label}><div className="metric-card social-report-tile">
            <span>{label}</span>
            <strong>{value}</strong>
            {detail && <small>{detail}</small>}
          </div></Surface>
        ))}
      </div>

      {!report.totals.posts && !report.byNetwork.length ? (
        <p className="social-report-empty">{t("Aucune publication sur cette période. Les statistiques apparaissent une fois les publications parties et mesurées.")}</p>
      ) : (
        <>
          <Surface asChild tone="default"><section className="work-panel social-report-panel">
            <h3>{t("Interactions par semaine")}</h3>
            <TrendArea data={report.weekly.map((w) => ({ x: w.label, y: w.interactions }))} height={190} />
          </section></Surface>

          <Surface asChild tone="default"><section className="work-panel social-report-panel">
            <h3>{t("Par réseau")}</h3>
            <div className="social-report-table">
              <div className="social-report-row head">
                <span>{t("Réseau")}</span><span>{t("Publications")}</span><span>{t("Vues")}</span><span>{t("Portée")}</span><span>{t("Interactions")}</span><span>{t("Engagement")}</span><span>{t("Abonnés")}</span>
              </div>
              {report.byNetwork.map((row) => (
                <div key={row.network} className="social-report-row">
                  <span className="social-report-network"><NetworkIcon network={row.network} size={15} badge />{networkLabels[row.network]}</span>
                  <span>{n(row.posts)}</span><span>{n(row.views || null)}</span><span>{n(row.reach || null)}</span><span>{n(row.interactions)}</span><span>{pct(row.engagement)}</span>
                  <span>{n(row.followers)} {delta(row.followersDelta) && <small className={row.followersDelta! > 0 ? "up" : "down"}>{delta(row.followersDelta)}</small>}</span>
                </div>
              ))}
            </div>
          </section></Surface>

          {!!report.top.length && (
            <Surface asChild tone="default"><section className="work-panel social-report-panel">
              <h3>{t("Meilleures publications")}</h3>
              <ol className="social-report-top">
                {report.top.map((p) => (
                  <li key={`${p.postId}-${p.network}`}>
                    <NetworkIcon network={p.network} size={15} badge />
                    <div>
                      <strong>{p.name}</strong>
                      <small>{day(p.day)}{p.caption ? ` · ${p.caption}` : ""}</small>
                    </div>
                    <span className="social-report-figures">
                      <b>{n(p.interactions)}</b> {t("interactions")}
                      {(p.reach || p.views) ? <> · {n(p.reach || p.views)} {t(p.reach ? "portée" : "vues")}</> : null}
                      {p.engagement !== null && <> · {pct(p.engagement)}</>}
                    </span>
                    {p.url && <a className="icon-button no-print" href={p.url} target="_blank" rel="noopener noreferrer" aria-label={t("Voir la publication")}><ExternalLink size={14} /></a>}
                  </li>
                ))}
              </ol>
            </section></Surface>
          )}

          {canRefresh && !!report.unread.length && (
            <details className="social-report-unread no-print">
              <summary><TriangleAlert size={14} />{t("{n} publications sans statistiques", { n: report.unread.length })}</summary>
              <ul>{report.unread.slice(0, 20).map((u, i) => <li key={i}>{networkLabels[u.network]} · {u.name} — {t(u.error)}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
