"use client";
// « Plateforme » (The One Core's owner only, /api/platform): running the SaaS. Four tabs — the business at a
// glance (platform-overview.tsx), the companies and what to do for each (platform-agencies.tsx), the public
// site's key information (platform-site.tsx), and the log of every change with the production errors
// (platform-journal.tsx). The companies and errors are loaded once here and shared by the tabs.
import { useCallback, useEffect, useState } from "react";
import { Building2, Globe, LayoutDashboard, RefreshCw, ScrollText } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import PlatformAgencies from "./platform-agencies";
import PlatformJournal from "./platform-journal";
import PlatformOverview from "./platform-overview";
import PlatformSite from "./platform-site";
import type { Company, ErrorEntry } from "./platform-types";
import "./platform.css";

type Tab = "overview" | "agencies" | "site" | "journal";
const tabs: [Tab, string, typeof Globe][] = [["overview", "Vue d’ensemble", LayoutDashboard], ["agencies", "Agences", Building2], ["site", "Site", Globe], ["journal", "Journal", ScrollText]];

export default function PlatformPage({ onNotice, onError }: { onNotice: (text: string) => void; onError: (text: string) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("overview");
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [errors, setErrors] = useState<ErrorEntry[] | null>(null);
  const [focus, setFocus] = useState({ query: "", key: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [list, failures] = await Promise.all([
      fetch("/api/platform", { cache: "no-store" }).then(async (r) => { const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || "Chargement impossible."); return data.companies as Company[]; }),
      fetch("/api/platform?errors", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { errors: null })).then((data) => data.errors as ErrorEntry[] | null).catch(() => null),
    ]);
    return { list, failures };
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    try { const { list, failures } = await load(); setCompanies(list); if (failures) setErrors(failures); }
    catch (e) { onError(t((e as Error).message)); }
    setRefreshing(false);
  };
  useEffect(() => {
    let alive = true;
    void load().then(({ list, failures }) => { if (!alive) return; setCompanies(list); if (failures) setErrors(failures); })
      .catch((e) => { if (alive) onError(t((e as Error).message)); });
    return () => { alive = false; };
  }, [load, onError, t]);

  const attention = companies?.filter((c) => c.subscription.requestedPlan || c.state.phase === "grace").length ?? 0;

  return (
    <div className="platform-page">
      <div className="page-heading pf-heading">
        <span className="page-symbol"><Building2 size={20} /></span>
        <div className="heading-line">
          <h1>{t("Plateforme")}</h1>
          <button type="button" className="btn" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={14} className={refreshing ? "spin" : ""} />{t("Actualiser")}</button>
        </div>
        <p>{t("Piloter The One Space : les agences inscrites, l’argent, les coûts, et ce que dit le site public.")}</p>
      </div>

      <div className="pf-tabs" role="tablist" aria-label={t("Plateforme")}>
        {tabs.map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" id={`pf-tab-${id}`} aria-selected={tab === id} aria-controls={`pf-panel-${id}`} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            <Icon size={15} aria-hidden />{t(label)}
            {id === "agencies" && attention > 0 && <span className="pf-badge" aria-label={t("{n} à traiter", { n: attention })}>{attention}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`pf-panel-${tab}`} aria-labelledby={`pf-tab-${tab}`}>
        {tab === "overview" && <PlatformOverview companies={companies} errors={errors} onOpen={(name) => { setFocus({ query: name, key: focus.key + 1 }); setTab("agencies"); }} />}
        {tab === "agencies" && <PlatformAgencies key={focus.key} companies={companies} initialQuery={focus.query} onCompanies={setCompanies} onNotice={onNotice} onError={onError} />}
        {tab === "site" && <PlatformSite onNotice={onNotice} onError={onError} />}
        {tab === "journal" && <PlatformJournal errors={errors} onError={onError} />}
      </div>
    </div>
  );
}
