"use client";
// « Plan Éditorial » inside a client (tracker → client → tab « Plan Éditorial »): the client's content
// profile, its monthly plans, and one plan in detail — Table / Calendrier / Board, every item a real task
// edited inline, locked or regenerated, then the stories, the production plan and the checklist to
// validate with the client. Server side: app/api/content-plan/route.ts. Existing styles only.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, ArchiveRestore, ArrowLeft, CalendarDays, Check, ChevronDown, Copy, ExternalLink, FileDown, Loader2,
  Lock, MessageCircle, Plus, RefreshCw, Share2, Sparkles, Trash2, Unlock, X,
} from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { statusClass, statuses, type Status } from "@/lib/model";
import {
  alkhaouarizmiProfile, contentLanguages, daysOf, emptyProfile, frequencyLabels, nextMonth, planPlatforms,
  weekdayLabels, weekdayOf, weekdays,
  type ContentPlan, type ContentProfile, type Frequency, type PlanItemFields, type SeriesFormat,
} from "@/lib/content-plan";

type Item = PlanItemFields & {
  id: string; name: string; due?: string; status?: Status; assignee?: string; assigneeId?: string; deliverable?: string;
  revision: number; archived?: boolean;
};
type Comment = { id: string; taskId: string; text: string; author?: string; audience?: string; createdAt: string };
type Member = { userId: string; name: string };
type Detail = { plan: ContentPlan; items: Item[]; comments: Comment[]; members: Member[]; canEdit: boolean };
type Overview = { profile: ContentProfile | null; plans: ContentPlan[]; canEdit: boolean; aiConfigured: boolean; gaps: string[] | null };

const boardColumns: Status[] = ["À faire", "En cours", "À valider", "Validé"];
const thisMonth = () => new Date().toISOString().slice(0, 7);
/** « octobre 2026 » in the interface language. */
export function useMonthName() {
  const { date } = useI18n();
  return useCallback((month: string) => date(`${month}-15`, { month: "long", year: "numeric" }), [date]);
}

