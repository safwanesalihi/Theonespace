"use client";
// The client portal's « Plan éditorial »: the plans the studio shared, read-only, one table per month, and
// a comment thread on every item — the same task thread as the rest of the portal (/api/records « comment »),
// rendered by the portal itself (renderThread). Data: GET /api/content-plan (a client only gets shared plans).
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { monthLabel, type ContentPlan } from "@/lib/content-plan";
import type { PortalCopy } from "@/lib/portal-i18n";
import type { RecordItem } from "@/lib/model";

type Summary = { id: string; month: string; overview: string; counts: { reels: number; posts: number } };
type Item = { id: string; name: string; due?: string; planCode: string; planType: "reel" | "post"; planSerie: string; planFormat: string; planHook: string; planContent: string; planCta: string };
type Detail = { plan: Pick<ContentPlan, "id" | "month" | "overview" | "stories" | "questions" | "counts">; items: Item[] };

async function read<T>(workspaceId: string, query: Record<string, string>): Promise<T> {
  const r = await fetch(`/api/content-plan?${new URLSearchParams(query)}`, { headers: { "X-Workspace-Id": workspaceId }, cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Chargement impossible.");
  return data as T;
}

export default function PortalPlans({ workspaceId, clientId, copy, records, onError, renderThread }: {
  workspaceId: string; clientId: string; copy: PortalCopy; records: RecordItem[];
  onError: (text: string) => void; renderThread: (taskId: string) => React.ReactNode;
}) {
  const [plans, setPlans] = useState<Summary[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // A client gets only shared plans; the studio's preview gets everything, so it filters the same way.
    read<{ plans: (Summary & { shared?: boolean; archived?: boolean })[] }>(workspaceId, { clientId })
      .then((d) => { if (alive) setPlans(d.plans.filter((p) => p.shared !== false && !p.archived).sort((a, b) => b.month.localeCompare(a.month))); })
      .catch((e) => onError((e as Error).message));
    return () => { alive = false; };
  }, [workspaceId, clientId, onError]);
  useEffect(() => {
    if (!planId) return;
    let alive = true;
    read<Detail>(workspaceId, { planId }).then((d) => { if (alive) setDetail(d); }).catch((e) => onError((e as Error).message));
    return () => { alive = false; };
  }, [workspaceId, planId, onError]);

  const fmt = (iso?: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(copy.locale, { weekday: "short", day: "numeric", month: "short" }) : copy.noDate);
  const month = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(copy.locale, { month: "long", year: "numeric" }) || monthLabel(m);
  const comments = (id: string) => records.filter((r) => r.kind === "comment" && r.taskId === id).length;
  const heading = <div className="page-heading"><h1>{copy.plan}</h1><p>{copy.planText}</p></div>;

  if (!plans) return <>{heading}<div className="loading"><Loader2 className="spin" /></div></>;
  if (!planId) {
    return <>
      {heading}
      {!plans.length ? <div className="portal-empty"><h2>{copy.planEmpty}</h2><p>{copy.planEmptyText}</p></div> : (
        <ul className="cp-plan-list">
          {plans.map((p) => (
            <li key={p.id}><button type="button" onClick={() => { setDetail(null); setPlanId(p.id); }}><b>{month(p.month)}</b><span>{copy.planItems(p.counts.reels, p.counts.posts)}</span></button></li>
          ))}
        </ul>
      )}
    </>;
  }
  const opened = detail?.items.find((i) => i.id === open) ?? null;
  return <>
    <button type="button" className="text-link back" onClick={() => { setPlanId(null); setOpen(null); }}><ArrowLeft size={15} />{copy.planBack}</button>
    {!detail ? <div className="loading"><Loader2 className="spin" /></div> : <div className="cp-detail">
      <div className="page-heading"><h1 className="cp-month">{month(detail.plan.month)}</h1><p>{copy.planItems(detail.items.filter((i) => i.planType === "reel").length, detail.items.filter((i) => i.planType === "post").length)}</p></div>
      {detail.plan.overview && <section className="work-panel cp-overview"><h3>{copy.planMonthLogic}</h3><p className="cp-cell">{detail.plan.overview}</p></section>}
      <div className="database-card"><div className="table-area">
        <table className="cp-table portal">
          <thead><tr><th>{copy.colDate}</th><th>{copy.planColCode}</th><th>{copy.planColTitle}</th><th>{copy.planColHook}</th><th>{copy.planColContent}</th><th>{copy.planColCta}</th><th aria-label={copy.planComment} /></tr></thead>
          <tbody>{detail.items.map((it) => (
            <tr key={it.id}>
              <td>{fmt(it.due)}</td>
              <td><span className={`cp-code ${it.planType}`}>{it.planCode}</span></td>
              <td><b>{it.name}</b>{it.planSerie && <small>{it.planSerie}</small>}</td>
              <td dir="auto" className="cp-hook">{it.planHook}</td>
              <td dir="auto" className="cp-wide">{it.planContent}</td>
              <td dir="auto">{it.planCta}</td>
              <td className="cp-row-actions"><button type="button" className="icon-button" aria-label={copy.planComment} title={copy.planComment} onClick={() => setOpen(it.id)}><MessageCircle size={15} />{comments(it.id) ? <small>{comments(it.id)}</small> : null}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div></div>
      {!!detail.plan.stories.length && <section className="work-panel cp-section"><h3>{copy.planStories}</h3>
        <ul className="cp-list">{detail.plan.stories.map((s, i) => <li key={i} dir="auto">{s.time && <b>{s.time} · </b>}{s.name}</li>)}</ul></section>}
      {!!detail.plan.questions.length && <section className="work-panel cp-section"><h3>{copy.planQuestions}</h3>
        <ul className="cp-checklist">{detail.plan.questions.map((q, i) => <li key={i}><label><input type="checkbox" checked={q.done} readOnly disabled /><span className={q.done ? "done" : ""}>{q.text}</span></label></li>)}</ul></section>}
    </div>}
    <Dialog open={!!opened} onOpenChange={(o) => { if (!o) setOpen(null); }}>
      <DialogContent className="tracker-modal cp-item-dialog" dir={copy.dir}>
        {opened && <>
          <DialogHeader><DialogTitle>{opened.name}</DialogTitle><DialogDescription>{fmt(opened.due)}{opened.planFormat ? ` · ${opened.planFormat}` : ""}</DialogDescription></DialogHeader>
          <dl className="cp-item-fields">
            <div><dt>{copy.planColHook}</dt><dd dir="auto">{opened.planHook}</dd></div>
            <div><dt>{copy.planColCta}</dt><dd dir="auto">{opened.planCta}</dd></div>
            <div><dt>{copy.planColContent}</dt><dd dir="auto">{opened.planContent}</dd></div>
          </dl>
          <div className="cp-thread">{renderThread(opened.id)}</div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
