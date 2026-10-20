"use client";
// The client's shooting sessions on the portal's home (lib/shoots.ts): when, where, who comes and what to
// prepare; the client confirms each one or asks for another date. Hidden when there is none to come.
import { Surface } from "@/components/ui/surface";
import { useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, MapPin, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientShoot, shootLists } from "@/lib/shoots";
import type { PortalContext } from "./use-portal";

export function PortalShoots({ ctx }: { ctx: PortalContext }) {
  const { records, client, today, t, fmt, mutate, mode, onNotice, onError } = ctx;
  // The studio's preview holds every client's shoots: keep this client's, as the client receives them.
  const own = records.filter((r) => r.kind === "shoot" && r.clientId === client.id && !r.archived).map(clientShoot);
  const { coming } = shootLists(own, today);
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!coming.length) return null;
  const preview = mode !== "client";

  async function answer(id: string, decision: "confirm" | "reschedule", text = "") {
    setBusy(true);
    try {
      await mutate({ action: "shoot-answer", id, decision, ...(text ? { note: text } : {}) });
      setAsking(null); setNote("");
      onNotice(t(decision === "confirm" ? "Shooting confirmé · merci !" : "Demande envoyée au studio"));
    } catch (error) { onError(t((error as Error).message)); }
    finally { setBusy(false); }
  }

  return <Surface asChild tone="default"><section className="portal-shoots" aria-labelledby="portal-shoots-title">
    <header><h2 id="portal-shoots-title"><Camera size={18} />{t("Vos shootings")}</h2></header>
    <div className="portal-shoot-list">
      {coming.map((s) => <article key={s.id} className="portal-shoot">
        <span className="shoot-date"><strong>{Number((s.due ?? today).slice(8))}</strong><small>{fmt(s.due ?? today).split(" ").slice(1, 2).join(" ")}</small></span>
        <div className="portal-shoot-main">
          <strong>{s.name}</strong>
          <small>{fmt(s.due ?? today)} · {s.time}{s.location ? <> · <MapPin size={12} /> {s.location}</> : null}</small>
          {!!s.attendeeNames?.length && <small><Users size={12} /> {s.attendeeNames.join(", ")}</small>}
          {s.description && <p dir="auto">{s.description}</p>}
        </div>
        <div className="portal-shoot-actions">
          {s.clientDecision?.state === "confirmed"
            ? <span className="shoot-chip ok"><CheckCircle2 size={12} />{t("Confirmé")}</span>
            : s.clientDecision?.state === "reschedule"
              ? <span className="shoot-chip warn"><AlertTriangle size={12} />{t("Autre date demandée")}</span>
              : <>
                <button className="btn" disabled={busy || preview} onClick={() => { setNote(""); setAsking(s.id); }}>{t("Autre date")}</button>
                <button className="btn primary" disabled={busy || preview} onClick={() => void answer(s.id, "confirm")}><CheckCircle2 size={15} />{t("Confirmer")}</button>
              </>}
        </div>
      </article>)}
    </div>
    <Dialog open={!!asking} onOpenChange={(o) => { if (!o && !busy) setAsking(null); }}>
      <DialogContent className="tracker-modal">
        <DialogHeader>
          <DialogTitle>{t("Proposer une autre date")}</DialogTitle>
          <DialogDescription>{t("Dites au studio ce qui ne convient pas et quand vous êtes disponible.")}</DialogDescription>
        </DialogHeader>
        <form className="form-fields" onSubmit={(e) => { e.preventDefault(); if (asking && note.trim()) void answer(asking, "reschedule", note.trim()); }}>
          <label className="form-field"><span>{t("Votre message")}</span><textarea autoFocus required rows={4} maxLength={1000} value={note} placeholder={t("Plutôt le samedi matin, ou la semaine suivante…")} onChange={(e) => setNote(e.target.value)} /></label>
          <DialogFooter className="modal-footer">
            <button type="button" className="btn" disabled={busy} onClick={() => setAsking(null)}>{t("Annuler")}</button>
            <button className="btn primary" disabled={busy || !note.trim()}>{t("Envoyer")}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section></Surface>;
}
