"use client";
// « Exporter PDF » of a Plan Éditorial: the whole month on paper — overview, every reel and post, stories,
// production and the checklist — then the browser's print dialog (save as PDF). Read through the same
// API as the page (/api/content-plan?planId=), so a client only ever prints a plan shared with them.
import { useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { useMonthName } from "@/app/content-plan";
import { weekdayLabels, weekdays, type ContentPlan, type PlanItemFields } from "@/lib/content-plan";

type Item = PlanItemFields & { id: string; name: string; due?: string };
type Detail = { plan: ContentPlan; items: Item[] };

const daysText = (days: number[], t: (s: string) => string) =>
  days.length === 7 ? t("Tous les jours") : weekdays.filter((d) => days.includes(d)).map((d) => t(weekdayLabels[d])).join(" · ");

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
  const { plan, items } = detail;
  const day = (iso?: string) => (iso ? date(iso, { weekday: "short", day: "numeric", month: "short" }) : "—");
  return (
    <main className="cp-print">
      <header className="cp-print-head">
        <div>
          <small>{t("Plan Éditorial")}</small>
          <h1>{monthName(plan.month)}</h1>
          <p>{t("{r}/{rq} reels · {p}/{pq} posts", { r: items.filter((i) => i.planType === "reel").length, rq: plan.quotas.reels, p: items.filter((i) => i.planType === "post").length, pq: plan.quotas.posts })}{plan.focus ? ` · ${plan.focus}` : ""}</p>
        </div>
        <button type="button" className="btn primary no-print" onClick={() => window.print()}><Printer size={15} />{t("Imprimer / PDF")}</button>
      </header>
      {plan.overview && <section><h2>{t("Logique du mois")}</h2><p className="cp-print-text">{plan.overview}</p></section>}
      <section>
        <h2>{t("Calendrier")}</h2>
        <table className="cp-simple cp-print-table">
          <thead><tr><th>{t("Date")}</th><th>{t("Code")}</th><th>{t("Titre")}</th><th>{t("Hook")}</th><th>{t("Contenu")}</th><th>{t("CTA")}</th><th>{t("Personnes")}</th><th>{t("Tournage")}</th></tr></thead>
          <tbody>{items.map((it) => (
            <tr key={it.id}>
              <td>{day(it.due)}</td>
              <td><span className={`cp-code ${it.planType}`}>{it.planCode}</span></td>
              <td><b>{it.name}</b>{it.planSerie && <><br /><small>{it.planSerie}</small></>}{it.planFormat && <><br /><small>{it.planFormat}</small></>}</td>
              <td dir="auto">{it.planHook}</td>
              <td dir="auto" className="cp-print-text">{it.planContent}</td>
              <td dir="auto">{it.planCta}</td>
              <td>{(it.planPeople ?? []).join(", ")}</td>
              <td>{it.planShoot}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      {!!plan.stories?.length && <section>
        <h2>{t("Stories")}</h2>
        <table className="cp-simple"><tbody>{plan.stories.map((s, i) => <tr key={i}><td>{s.time || "—"}</td><td dir="auto"><b>{s.name}</b></td><td>{daysText(s.days, t)}</td><td>{s.note}</td></tr>)}</tbody></table>
        {!!plan.specialStories?.length && <ul className="cp-list">{plan.specialStories.map((s, i) => <li key={i}><b>{day(s.date)}</b> · {s.name}{s.note ? ` — ${s.note}` : ""}</li>)}</ul>}
      </section>}
      {!!plan.production?.length && <section>
        <h2>{t("Production")}</h2>
        <table className="cp-simple"><tbody>{plan.production.map((r, i) => <tr key={i}><td><b>{r.step}</b></td><td>{day(r.date)}</td><td className="cp-print-text">{r.content}</td></tr>)}</tbody></table>
      </section>}
      {!!plan.questions?.length && <section>
        <h2>{t("À valider avec le client")}</h2>
        <ul className="cp-checklist">{plan.questions.map((q, i) => <li key={i}><label><input type="checkbox" checked={q.done} readOnly />{q.text}</label></li>)}</ul>
      </section>}
    </main>
  );
}
