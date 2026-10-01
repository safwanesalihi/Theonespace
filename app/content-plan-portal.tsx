"use client";
// The client portal's « Plan éditorial »: the months the studio shared, each one the same mind map as in
// the studio, read-only, and a comment thread on every node — the portal's usual task thread
// (/api/records « comment »), rendered by the portal itself (renderThread). Data: GET /api/content-plan
// (a client only gets shared plans).
import { Surface } from "@/components/ui/surface";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Branch } from "@/lib/content-plan";
import type { PortalCopy } from "@/lib/portal-i18n";
import type { RecordItem } from "@/lib/model";
import MindMap, { type MapItem } from "@/app/content-plan-map";

type Summary = { id: string; month: string; shared?: boolean; archived?: boolean; items: number };
type Detail = { plan: { id: string; month: string; branches: Branch[]; notes: string }; items: MapItem[] };

async function read<T>(workspaceId: string, query: Record<string, string>): Promise<T> {
  const r = await fetch(`/api/content-plan?${new URLSearchParams(query)}`, { headers: { "X-Workspace-Id": workspaceId }, cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Chargement impossible.");
  return data as T;
}

export default function PortalPlans({ workspaceId, clientId, copy, records, onError, renderThread, initialItemId }: {
  workspaceId: string; clientId: string; copy: PortalCopy; records: RecordItem[];
  onError: (text: string) => void; renderThread: (taskId: string) => React.ReactNode;
  initialItemId?: string;
}) {
  const initialItem = records.find(r => r.kind === 'plan_item' && r.id === initialItemId && r.clientId === clientId);
  const [plans, setPlans] = useState<Summary[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(initialItem?.planId ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [open, setOpen] = useState<string | null>(initialItem?.id ?? null);

  useEffect(() => {
    let alive = true;
    // A client gets only shared plans; the studio's preview gets everything, so it filters the same way.
    read<{ plans: Summary[] }>(workspaceId, { clientId })
      .then((d) => {
        if (!alive) return;
        const shown = d.plans.filter((p) => p.shared !== false && !p.archived).sort((a, b) => b.month.localeCompare(a.month));
        setPlans(shown);
        // The client lands on the newest shared month, in full.
        if (shown.length) setPlanId((id) => id ?? shown[0].id);
      })
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
  const month = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(copy.locale, { month: "long", year: "numeric" });
  const comments = (id: string) => records.filter((r) => r.kind === "comment" && r.taskId === id).length;
  const heading = <div className="page-heading"><h1>{copy.plan}</h1><p>{copy.planText}</p></div>;

  if (!plans) return <>{heading}<div className="loading"><Loader2 className="spin" /></div></>;
  if (!planId) {
    return <>
      {heading}
      {!plans.length ? <div className="portal-empty"><h2>{copy.planEmpty}</h2><p>{copy.planEmptyText}</p></div> : (
        <ul className="cp-plan-list">
          {plans.map((p) => (
            <li key={p.id}><button type="button" onClick={() => { setDetail(null); setPlanId(p.id); }}><b>{month(p.month)}</b><span>{copy.planItems(p.items)}</span></button></li>
          ))}
        </ul>
      )}
    </>;
  }
  const opened = detail?.items.find((i) => i.id === open) ?? null;
  const pick = (id: string) => { if (id !== planId) { setDetail(null); setOpen(null); setPlanId(id); } };
  return <>
    {!detail ? <div className="loading"><Loader2 className="spin" /></div> : <div className="cp-detail">
      <div className="page-heading">
        <div className="heading-line">
          <h1 className="cp-month">{copy.plan} · {month(detail.plan.month)}</h1>
          {plans.length > 1 && (
            <select className="cp-month-pick" value={planId} onChange={(e) => pick(e.target.value)} aria-label={copy.planBack}>
              {plans.map((p) => <option key={p.id} value={p.id}>{month(p.month)}</option>)}
            </select>
          )}
        </div>
        <p>{copy.planHint}</p>
      </div>
      <MindMap title={month(detail.plan.month)} branches={detail.plan.branches} items={detail.items} editable={false} comments={comments} onOpen={(i) => setOpen(i.id)} />
      {detail.plan.notes && <Surface asChild tone="default"><section className="work-panel cp-notes"><h3>{copy.planNotes}</h3><p className="cp-print-text" dir="auto">{detail.plan.notes}</p></section></Surface>}
    </div>}
    <Dialog open={!!opened} onOpenChange={(o) => { if (!o) setOpen(null); }}>
      <DialogContent className="tracker-modal cp-item-dialog" dir={copy.dir}>
        {opened && <>
          <DialogHeader><DialogTitle dir="auto">{opened.name}</DialogTitle><DialogDescription>{fmt(opened.due)}</DialogDescription></DialogHeader>
          {opened.planContent && <p className="cp-print-text" dir="auto">{opened.planContent}</p>}
          <div className="cp-thread">{renderThread(opened.id)}</div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
