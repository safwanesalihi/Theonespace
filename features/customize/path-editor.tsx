"use client";
// The path (phase 4, concept A): behind the board's Processus card. Each work type is a road of stones,
// its statuses in order; a studio without work types has one road, every status. Tap a stone to rename
// it, colour it, choose what it does or move it; « + » between two stones adds a step there, one of the
// studio's statuses or a new one. Under each stone, the word the client reads in their portal.
import { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Pause, Play, Plus, Send, ShieldCheck, Timer, Trash2, X, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  behaviourHelp, behaviourLabels, behaviours, chartColorOf, colorClass, newStatusId, processSchema, statusColors,
  type Behaviour, type PortalWordKey, type StatusColor, type StatusDef, type WorkType,
} from "@/lib/process";
import { colorLabels, newId, wordDefaults, type LayerProps } from "@/features/customize/layers";

const behaviourIcons: Record<Behaviour, LucideIcon> = { todo: Circle, work: Play, paused: Pause, internal: ShieldCheck, client: Send, done: CheckCircle2 };
/** The portal's word for a step: an internal check reads as work in progress (lib/flow.ts portalStatuses). */
const clientWord = (b: Behaviour): PortalWordKey => (b === "internal" ? "work" : b);

export default function PathEditor({ draft, setDraft, usage }: LayerProps & { usage: Map<string, number> }) {
  const { t } = useI18n();
  const types = draft.workTypes ?? [];
  const [typeIndex, setTypeIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [gap, setGap] = useState<number | null>(null);
  const type: WorkType | undefined = types[Math.min(typeIndex, types.length - 1)];
  const byId = new Map(draft.statuses.map((s) => [s.id, s]));
  const road = type ? type.statusIds.map((id) => byId.get(id)!).filter(Boolean) : draft.statuses;
  const selected = picked ? byId.get(picked) : undefined;
  const word = (b: Behaviour) => draft.portal?.words?.[clientWord(b)] || t(wordDefaults[clientWord(b)]);

  // Changing the road: a typed path changes its own order; the single path is the studio's order.
  const setRoad = (ids: string[], statuses = draft.statuses) => {
    if (type) setDraft({ ...draft, statuses, workTypes: types.map((w) => (w.id === type.id ? { ...w, statusIds: ids } : w)) });
    else setDraft({ ...draft, statuses: ids.map((id) => statuses.find((s) => s.id === id)!) });
  };
  const ids = road.map((s) => s.id);
  const insert = (at: number, id: string, statuses = draft.statuses) => { const next = [...ids]; next.splice(at, 0, id); setRoad(next, statuses); setPicked(id); setGap(null); };
  const addNew = (at: number) => {
    const s: StatusDef = { id: newStatusId(), label: t("Nouvelle étape"), color: "indigo", behaviour: "work" };
    // A new status joins the studio's statuses too (after the step before it, so the single path keeps its place).
    const pool = [...draft.statuses];
    pool.splice(type ? pool.length : at, 0, s);
    if (type) insert(at, s.id, pool);
    else { setDraft({ ...draft, statuses: pool }); setPicked(s.id); setGap(null); }
  };
  const move = (id: string, by: -1 | 1) => { const i = ids.indexOf(id); const next = [...ids]; next.splice(i, 1); next.splice(i + by, 0, id); setRoad(next); };
  const patch = (id: string, p: Partial<StatusDef>) => setDraft({ ...draft, statuses: draft.statuses.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const removeFromPath = (id: string) => { setRoad(ids.filter((x) => x !== id)); setPicked(null); };
  const deleteStatus = (id: string) => {
    setDraft({ ...draft, statuses: draft.statuses.filter((s) => s.id !== id), workTypes: draft.workTypes?.map((w) => ({ ...w, statusIds: w.statusIds.filter((x) => x !== id) })) });
    setPicked(null);
  };
  // What this road still lacks, in the engine's words (lib/process.ts checkPath), for this path only.
  const pathProblem = (() => {
    if (!type) return null;
    // Only the path's own rules: fields and numbers aimed at the other types would read as missing here.
    const check = processSchema.safeParse({ ...draft, workTypes: [type], fields: undefined, dashboard: undefined });
    const own = check.success ? undefined : check.error.issues.find((i) => i.message.includes(`« ${type.label} »`));
    return own ? t(own.message) : null;
  })();
  const outside = type ? draft.statuses.filter((s) => !type.statusIds.includes(s.id)) : [];

  const plus = (at: number) => <Popover open={gap === at} onOpenChange={(o) => setGap(o ? at : null)}>
    <PopoverTrigger asChild><button type="button" className="pe-plus" aria-label={t("Ajouter une étape ici")}><Plus size={14} /></button></PopoverTrigger>
    <PopoverContent className="pe-pop" align="center">
      <button type="button" className="pe-pop-new" onClick={() => addNew(at)}><Plus size={14} />{t("Nouvelle étape")}</button>
      {outside.length > 0 && <><small>{t("Ou une de vos étapes")}</small>
        <span className="cz-chips">{outside.map((s) => <button type="button" key={s.id} className="cz-chip" onClick={() => insert(at, s.id)}><span className="cz-dot" style={{ background: chartColorOf(s.color) }} aria-hidden="true" />{s.label}</button>)}</span></>}
    </PopoverContent>
  </Popover>;

  return <div className="pe">
    <div className="pe-types" role="tablist" aria-label={t("Types de travail")}>
      {types.length ? types.map((w, i) => <button type="button" role="tab" key={w.id} aria-selected={w.id === type?.id} className={w.id === type?.id ? "on" : ""} onClick={() => { setTypeIndex(i); setPicked(null); }}>{w.label || t("Sans nom")}</button>)
        : <span className="pe-single">{t("Un seul chemin pour toutes les tâches")}</span>}
      <button type="button" className="pe-add-type" disabled={types.length >= 30} onClick={() => {
        const id = newId("wt");
        setDraft({ ...draft, workTypes: [...types, { id, label: types.length ? t("Nouveau type") : t("Contenu"), statusIds: draft.statuses.map((s) => s.id) }] });
        setTypeIndex(types.length); setPicked(null);
      }}><Plus size={14} />{t("Type de travail")}</button>
    </div>

    {type && <div className="pe-type-bar">
      <input className="cz-name" value={type.label} maxLength={40} aria-label={t("Nom du type de travail")} onChange={(e) => setDraft({ ...draft, workTypes: types.map((w) => (w.id === type.id ? { ...w, label: e.target.value } : w)) })} />
      <button type="button" className="btn ghost" onClick={() => { const rest = types.filter((w) => w.id !== type.id); setDraft({ ...draft, workTypes: rest.length ? rest : undefined }); setTypeIndex(0); setPicked(null); }}><Trash2 size={14} />{t("Supprimer ce type")}</button>
    </div>}

    <ol className="pe-road" aria-label={type ? t("Chemin de « {name} »", { name: type.label }) : t("Le chemin")}>
      <li className="pe-gap">{plus(0)}</li>
      {road.map((s, i) => {
        const Icon = behaviourIcons[s.behaviour];
        return [
          <li key={s.id} className={`pe-stone ${picked === s.id ? "on" : ""}`} style={{ "--c": chartColorOf(s.color), "--i": i } as React.CSSProperties}>
            <button type="button" aria-pressed={picked === s.id} onClick={() => setPicked(picked === s.id ? null : s.id)}>
              <span className="pe-disc"><Icon size={18} /></span>
              <strong>{s.label || t("Sans nom")}</strong>
              <small>{t("Le client lit « {word} »", { word: word(s.behaviour) })}</small>
            </button>
          </li>,
          <li key={`${s.id}+`} className="pe-gap">{plus(i + 1)}</li>,
        ];
      })}
    </ol>
    {pathProblem && <p className="cz-problem" role="alert">{pathProblem}</p>}

    {selected && <div className="pe-editor" style={{ "--c": chartColorOf(selected.color) } as React.CSSProperties}>
      <div className="pe-editor-row">
        <input className="cz-name" value={selected.label} maxLength={40} aria-label={t("Nom de l’étape")} onChange={(e) => patch(selected.id, { label: e.target.value })} autoFocus />
        <button type="button" className="icon-button" onClick={() => setPicked(null)} aria-label={t("Fermer")}><X size={15} /></button>
      </div>
      <div className="pe-behaviours" role="radiogroup" aria-label={t("Ce que fait « {name} »", { name: selected.label })}>
        {behaviours.map((b) => { const Icon = behaviourIcons[b]; return <button type="button" key={b} role="radio" aria-checked={selected.behaviour === b} className={`cz-option ${selected.behaviour === b ? "on" : ""}`}
          onClick={() => patch(selected.id, { behaviour: b, ...(b === "work" ? {} : { clock: undefined }), ...(b === "internal" ? {} : { reviewers: undefined }) })}>
          <strong><Icon size={14} />{t(behaviourLabels[b])}</strong><small>{t(behaviourHelp[b])}</small>
        </button>; })}
      </div>
      <div className="pe-editor-row">
        <span className="pe-colors" role="radiogroup" aria-label={t("Couleur de « {name} »", { name: selected.label })}>
          {statusColors.map((c) => <button type="button" key={c} role="radio" aria-checked={selected.color === c} title={t(colorLabels[c])} aria-label={t(colorLabels[c])} className={selected.color === c ? "on" : ""} style={{ background: chartColorOf(c) }} onClick={() => patch(selected.id, { color: c as StatusColor })} />)}
        </span>
        {selected.behaviour === "work" && <label className="cz-clock"><input type="checkbox" checked={selected.clock !== false} onChange={(e) => patch(selected.id, { clock: e.target.checked ? undefined : false })} /><Timer size={13} />{t("Chrono")}</label>}
      </div>
      <div className="pe-editor-row pe-actions">
        {ids.includes(selected.id) ? <>
          <button type="button" className="btn ghost" disabled={ids.indexOf(selected.id) === 0} onClick={() => move(selected.id, -1)}><ArrowLeft size={14} />{t("Avant")}</button>
          <button type="button" className="btn ghost" disabled={ids.indexOf(selected.id) === ids.length - 1} onClick={() => move(selected.id, 1)}>{t("Après")}<ArrowRight size={14} /></button>
        </> : <button type="button" className="btn" onClick={() => insert(ids.length, selected.id)}><Plus size={14} />{t("Ajouter à ce chemin")}</button>}
        {usage.get(selected.id) ? <small>{t("{n} en cours", { n: usage.get(selected.id)! })}</small> : null}
        {type && ids.includes(selected.id) && <button type="button" className="btn ghost" onClick={() => removeFromPath(selected.id)}>{t("Retirer de ce chemin")}</button>}
        <button type="button" className="btn ghost danger" disabled={draft.statuses.length === 1} onClick={() => deleteStatus(selected.id)}><Trash2 size={14} />{type ? t("Supprimer partout") : t("Supprimer")}</button>
      </div>
    </div>}

    {!type && <p className="cz-hint">{t("Un reel, un shooting, une campagne : ajoutez des types de travail pour donner à chacun son propre chemin.")}</p>}
    <details className="pe-all">
      <summary>{t("Toutes vos étapes ({n})", { n: draft.statuses.length })}</summary>
      <span className="cz-chips">{draft.statuses.map((s) => <button type="button" key={s.id} className={`cz-chip ${picked === s.id ? "on" : ""}`} onClick={() => setPicked(s.id)}>
        <span className={`cz-dot ${colorClass(s.color)}`} style={{ background: chartColorOf(s.color) }} aria-hidden="true" />{s.label}
        {types.length > 0 && <small> · {types.filter((w) => w.statusIds.includes(s.id)).length}/{types.length}</small>}
      </button>)}</span>
    </details>
  </div>;
}

