"use client";
// Shootings: the studio's calendar of photo and video shoots, internal (in-house, or for the agency) and
// external (for a client, usually on location), each with its crew. The owner, admins and social media
// managers plan them; a team member sees the ones they shoot; the client confirms theirs in the portal.
// Rules: lib/shoots.ts; actions: features/records/server/actions/shoots.ts.
import { Surface } from "@/components/ui/surface";
import TimeField from "@/components/time-field";
import DatePicker from "@/components/date-picker";
import { useMemo, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Users, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/locale-provider";
import { shiftDay } from "@/lib/flow";
import type { RecordItem } from "@/lib/model";
import { canPlanShoots, crewConflicts, shootDurations, shootLists, shootPhase, type ShootType } from "@/lib/shoots";
import { memberName, type WorkspaceMember, type WorkspaceRole } from "@/lib/workspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the records API's reply, read for the id and the crew conflicts
type Mutate = (body: Record<string, unknown>) => Promise<any>;
type Form = { name: string; shootType: ShootType; clientId: string; due: string; time: string; duration: number; location: string; attendees: string[]; externalCrew: string; description: string };
const blank = (day: string): Form => ({ name: "", shootType: "external", clientId: "", due: day, time: "09:00", duration: 180, location: "", attendees: [], externalCrew: "", description: "" });

export default function ShootsPage({ records, clients, members, userId, role, today, busy, mutate, onNotice, onError }: {
  records: RecordItem[]; clients: RecordItem[]; members: WorkspaceMember[]; userId: string; role: WorkspaceRole; today: string;
  busy: boolean; mutate: Mutate; onNotice: (text: string) => void; onError: (text: string) => void;
}) {
  const { t, tag } = useI18n();
  const planner = canPlanShoots(role);
  const shoots = useMemo(() => records.filter((r) => r.kind === "shoot" && !r.archived), [records]);
  const crew = members.filter((m) => m.role !== "client");
  const liveClients = clients.filter((c) => !c.archived);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [open, setOpen] = useState<{ shoot?: RecordItem; form: Form } | null>(null);
  const [saving, setSaving] = useState(false);
  const clientName = (id?: string) => liveClients.find((c) => c.id === id)?.name ?? clients.find((c) => c.id === id)?.name;
  const day = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString(tag, options);
  const endTime = (s: Pick<RecordItem, "time" | "duration">) => {
    const [h, m] = (s.time ?? "00:00").split(":").map(Number);
    const total = h * 60 + m + (s.duration ?? 0);
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  const openNew = (due = today) => setOpen({ form: blank(due < today ? today : due) });
  const openShoot = (shoot: RecordItem) => setOpen({ shoot, form: {
    name: shoot.name, shootType: shoot.shootType ?? "external", clientId: shoot.clientId ?? "", due: shoot.due ?? today, time: shoot.time ?? "09:00",
    duration: shoot.duration ?? 180, location: shoot.location ?? "", attendees: shoot.attendees ?? [], externalCrew: shoot.externalCrew ?? "", description: shoot.description ?? "",
  } });
  const editable = !!open && planner && !open.shoot?.cancelledAt && !open.shoot?.endedAt;
  // Crew booked elsewhere at the same time, worked out as the planner picks people.
  const conflicts = open ? crewConflicts({ id: open.shoot?.id ?? "new", due: open.form.due, time: open.form.time, duration: open.form.duration, attendees: open.form.attendees }, records) : [];

  async function save() {
    if (!open) return;
    setSaving(true);
    try {
      const reply = await mutate({ action: "shoot-save", ...(open.shoot ? { id: open.shoot.id, revision: open.shoot.revision } : {}), data: open.form });
      setOpen(null);
      onNotice(reply?.conflicts?.length ? t("Shooting enregistré · {n} conflit(s) d’agenda dans l’équipe", { n: reply.conflicts.length }) : t(open.shoot ? "Shooting mis à jour" : "Shooting planifié · l’équipe est prévenue"));
    } catch (error) { onError(t((error as Error).message)); }
    finally { setSaving(false); }
  }
  async function close(action: "shoot-done" | "shoot-cancel") {
    if (!open?.shoot) return;
    if (action === "shoot-cancel" && !window.confirm(t("Annuler ce shooting ? L’équipe et le client sont prévenus."))) return;
    setSaving(true);
    try { await mutate({ action, id: open.shoot.id }); setOpen(null); onNotice(t(action === "shoot-done" ? "Shooting marqué réalisé" : "Shooting annulé")); }
    catch (error) { onError(t((error as Error).message)); }
    finally { setSaving(false); }
  }

  // The month grid starts on Monday.
  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00`).getDay() + 6) % 7;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => shiftDay(first, i - lead));
  const byDay = (d: string) => shoots.filter((s) => s.due === d).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  const shiftMonth = (n: number) => { const d = new Date(`${month}-15T12:00:00`); d.setMonth(d.getMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const { coming, past } = shootLists(shoots, today);

  const decision = (s: RecordItem) => !s.clientId ? null
    : s.clientDecision?.state === "confirmed" ? <span className="shoot-chip ok"><CheckCircle2 size={12} />{t("Confirmé par le client")}</span>
    : s.clientDecision?.state === "reschedule" ? <span className="shoot-chip warn" title={s.clientDecision.note}><AlertTriangle size={12} />{t("Autre date demandée")}</span>
    : <span className="shoot-chip">{t("En attente du client")}</span>;

  const card = (s: RecordItem) => {
    const phase = shootPhase(s, today);
    return <Surface asChild tone="default" key={s.id}><button className={`shoot-card ${phase}`} onClick={() => openShoot(s)}>
      <span className="shoot-date"><strong>{day(s.due ?? today, { day: "numeric" })}</strong><small>{day(s.due ?? today, { month: "short" })}</small></span>
      <span className="shoot-main">
        <span className="shoot-title"><strong>{s.name}</strong><span className={`shoot-type ${s.shootType ?? "external"}`}>{t(s.shootType === "internal" ? "Interne" : "Externe")}</span></span>
        <small>{[clientName(s.clientId), `${s.time} – ${endTime(s)}`, s.location].filter(Boolean).join(" · ")}</small>
        <span className="shoot-meta">
          {!!s.attendeeNames?.length && <span><Users size={12} />{s.attendeeNames.join(", ")}</span>}
          {phase === "cancelled" ? <span className="shoot-chip"><XCircle size={12} />{t("Annulé")}</span> : phase === "done" ? <span className="shoot-chip ok">{t("Réalisé")}</span> : decision(s)}
        </span>
      </span>
    </button></Surface>;
  };

  return <div className="shoots-page">
    <div className="page-heading">
      <div className="heading-line">
        <h1>{t("Shootings")}</h1>
        {planner && <button className="btn primary" disabled={busy} onClick={() => openNew()}><Plus size={16} />{t("Nouveau shooting")}</button>}
      </div>
      <p>{t(planner ? "Planifiez les séances photo et vidéo, internes ou chez le client, avec l’équipe qui les réalise." : "Les shootings sur lesquels vous êtes prévu·e.")}</p>
    </div>

    <div className="shoots-toolbar">
      <div className="live-switch" role="group" aria-label={t("Affichage")}>
        <button aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>{t("Calendrier")}</button>
        <button aria-pressed={view === "list"} onClick={() => setView("list")}>{t("Liste")}</button>
      </div>
      {view === "calendar" && <div className="inline">
        <button className="icon-button" aria-label={t("Mois précédent")} onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
        <strong className="shoots-month">{new Date(`${month}-15T12:00:00`).toLocaleDateString(tag, { month: "long", year: "numeric" })}</strong>
        <button className="icon-button" aria-label={t("Mois suivant")} onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
        <button className="btn" onClick={() => setMonth(today.slice(0, 7))}>{t("Aujourd’hui")}</button>
      </div>}
    </div>

    {view === "calendar" ? <Surface asChild tone="default"><section className="shoots-calendar" aria-label={t("Calendrier des shootings")}>
      {cells.slice(0, 7).map((d) => <span key={d} className="shoots-weekday">{day(d, { weekday: "short" })}</span>)}
      {cells.map((d) => <div key={d} className={`shoots-day ${d.slice(0, 7) !== month ? "outside" : ""} ${d === today ? "today" : ""}`}>
        <header><span>{Number(d.slice(8))}</span>{planner && d >= today && <button className="shoots-add" aria-label={t("Planifier un shooting le {date}", { date: day(d, { day: "numeric", month: "long" }) })} onClick={() => openNew(d)}><Plus size={13} /></button>}</header>
        {byDay(d).map((s) => <button key={s.id} className={`shoots-event ${s.shootType ?? "external"} ${s.cancelledAt ? "cancelled" : ""}`} onClick={() => openShoot(s)} title={s.name}>
          <strong>{s.time}</strong><span>{s.name}</span>
        </button>)}
      </div>)}
    </section></Surface> : <div className="shoots-lists">
      <section><h2>{t("À venir")}<span className="neutral-badge">{coming.length}</span></h2>
        <div className="shoots-grid">{coming.map(card)}{!coming.length && <p className="small-note"><Camera size={14} /> {t("Aucun shooting à venir.")}</p>}</div>
      </section>
      {!!past.length && <section><h2>{t("Ces deux dernières semaines")}</h2><div className="shoots-grid">{past.map(card)}</div></section>}
    </div>}

    <Dialog open={!!open} onOpenChange={(o) => { if (!o && !saving) setOpen(null); }}>
      <DialogContent className="tracker-modal shoot-dialog">
        <DialogHeader>
          <DialogTitle>{open?.shoot ? open.shoot.name : t("Nouveau shooting")}</DialogTitle>
          <DialogDescription>{t(open?.shoot?.cancelledAt ? "Ce shooting est annulé." : open?.shoot?.endedAt ? "Ce shooting a été réalisé." : editable ? "L’équipe choisie est prévenue ; le client confirme depuis son espace." : "Le détail du shooting.")}</DialogDescription>
        </DialogHeader>
        {open && <form className="form-fields" onSubmit={(e) => { e.preventDefault(); if (editable) void save(); }}>
          <fieldset disabled={!editable || saving} className="form-fields">
            <label className="form-field"><span>{t("Titre")}</span><input required maxLength={140} value={open.form.name} placeholder={t("Lookbook automne, tournage du reel…")} onChange={(e) => setOpen({ ...open, form: { ...open.form, name: e.target.value } })} /></label>
            <div className="form-field"><span>{t("Type")}</span>
              <div className="live-switch shoot-type-switch" role="group" aria-label={t("Type de shooting")}>
                {(["external", "internal"] as const).map((type) => <button type="button" key={type} aria-pressed={open.form.shootType === type} onClick={() => setOpen({ ...open, form: { ...open.form, shootType: type } })}>{t(type === "external" ? "Externe · pour un client" : "Interne · en studio ou pour l’agence")}</button>)}
              </div>
            </div>
            <div className="form-field"><span>{t(open.form.shootType === "external" ? "Client" : "Client (facultatif)")}</span>
              <Select value={open.form.clientId || "__none"} onValueChange={(v) => setOpen({ ...open, form: { ...open.form, clientId: v === "__none" ? "" : v } })}>
                <SelectTrigger className="pick" aria-label={t("Client")}><SelectValue /></SelectTrigger>
                <SelectContent>{open.form.shootType === "internal" && <SelectItem value="__none">{t("Aucun client")}</SelectItem>}{open.form.shootType === "external" && !open.form.clientId && <SelectItem value="__none">{t("Choisir un client")}</SelectItem>}{liveClients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="form-pair">
              <div className="form-field"><span>{t("Date")}</span><DatePicker label={t("Date")} value={open.form.due} onChange={(v) => setOpen({ ...open, form: { ...open.form, due: v } })} /></div>
              <label className="form-field"><span>{t("Heure (Maroc)")}</span><TimeField required value={open.form.time} label={t("Heure (Maroc)")} onChange={(time) => setOpen({ ...open, form: { ...open.form, time } })} /></label>
            </div>
            <div className="form-pair">
              <div className="form-field"><span>{t("Durée")}</span>
                <Select value={String(open.form.duration)} onValueChange={(v) => setOpen({ ...open, form: { ...open.form, duration: Number(v) } })}>
                  <SelectTrigger className="pick" aria-label={t("Durée")}><SelectValue /></SelectTrigger>
                  <SelectContent>{[...new Set([...shootDurations, open.form.duration])].sort((a, b) => a - b).map((d) => <SelectItem key={d} value={String(d)}>{d % 60 ? t("{m} min", { m: d }) : t("{h} h", { h: d / 60 })}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className="form-field"><span>{t("Lieu")}</span><input maxLength={300} value={open.form.location} placeholder={t("Studio, adresse, lieu…")} onChange={(e) => setOpen({ ...open, form: { ...open.form, location: e.target.value } })} /></label>
            </div>
            <div className="form-field"><span>{t("Équipe")}</span>
              <div className="title-choices" role="group" aria-label={t("Équipe du shooting")}>
                {crew.map((m) => { const on = open.form.attendees.includes(m.userId); return <button type="button" key={m.userId} className={`title-choice ${on ? "selected" : ""}`} aria-pressed={on} onClick={() => setOpen({ ...open, form: { ...open.form, attendees: on ? open.form.attendees.filter((id) => id !== m.userId) : [...open.form.attendees, m.userId] } })}>{memberName(m)}{m.titles?.length ? ` · ${m.titles[0]}` : ""}</button>; })}
              </div>
              {!!conflicts.length && <p className="shoot-conflict" role="status"><AlertTriangle size={14} />{t("Déjà pris à cette heure : {who}", { who: conflicts.map((c) => `${memberName(crew.find((m) => m.userId === c.userId) ?? ({ name: null, email: null } as WorkspaceMember))} (${c.with.name})`).join(", ") })}</p>}
            </div>
            <label className="form-field"><span>{t("Équipe externe (facultatif)")}</span><input maxLength={300} value={open.form.externalCrew} placeholder={t("Freelances, modèles… jamais montré au client")} onChange={(e) => setOpen({ ...open, form: { ...open.form, externalCrew: e.target.value } })} /></label>
            <label className="form-field"><span>{t("Brief et liste de plans")}</span><textarea rows={4} maxLength={4000} value={open.form.description} placeholder={t("Ce qu’il faut prévoir : tenues, produits, accès au lieu…")} onChange={(e) => setOpen({ ...open, form: { ...open.form, description: e.target.value } })} /></label>
          </fieldset>
          {open.shoot?.clientDecision?.state === "reschedule" && <p className="shoot-conflict"><AlertTriangle size={14} />{t("Le client demande une autre date : {note}", { note: open.shoot.clientDecision.note ?? "" })}</p>}
          <DialogFooter className="modal-footer">
            {planner && open.shoot && !open.shoot.cancelledAt && !open.shoot.endedAt && <>
              <button type="button" className="btn ghost danger" disabled={saving} onClick={() => void close("shoot-cancel")}>{t("Annuler le shooting")}</button>
              {(open.shoot.due ?? "") <= today && <button type="button" className="btn" disabled={saving} onClick={() => void close("shoot-done")}><CheckCircle2 size={15} />{t("Marquer réalisé")}</button>}
            </>}
            <button type="button" className="btn" disabled={saving} onClick={() => setOpen(null)}>{t("Fermer")}</button>
            {editable && <button className="btn primary" disabled={saving || !open.form.name.trim() || (open.form.shootType === "external" && !open.form.clientId)}><Clock size={15} />{t(open.shoot ? "Enregistrer" : "Planifier")}</button>}
          </DialogFooter>
        </form>}
        {open?.shoot?.location && !editable && <p className="small-note"><MapPin size={13} /> {open.shoot.location}</p>}
      </DialogContent>
    </Dialog>
  </div>;
}