function useApi(workspaceId: string) {
  const headers = useMemo(() => ({ "Content-Type": "application/json", "X-Workspace-Id": workspaceId }), [workspaceId]);
  const get = useCallback(async <T,>(query: Record<string, string>): Promise<T> => {
    const r = await fetch(`/api/content-plan?${new URLSearchParams(query)}`, { headers, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Chargement impossible.");
    return data as T;
  }, [headers]);
  const post = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    const r = await fetch("/api/content-plan", { method: "POST", headers, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Action impossible.");
    return data as T;
  }, [headers]);
  return { get, post };
}

// ---------------------------------------------------------------- small inputs

function EditCell({ value, onSave, disabled, multiline, type = "text", options, placeholder, className = "" }: {
  value: string; onSave: (v: string) => void; disabled?: boolean; multiline?: boolean; type?: "text" | "date";
  options?: { value: string; label: string }[]; placeholder?: string; className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { t } = useI18n();
  if (disabled) return <span className={`cp-cell ${className}`}>{options?.find((o) => o.value === value)?.label ?? (value || "—")}</span>;
  const commit = (v: string) => { setDraft(null); if (v !== value) onSave(v); };
  if (options) {
    return (
      <select className={`cp-select ${className}`} value={value} onChange={(e) => commit(e.target.value)} aria-label={placeholder}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (draft === null) {
    return <button type="button" className={`cp-cell editable ${className}`} onClick={() => setDraft(value)} title={t("Modifier")}>{value || <em>{placeholder ?? "—"}</em>}</button>;
  }
  const common = {
    autoFocus: true, value: draft, className: `cp-input ${className}`,
    onBlur: () => commit(draft.trim()),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") setDraft(null); if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(draft.trim()); } },
  };
  return multiline
    ? <textarea {...common} rows={3} onChange={(e) => setDraft(e.target.value)} />
    : <input {...common} type={type} onChange={(e) => setDraft(e.target.value)} />;
}

function Chips({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState("");
  const add = () => { const v = text.trim(); if (v && !values.includes(v)) onChange([...values, v]); setText(""); };
  return (
    <div className="cp-chips">
      {values.map((v) => <span key={v} className="cp-chip">{v}<button type="button" aria-label="Retirer" onClick={() => onChange(values.filter((x) => x !== v))}><X size={12} /></button></span>)}
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

function Days({ value, onChange, single }: { value: number[]; onChange: (v: number[]) => void; single?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="cp-days" role="group">
      {weekdays.map((d) => (
        <button key={d} type="button" aria-pressed={value.includes(d)} className={value.includes(d) ? "on" : ""}
          onClick={() => onChange(single ? [d] : value.includes(d) ? value.filter((x) => x !== d) : [...value, d])}>{t(weekdayLabels[d])}</button>
      ))}
    </div>
  );
}

const daysText = (days: number[], t: (s: string) => string) =>
  days.length === 7 ? t("Tous les jours") : weekdays.filter((d) => days.includes(d)).map((d) => t(weekdayLabels[d])).join(" · ");

// ---------------------------------------------------------------- profile

function ProfileEditor({ initial, platformOwner, onSave, onCancel, busy }: {
  initial: ContentProfile | null; platformOwner: boolean; busy: boolean;
  onSave: (p: ContentProfile) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [p, setP] = useState<ContentProfile>(initial ?? emptyProfile());
  const set = <K extends keyof ContentProfile>(k: K, v: ContentProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="form-field"><span>{t(label)}</span>{node}{hint && <small>{t(hint)}</small>}</label>
  );
  const row = <T,>(key: "series" | "stories" | "people", i: number, patch: Partial<T>) =>
    set(key, (p[key] as unknown as T[]).map((x, j) => (j === i ? { ...x, ...patch } : x)) as never);
  const remove = (key: "series" | "stories" | "people", i: number) => set(key, (p[key] as unknown[]).filter((_, j) => j !== i) as never);

  return (
    <section className="work-panel cp-profile-form" aria-label={t("Profil contenu")}>
      <div className="section-head">
        <h2>{t("Profil contenu")}</h2>
        {platformOwner && !initial && <button type="button" className="btn ghost" onClick={() => setP(alkhaouarizmiProfile)}><Sparkles size={14} />{t("Préremplir avec l’exemple Alkhaouarizmi")}</button>}
      </div>

      <h3 className="cp-form-title">{t("Le client")}</h3>
      <div className="form-pair">
        {field("Secteur", <input value={p.sector} onChange={(e) => set("sector", e.target.value)} />)}
        {field("Ville", <input value={p.city} onChange={(e) => set("city", e.target.value)} />)}
      </div>
      {field("Description courte de l’offre", <textarea rows={2} value={p.offer} onChange={(e) => set("offer", e.target.value)} />)}
      {field("Positionnement / objectif n°1", <input value={p.goal} onChange={(e) => set("goal", e.target.value)} placeholder={t("Ex. être LA référence de l’orientation à Tanger")} />)}
      {field("Situation", <input value={p.situation} onChange={(e) => set("situation", e.target.value)} placeholder={t("Ex. centre complet → pas de CTA inscription")} />)}
      {field("Audiences", <Chips values={p.audiences} onChange={(v) => set("audiences", v)} placeholder={t("Ajouter une audience…")} />)}
      <div className="form-pair">
        {field("Langue(s) du contenu", <div className="cp-checks">{contentLanguages.map((l) => (
          <label key={l}><input type="checkbox" checked={p.languages.includes(l)} onChange={(e) => set("languages", e.target.checked ? [...p.languages, l] : p.languages.filter((x) => x !== l))} />{l}</label>
        ))}</div>)}
        {field("Plateformes", <div className="cp-checks">{planPlatforms.map((l) => (
          <label key={l}><input type="checkbox" checked={p.platforms.includes(l)} onChange={(e) => set("platforms", e.target.checked ? [...p.platforms, l] : p.platforms.filter((x) => x !== l))} />{l}</label>
        ))}</div>)}
      </div>

      <h3 className="cp-form-title">{t("Contrat et rythme")}</h3>
      <div className="cp-quota-row">
        {field("Reels / mois", <input type="number" min={0} max={60} value={p.quotas.reels} onChange={(e) => set("quotas", { ...p.quotas, reels: Number(e.target.value) })} />)}
        {field("Posts / mois", <input type="number" min={0} max={60} value={p.quotas.posts} onChange={(e) => set("quotas", { ...p.quotas, posts: Number(e.target.value) })} />)}
        {field("Stories / jour", <input type="number" min={0} max={20} value={p.quotas.storiesPerDay} onChange={(e) => set("quotas", { ...p.quotas, storiesPerDay: Number(e.target.value) })} />)}
        {field("Jours de tournage / mois", <input type="number" min={0} max={8} value={p.shootDays} onChange={(e) => set("shootDays", Number(e.target.value))} />)}
      </div>
      <div className="form-pair">
        {field("Jours des reels", <Days value={p.rhythm.reels} onChange={(v) => set("rhythm", { ...p.rhythm, reels: v })} />, "Pour les reels hors séries.")}
        {field("Jours des posts", <Days value={p.rhythm.posts} onChange={(v) => set("rhythm", { ...p.rhythm, posts: v })} />, "Pour les posts hors séries.")}
      </div>

      <h3 className="cp-form-title">{t("Séries récurrentes")}</h3>
      {p.series.map((s, i) => (
        <div key={i} className="cp-repeat">
          <div className="cp-repeat-grid">
            {field("Nom", <input value={s.name} onChange={(e) => row("series", i, { name: e.target.value })} />)}
            {field("Format", <select value={s.format} onChange={(e) => row("series", i, { format: e.target.value as SeriesFormat })}><option value="reel">Reel</option><option value="post">Post</option><option value="story">Story</option></select>)}
            {field("Jour", <select value={s.weekday} onChange={(e) => row("series", i, { weekday: Number(e.target.value) })}>{weekdays.map((d) => <option key={d} value={d}>{t(weekdayLabels[d])}</option>)}</select>)}
            {field("Fréquence", <select value={s.frequency} onChange={(e) => row("series", i, { frequency: e.target.value as Frequency })}>{(Object.keys(frequencyLabels) as Frequency[]).map((f) => <option key={f} value={f}>{t(frequencyLabels[f])}</option>)}</select>)}
            {field("Présentateur", <input value={s.presenter} onChange={(e) => row("series", i, { presenter: e.target.value })} />)}
          </div>
          {field("Description", <input value={s.description} onChange={(e) => row("series", i, { description: e.target.value })} />)}
          <button type="button" className="icon-button" aria-label={t("Retirer")} onClick={() => remove("series", i)}><Trash2 size={15} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={() => set("series", [...p.series, { name: "", format: "reel", weekday: 2, frequency: "weekly", description: "", presenter: "" }])}><Plus size={14} />{t("Ajouter une série")}</button>

      <h3 className="cp-form-title">{t("Stories récurrentes")}</h3>
      {p.stories.map((s, i) => (
        <div key={i} className="cp-repeat">
          <div className="cp-repeat-grid stories">
            {field("Nom", <input value={s.name} onChange={(e) => row("stories", i, { name: e.target.value })} />)}
            {field("Heure", <input type="time" value={s.time} onChange={(e) => row("stories", i, { time: e.target.value })} />)}
            {field("Jours actifs", <Days value={s.days} onChange={(v) => row("stories", i, { days: v })} />)}
          </div>
          <button type="button" className="icon-button" aria-label={t("Retirer")} onClick={() => remove("stories", i)}><Trash2 size={15} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={() => set("stories", [...p.stories, { name: "", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] }])}><Plus size={14} />{t("Ajouter une story")}</button>

      <h3 className="cp-form-title">{t("Contenus et personnes")}</h3>
      {field("Banque de formats variés", <Chips values={p.formats} onChange={(v) => set("formats", v)} placeholder={t("Ex. coulisses, sketch, motion design…")} />, "L’IA les fait tourner, sans reprendre le même format deux mois de suite si possible.")}
      {p.people.map((x, i) => (
        <div key={i} className="cp-repeat">
          <div className="cp-repeat-grid people">
            {field("Personne à l’écran", <input value={x.name} onChange={(e) => row("people", i, { name: e.target.value })} />)}
            {field("Rôle", <input value={x.role} onChange={(e) => row("people", i, { role: e.target.value })} />)}
            {field("Matière / spécialité", <input value={x.speciality} onChange={(e) => row("people", i, { speciality: e.target.value })} />)}
          </div>
          <button type="button" className="icon-button" aria-label={t("Retirer")} onClick={() => remove("people", i)}><Trash2 size={15} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={() => set("people", [...p.people, { name: "", role: "", speciality: "" }])}><Plus size={14} />{t("Ajouter une personne")}</button>
      {field("Planning / horaires utiles", <textarea rows={3} value={p.schedule} onChange={(e) => set("schedule", e.target.value)} />, "Sert aux stories de rappel.")}

      <h3 className="cp-form-title">{t("Règles")}</h3>
      <div className="form-pair">
        {field("CTA autorisés", <Chips values={p.ctaAllowed} onChange={(v) => set("ctaAllowed", v)} placeholder={t("Ajouter un CTA…")} />)}
        {field("CTA interdits", <Chips values={p.ctaForbidden} onChange={(v) => set("ctaForbidden", v)} placeholder={t("Ajouter un CTA interdit…")} />)}
      </div>
      {field("Règles de preuve", <input value={p.proofRules} onChange={(e) => set("proofRules", e.target.value)} placeholder={t("Ex. pas de statistiques, seulement des cas individuels")} />)}
      {field("Notes libres / stratégie", <textarea rows={6} value={p.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("Vous pouvez coller le document de stratégie.")} />)}

      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel}>{t("Annuler")}</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => onSave(p)}>{busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{t("Enregistrer le profil")}</button>
      </div>
    </section>
  );
}

function ProfileSummary({ profile, gaps, canEdit, onEdit }: { profile: ContentProfile | null; gaps: string[] | null; canEdit: boolean; onEdit: () => void }) {
  const { t, date } = useI18n();
  if (!profile) {
    return (
      <section className="work-panel cp-profile-empty">
        <h2>{t("Profil contenu")}</h2>
        <p>{t("Rempli une fois, réutilisé chaque mois : secteur, objectif, quotas du contrat, séries, stories, personnes à l’écran et CTA.")}</p>
        {canEdit && <button type="button" className="btn primary" onClick={onEdit}><Plus size={14} />{t("Remplir le profil contenu")}</button>}
      </section>
    );
  }
  return (
    <section className="work-panel cp-profile-summary">
      <div className="section-head">
        <div>
          <h2>{t("Profil contenu")}</h2>
          <p className="small-note">{profile.updatedAt ? t("Mis à jour le {day}", { day: date(profile.updatedAt, { day: "numeric", month: "long" }) }) : ""}</p>
        </div>
        {canEdit && <button type="button" className="btn" onClick={onEdit}>{t("Modifier le profil")}</button>}
      </div>
      <dl className="cp-facts">
        <div><dt>{t("Objectif n°1")}</dt><dd>{profile.goal || "—"}</dd></div>
        <div><dt>{t("Quotas")}</dt><dd>{t("{r} reels · {p} posts · {s} stories/jour", { r: profile.quotas.reels, p: profile.quotas.posts, s: profile.quotas.storiesPerDay })}</dd></div>
        <div><dt>{t("Langues")}</dt><dd>{profile.languages.join(", ") || "—"}</dd></div>
        <div><dt>{t("Plateformes")}</dt><dd>{profile.platforms.join(", ") || "—"}</dd></div>
        <div><dt>{t("Séries")}</dt><dd>{profile.series.map((s) => s.name).join(" · ") || "—"}</dd></div>
        <div><dt>{t("Tournage")}</dt><dd>{t("{n} jours par mois", { n: profile.shootDays })}</dd></div>
      </dl>
      {!!gaps?.length && <p className="cp-warning">{t("À compléter avant de générer : {list}.", { list: gaps.map((g) => t(g)).join(", ") })}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- generate

function GenerateDialog({ open, plans, onClose, onGenerate, busy }: {
  open: boolean; plans: ContentPlan[]; busy: boolean; onClose: () => void; onGenerate: (month: string, focus: string) => void;
}) {
  const monthName = useMonthName();
  const { t } = useI18n();
  const months = useMemo(() => Array.from({ length: 13 }, (_, i) => nextMonth(thisMonth(), i)), []);
  const taken = new Set(plans.filter((p) => !p.archived).map((p) => p.month));
  const [month, setMonth] = useState(() => months.slice(1).find((m) => !taken.has(m)) ?? months[1]);
  const [focus, setFocus] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="tracker-modal">
        <DialogHeader>
          <DialogTitle>{t("Générer le plan")}</DialogTitle>
          <DialogDescription>{t("Le calendrier est calculé à partir du profil (quotas, séries, rythme) ; l’IA écrit chaque contenu, les stories, la production et les questions client.")}</DialogDescription>
        </DialogHeader>
        <div className="form-fields">
          <label className="form-field"><span>{t("Mois")}</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m} disabled={taken.has(m)}>{monthName(m)}{taken.has(m) ? ` · ${t("déjà planifié")}` : ""}</option>)}
            </select>
          </label>
          <label className="form-field"><span>{t("Focus du mois (facultatif)")}</span>
            <textarea rows={3} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={t("Événements, examens, campagne…")} />
          </label>
          {busy && <p className="small-note"><Loader2 size={13} className="spin" /> {t("Génération en cours : environ une minute.")}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>{t("Annuler")}</button>
          <button type="button" className="btn primary" disabled={busy || taken.has(month)} onClick={() => onGenerate(month, focus)}>{busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}{t("Générer")}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- plan detail

function StatusChip({ status }: { status?: Status }) {
  const { t } = useI18n();
  const s = status ?? "À faire";
  return <span className={`status ${statusClass[s]}`}>{t(s)}</span>;
}

function ItemDialog({ item, detail, canEdit, busy, onClose, onPatch, onRegenerate, onOpenTask }: {
  item: Item | null; detail: Detail; canEdit: boolean; busy: boolean; onClose: () => void;
  onPatch: (item: Item, patch: Record<string, unknown>) => void; onRegenerate: (item: Item) => void; onOpenTask: (id: string) => void;
}) {
  const { t, date } = useI18n();
  if (!item) return null;
  const comments = detail.comments.filter((c) => c.taskId === item.id);
  const edit = (key: string, multiline = false) => (
    <EditCell value={String((item as Record<string, unknown>)[key] ?? "")} multiline={multiline} disabled={!canEdit} onSave={(v) => onPatch(item, { [key]: v })} />
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="tracker-modal cp-item-dialog">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>{item.planType === "reel" ? "Reel" : "Post"} · {item.due ? date(item.due, { weekday: "long", day: "numeric", month: "long" }) : ""}{item.planSerie ? ` · ${item.planSerie}` : ""}</DialogDescription>
        </DialogHeader>
        <dl className="cp-item-fields">
          <div><dt>{t("Titre")}</dt><dd>{edit("name")}</dd></div>
          <div><dt>{t("Format")}</dt><dd>{edit("planFormat")}</dd></div>
          <div><dt>{t("Hook")}</dt><dd dir="auto">{edit("planHook", true)}</dd></div>
          <div><dt>{t("Contenu")}</dt><dd>{edit("planContent", true)}</dd></div>
          <div><dt>{t("CTA")}</dt><dd>{edit("planCta")}</dd></div>
          <div><dt>{t("Personnes")}</dt><dd><EditCell value={item.planPeople.join(", ")} disabled={!canEdit} onSave={(v) => onPatch(item, { planPeople: v.split(",").map((x) => x.trim()).filter(Boolean) })} /></dd></div>
          <div><dt>{t("Jour de tournage")}</dt><dd>{edit("planShoot")}</dd></div>
          <div><dt>{t("Lien Drive")}</dt><dd>{edit("deliverable")}</dd></div>
        </dl>
        <section className="cp-comments">
          <h4><MessageCircle size={14} />{t("Commentaires")} <small>{comments.length}</small></h4>
          {comments.length ? comments.map((c) => (
            <p key={c.id} className={c.audience === "client" ? "from-client" : ""}><b>{c.author ?? "—"}</b>{c.audience === "client" && <span className="cp-tag">{t("Client")}</span>} <small>{date(c.createdAt, { day: "numeric", month: "short" })}</small><br />{c.text}</p>
          )) : <p className="small-note">{t("Aucun commentaire pour l’instant.")}</p>}
        </section>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => onOpenTask(item.id)}><ExternalLink size={14} />{t("Ouvrir la tâche")}</button>
          {canEdit && <button type="button" className="btn" onClick={() => onPatch(item, { planLocked: !item.planLocked })}>{item.planLocked ? <Unlock size={14} /> : <Lock size={14} />}{t(item.planLocked ? "Déverrouiller" : "Verrouiller")}</button>}
          {canEdit && <button type="button" className="btn primary" disabled={busy || item.planLocked} onClick={() => onRegenerate(item)}>{busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}{t("Régénérer")}</button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CalendarView({ month, items, shootDays, onOpen }: { month: string; items: Item[]; shootDays: ContentPlan["shootDays"]; onOpen: (i: Item) => void }) {
  const monthName = useMonthName();
  const { t, date } = useI18n();
  const days = daysOf(month);
  const lead = (weekdayOf(days[0]) + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const outside = shootDays.filter((s) => !s.date.startsWith(month));
  return (
    <>
    {!!outside.length && <p className="cp-shoot-note">{outside.map((s) => <span key={s.label} className="cp-shoot">🎬 {t("Tournage")} {s.label} · {date(s.date, { weekday: "short", day: "numeric", month: "short" })}</span>)}</p>}
    <div className="cp-calendar" role="grid" aria-label={monthName(month)}>
      {weekdays.map((d) => <span key={d} className="cp-cal-head">{t(weekdayLabels[d])}</span>)}
      {cells.map((day, i) => (
        <div key={i} className={`cp-cal-day${day ? "" : " outside"}`}>
          {day && <>
            <small>{Number(day.slice(8))}</small>
            {shootDays.filter((s) => s.date === day).map((s) => <span key={s.label} className="cp-shoot">🎬 {t("Tournage")} {s.label}</span>)}
            {items.filter((it) => it.due === day).map((it) => (
              <button key={it.id} type="button" className={`cp-cal-chip ${it.planType}`} onClick={() => onOpen(it)} title={it.name}>
                {it.planLocked && <Lock size={10} />}{it.name}
              </button>
            ))}
          </>}
        </div>
      ))}
    </div>
    </>
  );
}

function BoardView({ items, canEdit, onOpen, onPatch }: { items: Item[]; canEdit: boolean; onOpen: (i: Item) => void; onPatch: (i: Item, p: Record<string, unknown>) => void }) {
  const { t, date } = useI18n();
  const column = (s?: Status) => (s === "En pause" ? "En cours" : s ?? "À faire");
  return (
    <div className="cp-board">
      {boardColumns.map((col) => {
        const list = items.filter((i) => column(i.status) === col);
        return (
          <section key={col} className="cp-board-col">
            <header><StatusChip status={col} /><small>{list.length}</small></header>
            {list.map((it) => (
              <article key={it.id} className="cp-board-card">
                <button type="button" className="cp-board-open" onClick={() => onOpen(it)}>
                  <b>{it.name}</b>
                  <small>{it.due ? date(it.due, { day: "numeric", month: "short" }) : ""} · {it.planType === "reel" ? "Reel" : "Post"}{it.assignee ? ` · ${it.assignee}` : ""}</small>
                </button>
                {canEdit && (
                  <select className="cp-select" value={it.status ?? "À faire"} onChange={(e) => onPatch(it, { status: e.target.value })} aria-label={t("Statut")}>
                    {statuses.map((s) => <option key={s} value={s}>{t(s)}</option>)}
                  </select>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function PlanDetail({ workspaceId, planId, onBack, onChanged, onNotice, onError, onOpenTask }: {
  workspaceId: string; planId: string; onBack: () => void; onChanged: () => void;
  onNotice: (s: string) => void; onError: (s: string) => void; onOpenTask: (id: string) => void;
}) {
  const monthName = useMonthName();
  const { t, date } = useI18n();
  const { get, post } = useApi(workspaceId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [view, setView] = useState<"table" | "calendar" | "board">("table");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState("");

  const load = useCallback(async () => { setDetail(await get<Detail>({ planId })); }, [get, planId]);
  useEffect(() => {
    let alive = true;
    get<Detail>({ planId }).then((d) => { if (alive) setDetail(d); }).catch((e) => onError(t((e as Error).message)));
    return () => { alive = false; };
  }, [get, planId, onError, t]);

  const run = async (key: string, body: Record<string, unknown>, notice?: string) => {
    setBusy(key);
    try {
      const data = await post<{ notice?: string }>(body);
      await load(); onChanged();
      if (notice || data.notice) onNotice(t(data.notice ?? notice!));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy("");
  };
  if (!detail) return <div className="loading"><Loader2 className="spin" /></div>;
  const { plan, items, canEdit } = detail;
  const patchItem = (item: Item, patch: Record<string, unknown>) => void run(`item:${item.id}`, { action: "update-item", itemId: item.id, revision: item.revision, patch });
  const patchPlan = (patch: Record<string, unknown>) => void run("plan", { action: "update-plan", planId: plan.id, revision: plan.revision, patch });
  const regenerateItem = (item: Item) => void run(`regen:${item.id}`, { action: "regenerate-item", planId: plan.id, itemId: item.id }, "Élément régénéré.");
  const reels = items.filter((i) => i.planType === "reel").length, posts = items.filter((i) => i.planType === "post").length;
  const editable = canEdit && !plan.archived;
  const commentCount = (id: string) => detail.comments.filter((c) => c.taskId === id).length;
  const memberOptions = [{ value: "", label: "—" }, ...detail.members.map((m) => ({ value: m.userId, label: m.name }))];
  const opened = items.find((i) => i.id === open) ?? null;

  return (
    <div className="cp-detail">
      <button type="button" className="text-link back" onClick={onBack}><ArrowLeft size={14} />{t("Tous les plans")}</button>
      <div className="section-head cp-detail-head">
        <div>
          <h2>{monthName(plan.month)}{plan.archived && <span className="cp-tag">{t("Archivé")}</span>}{plan.shared && <span className="cp-tag">{t("Partagé avec le client")}</span>}</h2>
          <p className="cp-counters">
            <b className={reels === plan.quotas.reels ? "ok" : "off"}>{reels}/{plan.quotas.reels} reels</b> · <b className={posts === plan.quotas.posts ? "ok" : "off"}>{posts}/{plan.quotas.posts} posts</b>
            {plan.focus && <> · {t("Focus")} : {plan.focus}</>}
          </p>
        </div>
        <div className="inline cp-actions">
          {editable && <button type="button" className="btn" disabled={!!busy} onClick={() => { if (window.confirm(t("Régénérer tous les éléments non verrouillés, les stories, la production et les questions ?"))) void run("regen", { action: "regenerate", planId: plan.id }, "Plan régénéré (éléments non verrouillés)."); }}>{busy === "regen" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}{t("Régénérer le plan")}</button>}
          {canEdit && <button type="button" className="btn" disabled={!!busy} onClick={() => void run("dup", { action: "duplicate", planId: plan.id })}><Copy size={14} />{t("Dupliquer vers le mois suivant")}</button>}
          <a className="btn" href={`/plan-editorial/print?plan=${encodeURIComponent(plan.id)}&ws=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noopener"><FileDown size={14} />{t("Exporter PDF")}</a>
          {editable && <button type="button" className="btn" disabled={!!busy} onClick={() => void run("share", { action: plan.shared ? "unshare" : "share", planId: plan.id }, plan.shared ? "Le client ne voit plus ce plan." : "Plan partagé avec le client.")}><Share2 size={14} />{t(plan.shared ? "Ne plus partager" : "Partager avec le client")}</button>}
          {canEdit && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => { if (plan.archived || window.confirm(t("Archiver ce plan et ses tâches ? Rien n’est supprimé."))) void run("arch", { action: plan.archived ? "unarchive" : "archive", planId: plan.id }, plan.archived ? "Plan désarchivé." : "Plan archivé."); }}>{plan.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{t(plan.archived ? "Désarchiver" : "Archiver")}</button>}
        </div>
      </div>
      <div className="work-panel cp-overview">
        <h3>{t("Logique du mois")}</h3>
        <EditCell value={plan.overview} multiline disabled={!editable} onSave={(v) => patchPlan({ overview: v })} placeholder={t("Ajoutez la logique du mois…")} />
        {!!plan.warnings.length && (
          <details className="cp-warning"><summary>{t("{n} points à reprendre après la génération", { n: plan.warnings.length })}</summary><ul>{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>
        )}
        <small className="small-note">{t("Généré avec {model}", { model: plan.generatedWith })}</small>
      </div>

      <div className="cp-views" role="tablist" aria-label={t("Vue")}>
        {(["table", "calendar", "board"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{t(v === "table" ? "Table" : v === "calendar" ? "Calendrier" : "Board")}</button>
        ))}
      </div>

      {view === "table" && (
        <div className="database-card">
          <div className="table-area">
            <table className="cp-table">
              <thead><tr>
                <th>{t("Date")}</th><th>{t("Code")}</th><th>{t("Série")}</th><th>{t("Titre")}</th><th>{t("Hook")}</th><th>{t("Contenu")}</th>
                <th>{t("CTA")}</th><th>{t("Personnes")}</th><th>{t("Tournage")}</th><th>{t("Statut")}</th><th>{t("Assigné")}</th><th>{t("Drive")}</th><th aria-label={t("Actions")} />
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className={it.planLocked ? "locked" : ""}>
                    <td><EditCell type="date" value={it.due ?? ""} disabled={!editable} onSave={(v) => patchItem(it, { due: v })} /><small>{it.due ? t(weekdayLabels[weekdayOf(it.due)]) : ""}</small></td>
                    <td><span className={`cp-code ${it.planType}`}>{it.planCode}</span></td>
                    <td><EditCell value={it.planSerie} disabled={!editable} onSave={(v) => patchItem(it, { planSerie: v })} /></td>
                    <td><EditCell value={it.name} disabled={!editable} onSave={(v) => patchItem(it, { name: v })} /><small>{it.planFormat}</small></td>
                    <td dir="auto" className="cp-hook"><EditCell multiline value={it.planHook} disabled={!editable} onSave={(v) => patchItem(it, { planHook: v })} /></td>
                    <td className="cp-wide"><EditCell multiline value={it.planContent} disabled={!editable} onSave={(v) => patchItem(it, { planContent: v })} /></td>
                    <td><EditCell value={it.planCta} disabled={!editable} onSave={(v) => patchItem(it, { planCta: v })} /></td>
                    <td><EditCell value={it.planPeople.join(", ")} disabled={!editable} onSave={(v) => patchItem(it, { planPeople: v.split(",").map((x) => x.trim()).filter(Boolean) })} /></td>
                    <td><EditCell value={it.planShoot} disabled={!editable} onSave={(v) => patchItem(it, { planShoot: v })} /></td>
                    <td><EditCell value={it.status ?? "À faire"} disabled={!editable} options={statuses.map((s) => ({ value: s, label: t(s) }))} onSave={(v) => patchItem(it, { status: v })} /></td>
                    <td><EditCell value={it.assigneeId ?? ""} disabled={!editable} options={memberOptions} onSave={(v) => patchItem(it, { assigneeId: v })} /></td>
                    <td>{editable ? <EditCell value={it.deliverable ?? ""} placeholder={t("Coller un lien")} onSave={(v) => patchItem(it, { deliverable: v })} /> : it.deliverable ? <a href={it.deliverable} target="_blank" rel="noopener noreferrer">{t("Ouvrir")}</a> : "—"}</td>
                    <td className="cp-row-actions">
                      {editable && <button type="button" className="icon-button" title={t(it.planLocked ? "Déverrouiller" : "Verrouiller")} aria-label={t(it.planLocked ? "Déverrouiller" : "Verrouiller")} onClick={() => patchItem(it, { planLocked: !it.planLocked })}>{it.planLocked ? <Lock size={15} /> : <Unlock size={15} />}</button>}
                      {editable && <button type="button" className="icon-button" title={t("Régénérer")} aria-label={t("Régénérer")} disabled={!!busy || it.planLocked} onClick={() => regenerateItem(it)}>{busy === `regen:${it.id}` ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}</button>}
                      <button type="button" className="icon-button" title={t("Détails et commentaires")} aria-label={t("Détails et commentaires")} onClick={() => setOpen(it.id)}><MessageCircle size={15} />{commentCount(it.id) ? <small>{commentCount(it.id)}</small> : null}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {view === "calendar" && <CalendarView month={plan.month} items={items} shootDays={plan.shootDays} onOpen={(i) => setOpen(i.id)} />}
      {view === "board" && <BoardView items={items} canEdit={editable} onOpen={(i) => setOpen(i.id)} onPatch={patchItem} />}

      <section className="work-panel cp-section">
        <h3>{t("Stories")}</h3>
        <table className="cp-simple">
          <thead><tr><th>{t("Heure")}</th><th>{t("Story")}</th><th>{t("Jours")}</th><th>{t("Note")}</th></tr></thead>
          <tbody>{plan.stories.map((s, i) => (
            <tr key={i}><td>{s.time || "—"}</td><td dir="auto"><b>{s.name}</b></td><td>{daysText(s.days, t)}</td>
              <td><EditCell value={s.note} disabled={!editable} placeholder="—" onSave={(v) => patchPlan({ stories: plan.stories.map((x, j) => (j === i ? { ...x, note: v } : x)) })} /></td></tr>
          ))}</tbody>
        </table>
        <h4>{t("Stories spéciales")}</h4>
        {plan.specialStories.length ? (
          <ul className="cp-list">{plan.specialStories.map((s, i) => (
            <li key={i}><b>{date(s.date, { weekday: "short", day: "numeric", month: "short" })}</b> · {s.name}{s.type && <span className="cp-tag">{s.type}</span>}{s.note && <small> — {s.note}</small>}</li>
          ))}</ul>
        ) : <p className="small-note">{t("Aucune story spéciale.")}</p>}
      </section>

      <section className="work-panel cp-section">
        <h3>{t("Production")}</h3>
        <table className="cp-simple">
          <thead><tr><th>{t("Étape")}</th><th>{t("Date")}</th><th>{t("Contenu")}</th></tr></thead>
          <tbody>{plan.production.map((row, i) => (
            <tr key={i}><td><b>{row.step}</b></td><td>{row.date ? date(row.date, { weekday: "short", day: "numeric", month: "short" }) : "—"}</td>
              <td className="cp-pre"><EditCell multiline value={row.content} disabled={!editable} onSave={(v) => patchPlan({ production: plan.production.map((x, j) => (j === i ? { ...x, content: v } : x)) })} /></td></tr>
          ))}</tbody>
        </table>
        {!!plan.reserve.length && <><h4>{t("Réserve à tourner pour le mois suivant")}</h4><ul className="cp-list">{plan.reserve.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
      </section>

      <section className="work-panel cp-section">
        <h3>{t("À valider avec le client")}</h3>
        <ul className="cp-checklist">
          {plan.questions.map((q, i) => (
            <li key={i}>
              <label><input type="checkbox" checked={q.done} disabled={!editable} onChange={(e) => patchPlan({ questions: plan.questions.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} /><span className={q.done ? "done" : ""}>{q.text}</span></label>
              {editable && <button type="button" className="icon-button" aria-label={t("Retirer")} onClick={() => patchPlan({ questions: plan.questions.filter((_, j) => j !== i) })}><X size={13} /></button>}
            </li>
          ))}
        </ul>
        {editable && (
          <form className="cp-add" onSubmit={(e) => { e.preventDefault(); if (newQuestion.trim()) { patchPlan({ questions: [...plan.questions, { text: newQuestion.trim(), done: false }] }); setNewQuestion(""); } }}>
            <input value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder={t("Ajouter un point à valider…")} />
            <button type="submit" className="btn"><Plus size={14} />{t("Ajouter")}</button>
          </form>
        )}
      </section>

      <ItemDialog item={opened} detail={detail} canEdit={editable} busy={!!busy} onClose={() => setOpen(null)} onPatch={patchItem} onRegenerate={regenerateItem} onOpenTask={onOpenTask} />
    </div>
  );
}

// ---------------------------------------------------------------- the page

export default function ContentPlanPage({ workspaceId, clientId, clientName, platformOwner, onNotice, onError, onOpenTask, onRecordsChanged }: {
  workspaceId: string; clientId: string; clientName: string; platformOwner: boolean;
  onNotice: (s: string) => void; onError: (s: string) => void; onOpenTask: (id: string) => void;
  /** The plan's items are real tasks: lets the tracker refresh its own list after a change here. */
  onRecordsChanged?: () => void;
}) {
  const monthName = useMonthName();
  const { t } = useI18n();
  const { get, post } = useApi(workspaceId);
  const [data, setData] = useState<Overview | null>(null);
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try { setData(await get<Overview>({ clientId })); onRecordsChanged?.(); } catch (e) { onError(t((e as Error).message)); }
  }, [get, clientId, onError, t, onRecordsChanged]);
  useEffect(() => {
    let alive = true;
    get<Overview>({ clientId }).then((d) => { if (alive) setData(d); }).catch((e) => onError(t((e as Error).message)));
    return () => { alive = false; };
  }, [get, clientId, onError, t]);

  const saveProfile = async (profile: ContentProfile) => {
    setBusy(true);
    try { await post({ action: "save-profile", clientId, profile }); await load(); setEditing(false); onNotice(t("Profil contenu enregistré.")); }
    catch (e) { onError(t((e as Error).message)); }
    setBusy(false);
  };
  const generate = async (month: string, focus: string) => {
    setBusy(true);
    try {
      const r = await post<{ plan: ContentPlan; notice: string }>({ action: "generate", clientId, month, focus });
      await load(); setGenerating(false); setPlanId(r.plan.id); onNotice(t(r.notice));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy(false);
  };

  const plans = (data?.plans ?? []).filter((p) => showArchived || !p.archived);
  const canGenerate = !!data?.canEdit && !!data.profile && !data.gaps?.length && data.aiConfigured;

  return (
    <div className="cp-page">
      <div className="page-heading cp-heading">
        <span className="page-symbol" aria-hidden="true"><CalendarDays size={22} /></span>
        <div className="heading-line">
          <h1>{t("Plan Éditorial")}</h1>
          {!planId && data?.canEdit && (
            <button type="button" className="btn primary" disabled={!canGenerate} title={!data?.aiConfigured ? t("L’IA n’est pas configurée.") : undefined} onClick={() => setGenerating(true)}>
              <Sparkles size={15} />{t("Générer le plan")}
            </button>
          )}
        </div>
        <p>{t("Le plan éditorial mensuel de {name} : calendrier, reels, posts, stories, production et questions client.", { name: clientName })}</p>
      </div>

      {!data ? <div className="loading"><Loader2 className="spin" /></div>
        : planId ? (
          <PlanDetail workspaceId={workspaceId} planId={planId} onBack={() => { setPlanId(null); void load(); }} onChanged={load} onNotice={onNotice} onError={onError} onOpenTask={onOpenTask} />
        ) : (
          <>
            {editing
              ? <ProfileEditor initial={data.profile} platformOwner={platformOwner} busy={busy} onSave={(p) => void saveProfile(p)} onCancel={() => setEditing(false)} />
              : <ProfileSummary profile={data.profile} gaps={data.gaps} canEdit={data.canEdit} onEdit={() => setEditing(true)} />}

            <section className="work-panel cp-plans">
              <div className="section-head">
                <h2>{t("Plans")} <small>{plans.length}</small></h2>
                {data.plans.some((p) => p.archived) && <button type="button" className="btn ghost" onClick={() => setShowArchived(!showArchived)}><ChevronDown size={14} />{t(showArchived ? "Masquer les archives" : "Afficher les archives")}</button>}
              </div>
              {!plans.length ? <p className="small-note">{t("Aucun plan pour l’instant : remplissez le profil, puis « Générer le plan ».")}</p> : (
                <ul className="cp-plan-list">
                  {plans.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPlanId(p.id)}>
                        <b>{monthName(p.month)}</b>
                        <span>{t("{r}/{rq} reels · {p}/{pq} posts", { r: p.counts.reels, rq: p.quotas.reels, p: p.counts.posts, pq: p.quotas.posts })}</span>
                        {p.shared && <span className="cp-tag">{t("Partagé")}</span>}
                        {p.archived && <span className="cp-tag">{t("Archivé")}</span>}
                        {!!p.warnings.length && <span className="cp-tag warn">{t("{n} à reprendre", { n: p.warnings.length })}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {data.profile && !data.aiConfigured && <p className="cp-warning">{t("L’IA n’est pas configurée (GEMINI_API_KEY ou GROQ_API_KEY) : la génération est indisponible.")}</p>}
          </>
        )}
      {generating && data && <GenerateDialog open plans={data.plans} busy={busy} onClose={() => setGenerating(false)} onGenerate={(m, f) => void generate(m, f)} />}
    </div>
  );
}
