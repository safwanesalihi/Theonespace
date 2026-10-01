"use client";
import { formatTimestamp } from "@/lib/time";
// Demandes: what clients asked for from their portal (« Demander un contenu »), waiting for the studio.
// The owner or an admin reads each one and decides: « Créer la tâche » (prefilled from the request —
// title, sub-project, date, who does it) or « Refuser » with the reason the client will read. Nothing
// becomes a task on its own. Rules: the request actions in /api/records.
import { Surface } from "@/components/ui/surface";
import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, Inbox, Loader2, TriangleAlert, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DatePicker from "@/app/date-picker";
import ClientMark from "@/app/client-mark";
import { useI18n } from "@/app/locale-provider";
import { daysBetween, flow } from "@/lib/flow";
import type { RecordItem } from "@/lib/model";
import { memberName, type WorkspaceMember } from "@/lib/workspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the records API's reply, read for the new task's id only
type Mutate = (body: Record<string, unknown>) => Promise<any>;
type View = "new" | "accepted" | "declined";
type Accept = { request: RecordItem; name: string; projectId: string; due: string; assigneeId: string; description: string };

export default function RequestsInbox({ records, clients, members, today, busy, mutate, onNotice, onError, onOpenTask }: {
  records: RecordItem[]; clients: RecordItem[]; members: WorkspaceMember[]; today: string; busy: boolean;
  mutate: Mutate; onNotice: (text: string) => void; onError: (text: string) => void; onOpenTask: (id: string) => void;
}) {
  const { t, tag } = useI18n();
  const [view, setView] = useState<View>("new");
  const [client, setClient] = useState("");
  const [accepting, setAccepting] = useState<Accept | null>(null);
  const [declining, setDeclining] = useState<RecordItem | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const requests = useMemo(() => records.filter((r) => r.kind === "request"), [records]);
  const counts = { new: 0, accepted: 0, declined: 0 } as Record<View, number>;
  for (const r of requests) counts[r.requestStatus ?? "new"]++;
  const shown = requests
    .filter((r) => (r.requestStatus ?? "new") === view && (!client || r.clientId === client))
    .sort((a, b) => (view === "new" ? a.createdAt.localeCompare(b.createdAt) : (b.decision?.at ?? b.createdAt).localeCompare(a.decision?.at ?? a.createdAt)));
  const clientOf = (id?: string) => clients.find((c) => c.id === id);
  const team = members.filter((m) => m.role !== "client");
  const day = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(tag, { weekday: "short", day: "numeric", month: "short" }) : "");
  const when = (iso?: string) => (iso ? formatTimestamp(iso, tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "");

  function openAccept(r: RecordItem) {
    setFormError("");
    setAccepting({ request: r, name: r.name, projectId: r.projectId ?? "", due: r.due ?? "", assigneeId: "", description: r.description ?? "" });
  }
  async function accept() {
    if (!accepting) return;
    setSaving(true); setFormError("");
    try {
      const { request, ...data } = accepting;
      const reply = await mutate({ action: "request-accept", id: request.id, data });
      setAccepting(null);
      onNotice(t("Tâche créée. Le client voit que sa demande est acceptée."));
      if (reply?.id) onOpenTask(reply.id);
    } catch (e) { setFormError(t((e as Error).message)); }
    finally { setSaving(false); }
  }
  async function decline() {
    if (!declining) return;
    setSaving(true); setFormError("");
    try {
      await mutate({ action: "request-decline", id: declining.id, reason });
      setDeclining(null); setReason("");
      onNotice(t("Demande refusée. Le client lit votre explication dans son portail."));
    } catch (e) { setFormError(t((e as Error).message)); }
    finally { setSaving(false); }
  }

  return (
    <div className="requests-page">
      <div className="page-heading">
        <span className="page-symbol" aria-hidden="true"><Inbox size={22} /></span>
        <div className="heading-line"><h1>{t("Demandes")}</h1></div>
        <p>{t("Ce que vos clients demandent depuis leur portail. Rien ne devient une tâche sans vous : créez la tâche ou expliquez pourquoi ce n’est pas possible.")}</p>
      </div>
      <div className="requests-toolbar">
        <div className="requests-tabs" role="tablist" aria-label={t("Demandes")}>
          {(["new", "accepted", "declined"] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "selected" : ""} onClick={() => setView(v)}>
              {t(v === "new" ? "À traiter" : v === "accepted" ? "Acceptées" : "Refusées")}<span className="counter">{counts[v]}</span>
            </button>
          ))}
        </div>
        <Select value={client || "__all"} onValueChange={(v) => setClient(v === "__all" ? "" : v)}>
          <SelectTrigger className="pick" aria-label={t("Client")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("Tous les clients")}</SelectItem>
            {clients.filter((c) => !c.archived).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="requests-list">
        {!shown.length && (
          <div className="meetings-empty"><Inbox size={26} /><strong>{t(view === "new" ? "Aucune demande en attente" : "Rien ici pour le moment")}</strong>
            <p>{t(view === "new" ? "Quand un client envoie « Demander un contenu » depuis son portail, la demande arrive ici." : "Les demandes traitées apparaissent ici.")}</p></div>
        )}
        {shown.map((r) => {
          const c = clientOf(r.clientId);
          const project = records.find((p) => p.id === r.projectId);
          const soon = !!r.due && daysBetween(today, r.due) < flow.lockDays;
          return (
            <Surface asChild tone="default" key={r.id}><article className={`request-card ${r.requestStatus ?? "new"}`}>
              <header>
                <ClientMark name={c?.name ?? "?"} logo={c?.logo} size="md" />
                <div>
                  <strong>{r.name}</strong>
                  <small>{c?.name}{project ? ` · ${project.name}` : ""} · {t("demandé le {date} par {name}", { date: when(r.request?.at ?? r.createdAt), name: r.request?.by ?? "" })}</small>
                </div>
              </header>
              <div className="request-facts">
                {r.due && <span className={soon ? "warn" : ""}><CalendarDays size={14} />{t("Souhaité le {date}", { date: day(r.due) })}{soon && <><TriangleAlert size={13} />{t("moins de {n} jours", { n: flow.lockDays })}</>}</span>}
                {(r.platforms ?? []).map((p) => <span key={p} className="request-platform">{t(p)}</span>)}
              </div>
              {r.description && <p className="request-text">{r.description}</p>}
              {r.requestStatus === "declined" && r.decision?.reason && <p className="request-decision declined"><X size={14} />{t("Refusée par {name} le {date} : {reason}", { name: r.decision.by, date: when(r.decision.at), reason: r.decision.reason })}</p>}
              {r.requestStatus === "accepted" && <p className="request-decision accepted"><Check size={14} />{t("Acceptée par {name} le {date}", { name: r.decision?.by ?? "", date: when(r.decision?.at) })}</p>}
              <footer>
                {(r.requestStatus ?? "new") === "new" ? <>
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => { setFormError(""); setReason(""); setDeclining(r); }}>{t("Refuser")}</button>
                  <button type="button" className="btn primary" disabled={busy} onClick={() => openAccept(r)}><Check size={15} />{t("Créer la tâche")}</button>
                </> : r.taskId && records.some((x) => x.id === r.taskId) ? (
                  <button type="button" className="btn" onClick={() => onOpenTask(r.taskId!)}>{t("Voir la tâche")}<ArrowRight size={15} /></button>
                ) : null}
              </footer>
            </article></Surface>
          );
        })}
      </div>

      <Dialog open={!!accepting} onOpenChange={(open) => { if (!open && !saving) setAccepting(null); }}>
        <DialogContent className="tracker-modal">
          <DialogHeader>
            <DialogTitle>{t("Créer la tâche")}</DialogTitle>
            <DialogDescription>{t("Reprise de la demande de {client} : ajustez ce qu’il faut. Le client verra sa demande acceptée.", { client: clientOf(accepting?.request.clientId)?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          {accepting && <form className="form-fields" onSubmit={(e) => { e.preventDefault(); void accept(); }}>
            <label className="form-field"><span>{t("Titre")}</span><input required maxLength={160} value={accepting.name} onChange={(e) => setAccepting({ ...accepting, name: e.target.value })} /></label>
            <div className="form-pair">
              <label className="form-field"><span>{t("Sous-projet")}</span>
                <Select value={accepting.projectId || "__auto"} onValueChange={(v) => setAccepting({ ...accepting, projectId: v === "__auto" ? "" : v })}>
                  <SelectTrigger className="pick" aria-label={t("Sous-projet")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto">{t("« Demandes » (créé si besoin)")}</SelectItem>
                    {records.filter((p) => p.kind === "project" && p.clientId === accepting.request.clientId && !p.archived).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <div className="form-field"><span>{t("Date de publication")}</span><DatePicker label={t("Date de publication")} value={accepting.due} onChange={(v) => setAccepting({ ...accepting, due: v })} placeholder={t("Sans date")} /></div>
            </div>
            <label className="form-field"><span>{t("Assigné à")}</span>
              <Select value={accepting.assigneeId || "__none"} onValueChange={(v) => setAccepting({ ...accepting, assigneeId: v === "__none" ? "" : v })}>
                <SelectTrigger className="pick" aria-label={t("Assigné à")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("Personne pour l’instant")}</SelectItem>
                  {team.map((m) => <SelectItem key={m.userId} value={m.userId}>{memberName(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="form-field"><span>{t("Brief")}</span><textarea rows={5} maxLength={15000} value={accepting.description} onChange={(e) => setAccepting({ ...accepting, description: e.target.value })} />
              {!!accepting.request.platforms?.length && <small>{t("Les plateformes demandées ({list}) sont ajoutées au brief.", { list: accepting.request.platforms.map((p) => t(p)).join(", ") })}</small>}
            </label>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <DialogFooter className="modal-footer">
              <button type="button" className="btn" disabled={saving} onClick={() => setAccepting(null)}>{t("Annuler")}</button>
              <button className="btn primary" disabled={saving || !accepting.name.trim()}>{saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}{t("Créer la tâche")}</button>
            </DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!declining} onOpenChange={(open) => { if (!open && !saving) setDeclining(null); }}>
        <DialogContent className="tracker-modal">
          <DialogHeader>
            <DialogTitle>{t("Refuser la demande")}</DialogTitle>
            <DialogDescription>{t("« {name} » — le client lira votre explication dans son portail.", { name: declining?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <form className="form-fields" onSubmit={(e) => { e.preventDefault(); void decline(); }}>
            <label className="form-field"><span>{t("Motif (visible par le client)")}</span><textarea required rows={4} maxLength={2000} value={reason} placeholder={t("Hors forfait ce mois-ci, déjà prévu dans le plan, délai trop court…")} onChange={(e) => setReason(e.target.value)} /></label>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <DialogFooter className="modal-footer">
              <button type="button" className="btn" disabled={saving} onClick={() => setDeclining(null)}>{t("Annuler")}</button>
              <button className="btn primary danger" disabled={saving || !reason.trim()}>{saving ? <Loader2 size={15} className="spin" /> : null}{t("Refuser la demande")}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
