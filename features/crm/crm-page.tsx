"use client";
// The CRM: the studio's prospects on a board of stages, from first contact to won or lost. A card moves
// by dragging it to another column; its dialog holds the contact, the value, the next follow-up and the
// notes. Won, the owner turns it into a client and its page opens, where the quote and contract follow.
// The owner and administrators only. Rules: lib/crm.ts; actions: features/records/server/actions/crm.ts.
import { Surface } from "@/components/ui/surface";
import DatePicker from "@/components/date-picker";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, Plus, Trash2, Trophy } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/locale-provider";
import { crmSummary, prospectLostReasons, prospectSources, prospectStageLabels, prospectStages, type ProspectStage } from "@/lib/crm";
import type { RecordItem } from "@/lib/model";
import type { WorkspaceRole } from "@/lib/workspace";
import { CountUp } from "@/features/dashboard/flow-pipeline";

// The analysis loads when it is first opened: the board is what most visits need.
const CrmInsights = dynamic(() => import("./crm-insights"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the records API's reply, read for the new client's id
type Mutate = (body: Record<string, unknown>) => Promise<any>;
type Form = { name: string; contact: string; email: string; whatsapp: string; city: string; sector: string; source: string; estimatedValue: string; due: string; prospectStage: ProspectStage; lostReason: string; lostNote: string; description: string };
const blank: Form = { name: "", contact: "", email: "", whatsapp: "", city: "", sector: "", source: "", estimatedValue: "", due: "", prospectStage: "new", lostReason: "", lostNote: "", description: "" };

export default function CrmPage({ records, role, today, busy, mutate, onNotice, onError, onOpenClient }: {
  records: RecordItem[]; role: WorkspaceRole; today: string; busy: boolean; mutate: Mutate;
  onNotice: (text: string) => void; onError: (text: string) => void; onOpenClient: (id: string) => void;
}) {
  const { t, tag } = useI18n();
  const prospects = useMemo(() => records.filter((r) => r.kind === "prospect" && !r.archived), [records]);
  const summary = crmSummary(prospects, today);
  const [open, setOpen] = useState<{ prospect?: RecordItem; form: Form } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ProspectStage | null>(null);
  const [view, setView] = useState<"board" | "insights">("board");
  const money = (n: number) => `${n.toLocaleString(tag)} MAD`;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(tag, { day: "numeric", month: "short" });
  const isOwner = role === "owner";

  const openProspect = (p: RecordItem, stage?: ProspectStage) => setOpen({ prospect: p, form: {
    name: p.name, contact: p.contact ?? "", email: p.email ?? "", whatsapp: p.whatsapp ?? "", city: p.city ?? "", sector: p.sector ?? "", source: p.source ?? "",
    estimatedValue: p.estimatedValue != null ? String(p.estimatedValue) : "", due: p.due ?? "", prospectStage: stage ?? (p.prospectStage ?? "new") as ProspectStage,
    lostReason: p.lostReason ?? "", lostNote: p.lostNote ?? "", description: p.description ?? "",
  } });

  async function run<T>(work: () => Promise<T>, notice?: string) {
    setSaving(true);
    try { const reply = await work(); if (notice) onNotice(t(notice)); return reply; }
    catch (error) { onError(t((error as Error).message)); return null; }
    finally { setSaving(false); }
  }
  async function save() {
    if (!open) return;
    const reply = await run(() => mutate({ action: "prospect-save", ...(open.prospect ? { id: open.prospect.id, revision: open.prospect.revision } : {}), data: { ...open.form, estimatedValue: open.form.estimatedValue === "" ? null : Number(open.form.estimatedValue) } }), open.prospect ? "Prospect mis à jour" : "Prospect ajouté");
    if (reply) setOpen(null);
  }
  async function convert(p: RecordItem) {
    if (!isOwner) { onError(t("Seul le propriétaire crée des clients : demandez-lui de convertir ce prospect.")); return; }
    if (!window.confirm(t("Convertir « {name} » en client ? Sa fiche client est créée avec ses coordonnées.", { name: p.name }))) return;
    const reply = await run(() => mutate({ action: "prospect-convert", id: p.id, revision: p.revision }), "Prospect gagné · client créé");
    if (reply?.id) { setOpen(null); onOpenClient(reply.id); }
  }
  async function move(p: RecordItem, stage: ProspectStage) {
    if (stage === (p.prospectStage ?? "new")) return;
    if (stage === "won") { await convert(p); return; }
    // Lost: the dialog opens on « Perdu » so the reason is noted; the card moves once it is saved.
    if (stage === "lost") { openProspect(p, "lost"); return; }
    await run(() => mutate({ action: "prospect-stage", id: p.id, revision: p.revision, stage }));
  }
  async function remove(p: RecordItem) {
    if (!window.confirm(t("Supprimer « {name} » du CRM ?", { name: p.name }))) return;
    const reply = await run(() => mutate({ action: "prospect-delete", id: p.id }), "Prospect supprimé");
    if (reply) setOpen(null);
  }

  return <div className="crm-page">
    <div className="page-heading">
      <div className="heading-line">
        <h1>{t("CRM")}</h1>
        <button className="btn primary" disabled={busy} onClick={() => setOpen({ form: blank })}><Plus size={16} />{t("Nouveau prospect")}</button>
      </div>
      <p>{t("Vos prospects, du premier contact au client gagné.")}</p>
    </div>

    <div className="live-switch crm-view" role="group" aria-label={t("Affichage")}>
      <button aria-pressed={view === "board"} onClick={() => setView("board")}>{t("Tableau")}</button>
      <button aria-pressed={view === "insights"} onClick={() => setView("insights")}>{t("Analyse")}</button>
    </div>

    {view === "insights" ? <CrmInsights prospects={prospects} today={today} /> : <>
    <div className="crm-summary">
      <Surface tone="default" className="crm-stat"><span>{t("Pipeline mensuel")}</span><strong><CountUp value={summary.pipelineValue} format={(n) => n.toLocaleString(tag)} /> <small>MAD</small></strong></Surface>
      <Surface tone="default" className={`crm-stat ${summary.followUpsDue ? "due" : ""}`}><span>{t("Relances à faire")}</span><strong><CountUp value={summary.followUpsDue} /></strong></Surface>
      <Surface tone="default" className="crm-stat"><span>{t("Gagnés ce mois")}</span><strong><CountUp value={summary.wonThisMonth} /></strong></Surface>
    </div>

    <div className="crm-board" aria-label={t("Tableau des prospects")}>
      {prospectStages.map((stage) => {
        const column = prospects.filter((p) => (p.prospectStage ?? "new") === stage).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
        const value = column.reduce((n, p) => n + (p.estimatedValue ?? 0), 0);
        return <section key={stage} className={`crm-column ${stage} ${over === stage ? "drag-over" : ""}`}
          onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(stage); } }}
          onDragLeave={() => setOver((s) => (s === stage ? null : s))}
          onDrop={(e) => { e.preventDefault(); setOver(null); const p = prospects.find((x) => x.id === dragging); setDragging(null); if (p) void move(p, stage); }}>
          <header><h2>{t(prospectStageLabels[stage])}</h2><span className="neutral-badge">{column.length}</span>{value > 0 && <small>{money(value)}</small>}</header>
          {column.map((p) => {
            const late = !!p.due && p.due < today && stage !== "won" && stage !== "lost";
            return <Surface asChild tone="default" key={p.id}><button className={`crm-card ${dragging === p.id ? "dragging" : ""}`} draggable={!saving && !p.convertedClientId}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragging(p.id); }} onDragEnd={() => { setDragging(null); setOver(null); }}
              onClick={() => openProspect(p)}>
              <strong>{p.name}</strong>
              <small>{[p.contact, p.city].filter(Boolean).join(" · ") || t("Aucun contact")}</small>
              <span className="crm-card-foot">
                {p.estimatedValue ? <span className="crm-value">{money(p.estimatedValue)}<small>{t("/mois")}</small></span> : <span />}
                {stage === "won" ? <span className="crm-due won"><Trophy size={12} />{t("Client")}</span>
                  : p.due && stage !== "lost" ? <span className={`crm-due ${late ? "late" : p.due === today ? "today" : ""}`}><CalendarClock size={12} />{p.due === today ? t("Aujourd’hui") : day(p.due)}</span> : null}
              </span>
              {p.source && <span className="crm-source">{t(p.source)}</span>}
            </button></Surface>;
          })}
          {!column.length && <p className="crm-empty">{t(stage === "new" ? "Ajoutez votre premier prospect." : "Glissez une carte ici.")}</p>}
        </section>;
      })}
    </div>
    </>}

    <Dialog open={!!open} onOpenChange={(o) => { if (!o && !saving) setOpen(null); }}>
      <DialogContent className="tracker-modal crm-dialog">
        <DialogHeader>
          <DialogTitle>{open?.prospect ? open.prospect.name : t("Nouveau prospect")}</DialogTitle>
          <DialogDescription>{t(open?.prospect?.convertedClientId ? "Ce prospect est devenu client." : "Coordonnées, valeur estimée et prochaine relance.")}</DialogDescription>
        </DialogHeader>
        {open && <form className="form-fields" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="form-field"><span>{t("Entreprise ou personne *")}</span><input required maxLength={160} value={open.form.name} onChange={(e) => setOpen({ ...open, form: { ...open.form, name: e.target.value } })} /></label>
          <div className="form-pair">
            <label className="form-field"><span>{t("Contact")}</span><input maxLength={150} value={open.form.contact} onChange={(e) => setOpen({ ...open, form: { ...open.form, contact: e.target.value } })} /></label>
            <label className="form-field"><span>{t("WhatsApp")}</span><input type="tel" dir="ltr" maxLength={60} value={open.form.whatsapp} onChange={(e) => setOpen({ ...open, form: { ...open.form, whatsapp: e.target.value } })} /></label>
          </div>
          <div className="form-pair">
            <label className="form-field"><span>{t("E-mail")}</span><input type="email" maxLength={200} value={open.form.email} onChange={(e) => setOpen({ ...open, form: { ...open.form, email: e.target.value } })} /></label>
            <label className="form-field"><span>{t("Ville")}</span><input maxLength={100} value={open.form.city} onChange={(e) => setOpen({ ...open, form: { ...open.form, city: e.target.value } })} /></label>
          </div>
          <div className="form-pair">
            <label className="form-field"><span>{t("Secteur")}</span><input maxLength={120} value={open.form.sector} onChange={(e) => setOpen({ ...open, form: { ...open.form, sector: e.target.value } })} /></label>
            <div className="form-field"><span>{t("Source")}</span>
              <Select value={open.form.source || "__none"} onValueChange={(v) => setOpen({ ...open, form: { ...open.form, source: v === "__none" ? "" : v } })}>
                <SelectTrigger className="pick" aria-label={t("Source")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__none">{t("Non précisée")}</SelectItem>{prospectSources.map((s) => <SelectItem key={s} value={s}>{t(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="form-pair">
            <label className="form-field"><span>{t("Valeur mensuelle estimée (MAD)")}</span><input type="number" min={0} step={100} inputMode="numeric" value={open.form.estimatedValue} onChange={(e) => setOpen({ ...open, form: { ...open.form, estimatedValue: e.target.value } })} /></label>
            <div className="form-field"><span>{t("Prochaine relance")}</span><DatePicker label={t("Prochaine relance")} value={open.form.due} onChange={(v) => setOpen({ ...open, form: { ...open.form, due: v } })} /></div>
          </div>
          {!open.prospect?.convertedClientId && <div className="form-field"><span>{t("Étape")}</span>
            <Select value={open.form.prospectStage} onValueChange={(v) => setOpen({ ...open, form: { ...open.form, prospectStage: v as ProspectStage } })}>
              <SelectTrigger className="pick" aria-label={t("Étape")}><SelectValue /></SelectTrigger>
              <SelectContent>{prospectStages.filter((s) => s !== "won").map((s) => <SelectItem key={s} value={s}>{t(prospectStageLabels[s])}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
          {open.form.prospectStage === "lost" && <div className="form-pair">
            <div className="form-field"><span>{t("Raison de la perte")}</span>
              <Select value={open.form.lostReason || "__none"} onValueChange={(v) => setOpen({ ...open, form: { ...open.form, lostReason: v === "__none" ? "" : v } })}>
                <SelectTrigger className="pick" aria-label={t("Raison de la perte")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__none">{t("Non précisée")}</SelectItem>{prospectLostReasons.map((r) => <SelectItem key={r} value={r}>{t(r)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="form-field"><span>{t("En quelques mots (facultatif)")}</span><input maxLength={500} value={open.form.lostNote} placeholder={t("Ce qui a fait la différence…")} onChange={(e) => setOpen({ ...open, form: { ...open.form, lostNote: e.target.value } })} /></label>
          </div>}
          <label className="form-field"><span>{t("Notes")}</span><textarea rows={4} maxLength={4000} value={open.form.description} placeholder={t("Besoins, budget évoqué, prochaines étapes…")} onChange={(e) => setOpen({ ...open, form: { ...open.form, description: e.target.value } })} /></label>
          <DialogFooter className="modal-footer">
            {open.prospect && <button type="button" className="btn ghost danger" disabled={saving} onClick={() => void remove(open.prospect!)}><Trash2 size={15} />{t("Supprimer")}</button>}
            {open.prospect?.convertedClientId
              ? <button type="button" className="btn" onClick={() => { const id = open.prospect!.convertedClientId!; setOpen(null); onOpenClient(id); }}><ArrowUpRight size={15} />{t("Ouvrir le client")}</button>
              : open.prospect && open.form.prospectStage !== "lost" && <button type="button" className="btn" disabled={saving || !isOwner} title={isOwner ? undefined : t("Seul le propriétaire crée des clients.")} onClick={() => void convert(open.prospect!)}><Trophy size={15} />{t("Convertir en client")}</button>}
            <button className="btn primary" disabled={saving || !open.form.name.trim()}>{t(open.prospect ? "Enregistrer" : "Ajouter")}</button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}
