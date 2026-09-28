"use client";
// « Exporter PDF » of a Plan Éditorial: the month's map on paper, branch by branch — each content with
// its type, date, status and idea — then the notes, and the browser's print dialog (save as PDF). Read
// through the same API as the page (/api/content-plan?planId=), so a client only prints a shared plan.
import { useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { useMonthName } from "@/app/content-plan";
import { TypeIcon, type MapItem } from "@/app/content-plan-map";
import { itemTypeLabels, type Branch } from "@/lib/content-plan";

type Detail = { plan: { month: string; branches: Branch[]; notes: string }; items: MapItem[] };

export default function PlanPrint() {
  const { t, date } = useI18n();
  const monthName = useMonthName();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const plan = q.get("plan"), ws = q.get("ws");
    if (!plan || !ws) { queueMicrotask(() => setError("Plan introuvable.")); return; }
    fetch(`/api/content-plan?${new URLSearchParams({ planId: plan })}`, { headers: { "X-Workspace-Id": ws }, cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Chargement impossible."); return d as Detail; })
      .then((d) => { setDetail(d); setTimeout(() => window.print(), 400); })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <main className="cp-print"><p className="cp-warning">{t(error)}</p></main>;
  if (!detail) return <main className="cp-print"><Loader2 className="spin" /></main>;
  const { plan } = detail;
  const items = detail.items.filter((i) => !i.archived);
  const branches = [...plan.branches, ...(items.some((i) => !plan.branches.some((b) => b.id === i.planBranch)) ? [{ id: "__other", name: t("Sans branche") }] : [])];
  const of = (id: string) => items.filter((i) => (id === "__other" ? !plan.branches.some((b) => b.id === i.planBranch) : i.planBranch === id));
  const count = (type: MapItem["planType"]) => items.filter((i) => i.planType === type).length;
  return (
    <main className="cp-print">
      <header className="cp-print-head">
        <div>
          <small>{t("Plan Éditorial")}</small>
          <h1 className="cp-month">{monthName(plan.month)}</h1>
          <p>{t("{r} reels · {p} posts · {s} stories", { r: count("reel"), p: count("post"), s: count("story") })}</p>
        </div>
        <button type="button" className="btn primary no-print" onClick={() => window.print()}><Printer size={15} />{t("Imprimer / PDF")}</button>
      </header>
      <div className="cp-print-branches">
        {branches.map((b) => (
          <section key={b.id} className="cp-print-branch">
            <h2 dir="auto">{b.name} <small>{of(b.id).length}</small></h2>
            <ul>
              {of(b.id).map((i) => (
                <li key={i.id}>
                  <span className="mm-type"><TypeIcon type={i.planType} /></span>
                  <div>
                    <b dir="auto">{i.name}</b>
                    <small>{t(itemTypeLabels[i.planType])} · {i.due ? date(i.due, { weekday: "short", day: "numeric", month: "short" }) : t("Sans date")} · {t(i.status ?? "À faire")}</small>
                    {i.planContent && <p className="cp-print-text" dir="auto">{i.planContent}</p>}
                  </div>
                </li>
              ))}
              {!of(b.id).length && <li className="mm-empty">{t("Aucun contenu.")}</li>}
            </ul>
          </section>
        ))}
      </div>
      {plan.notes && <section><h2>{t("Notes du mois")}</h2><p className="cp-print-text" dir="auto">{plan.notes}</p></section>}
    </main>
  );
}
