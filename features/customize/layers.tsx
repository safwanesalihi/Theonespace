"use client";
// The editors behind the « Personnaliser » board (features/customize/customize-page.tsx): one per layer of
// the studio's process (lib/process.ts). Each one changes the draft only; the board's save bar saves it.
import { ArrowDown, ArrowUp, Plus, Timer, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import WorkflowFields from "@/features/workspace/workflow-fields";
import { useI18n } from "@/lib/i18n/locale-provider";
import { builtinMetrics, defaultDashboard } from "@/lib/dashboard";
import {
  behaviourHelp, behaviourLabels, behaviours, chartColorOf, colorClass, dashboardMetricIds, defaultRules, fieldTypes, gateKeys, groupIds, groupLabels, newStatusId,
  notifyEvents, notifyRoutes, pageIds, pageLabels, portalSections, portalWordKeys, requiredPages, rulesOf, statusColors,
  type Behaviour, type DashboardMetric, type FieldDef, type FieldType, type GateKey, type NotifyChannel, type NotifyEvent, type PortalSection,
  type PortalWordKey, type Process, type StatusColor, type StatusDef, type WorkType,
} from "@/lib/process";
import { adminOnly, basePermissions, permissionLabels, permissions, roleBases, type Permission, type StudioRole } from "@/lib/roles";
import { roleLabels } from "@/lib/workspace";
import { silenceModes, type SilenceMode, type WorkflowSettings } from "@/lib/workflow-settings";

export type LayerProps = { draft: Process; setDraft: (next: Process) => void };
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export const colorLabels: Record<StatusColor, string> = {
  gray: "Gris", blue: "Bleu", slate: "Ardoise", purple: "Violet", orange: "Orange", green: "Vert",
  indigo: "Indigo", teal: "Turquoise", amber: "Ambre", pink: "Rose", red: "Rouge",
};
export const fieldTypeLabels: Record<FieldType, string> = {
  text: "Texte court", longtext: "Texte long", number: "Nombre", money: "Montant", date: "Date", choice: "Liste de choix", person: "Personne de l’équipe", link: "Lien", platform: "Réseau social",
};
export const notifyLabels: Record<NotifyEvent, string> = {
  assigned: "Une tâche est assignée", sent: "Un travail part chez le client", changes: "Le client demande des retours",
  approved: "Le client valide", message: "Un nouveau message", meeting: "Une réunion est planifiée",
};
export const channelLabels: Record<NotifyChannel, string> = { whatsapp: "WhatsApp", email: "E-mail" };
export const sectionLabels: Record<PortalSection, string> = {
  tasks: "Livrables", calendar: "Calendrier", plan: "Plan de contenu", files: "Fichiers", documents: "Documents",
  request: "Demandes", meetings: "Réunions", stats: "Statistiques", accounts: "Comptes connectés",
};
/** The client's usual word for each kind of step (lib/flow.ts portalStatuses). */
export const wordDefaults: Record<PortalWordKey, string> = { todo: "À faire", work: "En cours", paused: "En pause", client: "À valider", done: "Validé" };
export const gateLabels: Record<GateKey, string> = { brief: "Brief validé", send: "Envoi au client", validation: "Validation client", ready: "Prêt à publier" };
export const silenceLabels: Record<SilenceMode, [string, string]> = {
  approve: ["Le silence vaut accord", "Le délai passé, le travail est validé tout seul."],
  remind: ["On relance", "Le client et l’équipe sont prévenus ; le travail attend sa réponse."],
  escalate: ["On prévient les responsables", "Les responsables du studio appellent le client ; le travail attend."],
};

/** A number input that keeps an empty box empty while typing, and reports undefined for it. */
function NumberBox({ label, value, onChange, min = 0, max, suffix }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; suffix?: string }) {
  return <label className="form-field cz-number"><span>{label}</span>
    <span className="cz-number-box"><input type="number" min={min} max={max} step="any" inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />{suffix && <small>{suffix}</small>}</span>
  </label>;
}

// ---------- the flow: statuses and work types ----------

export function FlowLayer({ draft, setDraft, usage }: LayerProps & { usage: Map<string, number> }) {
  const { t } = useI18n();
  const setStatuses = (statuses: StatusDef[]) => setDraft({ ...draft, statuses, workTypes: draft.workTypes?.map((w) => ({ ...w, statusIds: w.statusIds.filter((id) => statuses.some((s) => s.id === id)) })) });
  const patch = (i: number, p: Partial<StatusDef>) => setStatuses(draft.statuses.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, by: -1 | 1) => { const next = [...draft.statuses]; const [s] = next.splice(i, 1); next.splice(i + by, 0, s); setStatuses(next); };
  const types = draft.workTypes ?? [];
  const setTypes = (workTypes: WorkType[]) => setDraft({ ...draft, workTypes: workTypes.length ? workTypes : undefined });
  return <div className="cz-layer">
    <ol className="cz-statuses">
      {draft.statuses.map((s, i) => <li key={s.id}>
        <span className="cz-order">
          <button type="button" className="icon-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Monter « {name} »", { name: s.label })}><ArrowUp size={14} /></button>
          <button type="button" className="icon-button" disabled={i === draft.statuses.length - 1} onClick={() => move(i, 1)} aria-label={t("Descendre « {name} »", { name: s.label })}><ArrowDown size={14} /></button>
        </span>
        <Select value={s.color} onValueChange={(v) => patch(i, { color: v as StatusColor })}>
          <SelectTrigger className="pick cz-color" aria-label={t("Couleur de « {name} »", { name: s.label })}><span className={`status ${colorClass(s.color)} cz-swatch`} aria-hidden="true" /></SelectTrigger>
          <SelectContent>{statusColors.map((c) => <SelectItem key={c} value={c}><span className="inline"><span className={`status ${colorClass(c)} cz-swatch`} aria-hidden="true" />{t(colorLabels[c])}</span></SelectItem>)}</SelectContent>
        </Select>
        <input className="cz-name" value={s.label} maxLength={40} aria-label={t("Nom du statut")} onChange={(e) => patch(i, { label: e.target.value })} />
        <Select value={s.behaviour} onValueChange={(v) => patch(i, { behaviour: v as Behaviour, ...(v === "work" ? {} : { clock: undefined }), ...(v === "internal" ? {} : { reviewers: undefined }) })}>
          <SelectTrigger className="pick cz-behaviour" aria-label={t("Ce que fait « {name} »", { name: s.label })}><SelectValue>{t(behaviourLabels[s.behaviour])}</SelectValue></SelectTrigger>
          <SelectContent>{behaviours.map((b) => <SelectItem key={b} value={b}><span className="cz-behaviour-item"><strong>{t(behaviourLabels[b])}</strong><small>{t(behaviourHelp[b])}</small></span></SelectItem>)}</SelectContent>
        </Select>
        {s.behaviour === "work"
          ? <label className="cz-clock" title={t("Le chrono de la personne tourne dans ce statut")}><input type="checkbox" checked={s.clock !== false} onChange={(e) => patch(i, { clock: e.target.checked ? undefined : false })} /><Timer size={13} />{t("Chrono")}</label>
          : <span className="cz-clock" />}
        <small className="cz-count">{usage.get(s.id) ? t("{n} en cours", { n: usage.get(s.id)! }) : ""}</small>
        <button type="button" className="icon-button cz-remove" disabled={draft.statuses.length === 1} onClick={() => setStatuses(draft.statuses.filter((_, j) => j !== i))} aria-label={t("Supprimer « {name} »", { name: s.label })}><Trash2 size={14} /></button>
      </li>)}
    </ol>
    <button type="button" className="btn" onClick={() => setStatuses([...draft.statuses, { id: newStatusId(), label: t("Nouveau statut"), color: "indigo", behaviour: "work" }])} disabled={draft.statuses.length >= 40}><Plus size={15} />{t("Ajouter un statut")}</button>

    <h3 className="cz-subhead">{t("Types de travail")}</h3>
    <p className="cz-hint">{t("Un reel, un shooting, une campagne : chaque type suit son propre chemin parmi vos statuts. Sans type, toutes les tâches suivent tous les statuts.")}</p>
    <ul className="cz-types">
      {types.map((w, i) => <li key={w.id}>
        <span className="cz-type-head">
          <input className="cz-name" value={w.label} maxLength={40} aria-label={t("Nom du type de travail")} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button type="button" className="icon-button" onClick={() => setTypes(types.filter((_, j) => j !== i))} aria-label={t("Supprimer « {name} »", { name: w.label })}><Trash2 size={14} /></button>
        </span>
        <span className="cz-stones" role="group" aria-label={t("Chemin de « {name} »", { name: w.label })}>
          {draft.statuses.map((s) => {
            const on = w.statusIds.includes(s.id);
            // The path keeps the studio's order: a status switched on takes its place in it.
            const toggle = () => setTypes(types.map((x, j) => (j === i ? { ...x, statusIds: on ? x.statusIds.filter((id) => id !== s.id) : draft.statuses.map((st) => st.id).filter((id) => id === s.id || x.statusIds.includes(id)) } : x)));
            return <button type="button" key={s.id} className={`cz-stone ${on ? "on" : ""}`} aria-pressed={on} onClick={toggle}><span className="cz-dot" style={{ background: chartColorOf(s.color) }} aria-hidden="true" />{s.label}</button>;
          })}
        </span>
      </li>)}
    </ul>
    <button type="button" className="btn" disabled={types.length >= 30} onClick={() => setTypes([...types, { id: newId("wt"), label: types.length ? t("Nouveau type") : t("Contenu"), statusIds: draft.statuses.map((s) => s.id) }])}><Plus size={15} />{t("Ajouter un type de travail")}</button>
  </div>;
}

// ---------- the checks: who passes each internal validation ----------

export function ChecksLayer({ draft, setDraft }: LayerProps) {
  const { t } = useI18n();
  const checks = draft.statuses.filter((s) => s.behaviour === "internal");
  const roles = draft.roles ?? [];
  if (!checks.length) return <p className="cz-empty">{t("Aucune validation interne : ajoutez un statut « Validation interne » dans la carte Processus pour faire relire le travail avant le client.")}</p>;
  return <div className="cz-layer">
    <p className="cz-hint">{t("Les validations se passent dans l’ordre du chemin. Sans rôle choisi, toute personne qui peut valider en interne la passe ; le propriétaire peut toujours.")}</p>
    <ol className="cz-chain">
      {checks.map((s) => <li key={s.id}>
        <strong><span className="cz-dot" style={{ background: chartColorOf(s.color) }} aria-hidden="true" />{s.label}</strong>
        {roles.length ? <span className="cz-chips">{roles.map((r) => {
          const on = !!s.reviewers?.includes(r.id);
          const reviewers = on ? s.reviewers!.filter((id) => id !== r.id) : [...(s.reviewers ?? []), r.id];
          return <button type="button" key={r.id} className={`cz-chip ${on ? "on" : ""}`} aria-pressed={on}
            onClick={() => setDraft({ ...draft, statuses: draft.statuses.map((x) => (x.id === s.id ? { ...x, reviewers: reviewers.length ? reviewers : undefined } : x)) })}>{r.label}</button>;
        })}</span> : <small>{t("Créez des rôles (carte Rôles) pour réserver cette validation à certains.")}</small>}
      </li>)}
    </ol>
  </div>;
}

// ---------- the calendar and the client's validation ----------

export function RulesLayer({ draft, setDraft, rules, setRules }: LayerProps & { rules: WorkflowSettings; setRules: (next: WorkflowSettings) => void }) {
  const { t } = useI18n();
  const current = rulesOf(draft);
  const setRule = (patch: Partial<Omit<typeof current, "gates">> & { gates?: Partial<Record<GateKey, number>> }) =>
    setDraft({ ...draft, rules: { ...draft.rules, ...patch, gates: patch.gates ? { ...draft.rules?.gates, ...patch.gates } : draft.rules?.gates } });
  const silence = rules.onSilence ?? "approve";
  return <div className="cz-layer">
    <h3 className="cz-subhead">{t("Quand le client ne répond pas")}</h3>
    <div className="cz-cards3" role="radiogroup" aria-label={t("Quand le client ne répond pas")}>
      {silenceModes.map((m) => <button type="button" key={m} role="radio" aria-checked={silence === m} className={`cz-option ${silence === m ? "on" : ""}`} onClick={() => setRules({ ...rules, onSilence: m === "approve" ? undefined : m })}>
        <strong>{t(silenceLabels[m][0])}</strong><small>{t(silenceLabels[m][1])}</small>
      </button>)}
    </div>
    <WorkflowFields value={rules} onChange={setRules} />

    <h3 className="cz-subhead">{t("Le calendrier")}</h3>
    <div className="form-pair">
      <NumberBox label={t("Gel avant publication")} suffix={t("jours")} max={30} value={current.lockDays} onChange={(v) => setRule({ lockDays: v ?? defaultRules.lockDays })} />
      <NumberBox label={t("Archivage après validation")} suffix={t("jours")} max={365} value={current.archiveAfterDays} onChange={(v) => setRule({ archiveAfterDays: v ?? defaultRules.archiveAfterDays })} />
    </div>
    <p className="cz-hint">{t("0 jour de gel : rien n’est figé. 0 jour d’archivage : le travail validé reste dans les listes.")}</p>
    <h3 className="cz-subhead">{t("Les étapes, comptées avant la date de publication")}</h3>
    <ol className="cz-gates">
      {gateKeys.map((g) => <li key={g}><span>{t(gateLabels[g])}</span>
        <span className="cz-number-box"><small>J −</small><input type="number" min={0} max={90} aria-label={t(gateLabels[g])} value={current.gates[g]} onChange={(e) => setRule({ gates: { [g]: e.target.value === "" ? defaultRules.gates[g] : Number(e.target.value) } })} /></span>
      </li>)}
    </ol>
  </div>;
}

// ---------- the studio's own fields ----------

export function FieldsLayer({ draft, setDraft }: LayerProps) {
  const { t } = useI18n();
  const fields = draft.fields ?? [];
  const types = draft.workTypes ?? [];
  const set = (next: FieldDef[]) => setDraft({ ...draft, fields: next.length ? next : undefined });
  const patch = (i: number, p: Partial<FieldDef>) => set(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  return <div className="cz-layer">
    <p className="cz-hint">{t("Ce que votre agence note sur chaque tâche : un budget pub, un mot-clé, le cachet d’un influenceur… Un nombre ou un montant peut aussi devenir un chiffre du tableau de bord.")}</p>
    <ul className="cz-fields">
      {fields.map((f, i) => <li key={f.id}>
        <span className="cz-field-head">
          <input className="cz-name" value={f.label} maxLength={40} aria-label={t("Nom du champ")} onChange={(e) => patch(i, { label: e.target.value })} />
          <Select value={f.type} onValueChange={(v) => patch(i, { type: v as FieldType, options: v === "choice" ? f.options ?? [] : undefined, unit: v === "number" || v === "money" ? f.unit : undefined })}>
            <SelectTrigger className="pick" aria-label={t("Type de « {name} »", { name: f.label })}><SelectValue /></SelectTrigger>
            <SelectContent>{fieldTypes.map((ft) => <SelectItem key={ft} value={ft}>{t(fieldTypeLabels[ft])}</SelectItem>)}</SelectContent>
          </Select>
          <button type="button" className="icon-button" onClick={() => set(fields.filter((_, j) => j !== i))} aria-label={t("Supprimer « {name} »", { name: f.label })}><Trash2 size={14} /></button>
        </span>
        {f.type === "choice" && <label className="form-field"><span>{t("Choix, séparés par des virgules")}</span>
          <input value={(f.options ?? []).join(", ")} onChange={(e) => patch(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean).slice(0, 30) })} /></label>}
        {(f.type === "number" || f.type === "money") && <label className="form-field cz-unit"><span>{t("Unité")}</span><input value={f.unit ?? ""} maxLength={12} placeholder={f.type === "money" ? "MAD" : "km"} onChange={(e) => patch(i, { unit: e.target.value || undefined })} /></label>}
        <span className="cz-chips">
          <label className="cz-switch"><input type="checkbox" checked={!!f.client} onChange={(e) => patch(i, { client: e.target.checked || undefined })} />{t("Visible par le client")}</label>
          {types.length > 0 && <span className="cz-chips" role="group" aria-label={t("Types de travail de « {name} »", { name: f.label })}>
            <small>{t("Pour")}</small>
            {types.map((w) => {
              const on = !!f.workTypes?.includes(w.id);
              const next = on ? f.workTypes!.filter((id) => id !== w.id) : [...(f.workTypes ?? []), w.id];
              return <button type="button" key={w.id} className={`cz-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => patch(i, { workTypes: next.length ? next : undefined })}>{w.label}</button>;
            })}
            {!f.workTypes?.length && <small>{t("(tous)")}</small>}
          </span>}
        </span>
      </li>)}
    </ul>
    <button type="button" className="btn" disabled={fields.length >= 40} onClick={() => set([...fields, { id: newId("f"), label: t("Nouveau champ"), type: "text" }])}><Plus size={15} />{t("Ajouter un champ")}</button>
  </div>;
}

// ---------- the studio's own roles ----------

export function RolesLayer({ draft, setDraft }: LayerProps) {
  const { t } = useI18n();
  const roles = draft.roles ?? [];
  const set = (next: StudioRole[]) => {
    // A role removed is no longer anyone's check.
    const ids = new Set(next.map((r) => r.id));
    setDraft({ ...draft, roles: next.length ? next : undefined, statuses: draft.statuses.map((s) => (s.reviewers ? { ...s, reviewers: s.reviewers.filter((id) => ids.has(id)).length ? s.reviewers.filter((id) => ids.has(id)) : undefined } : s)) });
  };
  const patch = (i: number, p: Partial<StudioRole>) => set(roles.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return <div className="cz-layer">
    <p className="cz-hint">{t("Account manager, media buyer, freelance… Un rôle part d’un rôle de base et ajoute ou retire des droits. Attribuez-le ensuite dans Équipe.")}</p>
    <ul className="cz-roles">
      {roles.map((r, i) => {
        const base = new Set<Permission>(basePermissions[r.base]);
        const has = (p: Permission) => (base.has(p) ? !r.revoke?.includes(p) : !!r.grant?.includes(p));
        const toggle = (p: Permission) => {
          if (base.has(p)) { const revoke = has(p) ? [...(r.revoke ?? []), p] : (r.revoke ?? []).filter((x) => x !== p); patch(i, { revoke: revoke.length ? revoke : undefined }); }
          else { const grant = has(p) ? (r.grant ?? []).filter((x) => x !== p) : [...(r.grant ?? []), p]; patch(i, { grant: grant.length ? grant : undefined }); }
        };
        return <li key={r.id}>
          <span className="cz-field-head">
            <input className="cz-name" value={r.label} maxLength={40} aria-label={t("Nom du rôle")} onChange={(e) => patch(i, { label: e.target.value })} />
            <Select value={r.base} onValueChange={(v) => patch(i, { base: v as StudioRole["base"], grant: undefined, revoke: undefined })}>
              <SelectTrigger className="pick" aria-label={t("Rôle de base de « {name} »", { name: r.label })}><SelectValue /></SelectTrigger>
              <SelectContent>{roleBases.map((b) => <SelectItem key={b} value={b}>{t("Base : {role}", { role: t(roleLabels[b]) })}</SelectItem>)}</SelectContent>
            </Select>
            <button type="button" className="icon-button" onClick={() => set(roles.filter((_, j) => j !== i))} aria-label={t("Supprimer « {name} »", { name: r.label })}><Trash2 size={14} /></button>
          </span>
          <span className="cz-chips">{permissions.map((p) => {
            const locked = !base.has(p) && (r.base === "viewer" || (adminOnly.includes(p) && r.base !== "admin"));
            return <button type="button" key={p} className={`cz-chip ${has(p) ? "on" : ""}`} aria-pressed={has(p)} disabled={locked} onClick={() => toggle(p)}>{t(permissionLabels[p])}</button>;
          })}</span>
        </li>;
      })}
    </ul>
    <button type="button" className="btn" disabled={roles.length >= 20} onClick={() => set([...roles, { id: newId("role"), label: t("Nouveau rôle"), base: "creative" }])}><Plus size={15} />{t("Ajouter un rôle")}</button>
  </div>;
}

// ---------- the automatic messages ----------

export function NotificationsLayer({ draft, setDraft }: LayerProps) {
  const { t } = useI18n();
  const set = (e: NotifyEvent, c: NotifyChannel, on: boolean) => {
    const next = { ...draft.notifications, [e]: { ...draft.notifications?.[e], [c]: on ? undefined : false } };
    // Back to all on: nothing to keep.
    const kept = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x === false))]).filter(([, v]) => Object.keys(v).length));
    setDraft({ ...draft, notifications: Object.keys(kept).length ? kept : undefined });
  };
  return <div className="cz-layer">
    <p className="cz-hint">{t("Les messages que l’app envoie toute seule. Les notifications dans l’app restent toujours : c’est l’historique.")}</p>
    <ul className="cz-notify">
      {notifyEvents.map((e) => <li key={e}><span>{t(notifyLabels[e])}</span>
        <span className="cz-chips">{notifyRoutes[e].map((c) => {
          const on = draft.notifications?.[e]?.[c] !== false;
          return <button type="button" key={c} className={`cz-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => set(e, c, !on)}>{channelLabels[c]}</button>;
        })}</span>
      </li>)}
    </ul>
  </div>;
}

// ---------- the client's portal ----------

export function PortalLayer({ draft, setDraft }: LayerProps) {
  const { t } = useI18n();
  const portal = draft.portal ?? {};
  const set = (next: typeof portal) => {
    const clean = { ...next };
    if (clean.sections && !Object.values(clean.sections).some((v) => v === false)) delete clean.sections;
    if (clean.words && !Object.values(clean.words).some(Boolean)) delete clean.words;
    if (!clean.welcome) delete clean.welcome;
    setDraft({ ...draft, portal: Object.keys(clean).length ? clean : undefined });
  };
  return <div className="cz-layer">
    <h3 className="cz-subhead">{t("Les pages de vos clients")}</h3>
    <p className="cz-hint">{t("L’accueil et « À valider » restent toujours.")}</p>
    <span className="cz-chips">{portalSections.map((s) => {
      const on = portal.sections?.[s] !== false;
      return <button type="button" key={s} className={`cz-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => set({ ...portal, sections: { ...portal.sections, [s]: on ? false : undefined } })}>{t(sectionLabels[s])}</button>;
    })}</span>
    <h3 className="cz-subhead">{t("Vos mots pour le client")}</h3>
    <div className="cz-words">
      {portalWordKeys.map((k) => <label key={k} className="form-field"><span>{t(wordDefaults[k])}</span>
        <input value={portal.words?.[k] ?? ""} maxLength={30} placeholder={t(wordDefaults[k])} onChange={(e) => set({ ...portal, words: { ...portal.words, [k]: e.target.value || undefined } })} /></label>)}
    </div>
    <label className="form-field"><span>{t("Message d’accueil")}</span>
      <textarea rows={3} maxLength={280} value={portal.welcome ?? ""} placeholder={t("Bienvenue ! Tout votre contenu est ici.")} onChange={(e) => set({ ...portal, welcome: e.target.value || undefined })} /></label>
  </div>;
}

// ---------- the dashboard's numbers ----------

export function DashboardLayer({ draft, setDraft }: LayerProps) {
  const { t } = useI18n();
  const chosen = draft.dashboard?.metrics ?? defaultDashboard;
  const totals = (draft.fields ?? []).filter((f) => f.type === "number" || f.type === "money");
  const library: { id: string; label: string; share?: boolean; atMost?: boolean }[] = [
    ...dashboardMetricIds.map((id) => ({ id, label: t(builtinMetrics[id].label), share: builtinMetrics[id].kind === "share", atMost: "atMost" in builtinMetrics[id] })),
    ...totals.map((f) => ({ id: `field:${f.id}`, label: t("Total « {name} »", { name: f.label }) })),
  ];
  const set = (metrics: DashboardMetric[]) => setDraft({ ...draft, dashboard: { metrics } });
  const patch = (id: string, p: Partial<DashboardMetric>) => set(chosen.map((m) => (m.id === id ? { ...m, ...p } : m)));
  return <div className="cz-layer">
    <p className="cz-hint">{t("Six chiffres au plus, chacun avec votre cible. Un pourcentage se saisit en % (95 pour 95 %).")}</p>
    <ul className="cz-metrics">
      {library.map((m) => {
        const pick = chosen.find((c) => c.id === m.id);
        const toPercent = (v?: number) => (v === undefined ? undefined : m.share ? Math.round(v * 1000) / 10 : v);
        return <li key={m.id} className={pick ? "on" : ""}>
          <label className="cz-switch"><input type="checkbox" checked={!!pick} disabled={!pick && chosen.length >= 6} onChange={(e) => set(e.target.checked ? [...chosen, { id: m.id }] : chosen.filter((c) => c.id !== m.id))} />{m.label}</label>
          {pick && <span className="cz-metric-target">
            <Select value={(pick.atMost ?? !!m.atMost) ? "max" : "min"} onValueChange={(v) => patch(m.id, { atMost: (v === "max") === !!m.atMost ? undefined : v === "max" })}>
              <SelectTrigger className="pick" aria-label={t("Sens de la cible")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="min">≥</SelectItem><SelectItem value="max">≤</SelectItem></SelectContent>
            </Select>
            <span className="cz-number-box"><input type="number" min={0} step="any" aria-label={t("Cible de « {name} »", { name: m.label })} value={toPercent(pick.target) ?? ""}
              onChange={(e) => patch(m.id, { target: e.target.value === "" ? undefined : m.share ? Number(e.target.value) / 100 : Number(e.target.value) })} />{m.share && <small>%</small>}</span>
          </span>}
        </li>;
      })}
    </ul>
  </div>;
}

// ---------- the pages of the studio ----------

export function PagesLayer({ draft, setDraft }: LayerProps) {
  const { t } = useI18n();
  return <div className="cz-layer">
    <div className="cz-groups">
      {groupIds.map((g) => <label key={g} className="form-field"><span>{t("Groupe « {name} »", { name: t(groupLabels[g]) })}</span>
        <input value={draft.groups[g]?.label ?? ""} maxLength={40} placeholder={t(groupLabels[g])} onChange={(e) => setDraft({ ...draft, groups: { ...draft.groups, [g]: { label: e.target.value || undefined } } })} /></label>)}
    </div>
    <ul className="cz-pages">
      {pageIds.map((id) => {
        const page = draft.pages[id];
        const set = (p: Partial<typeof page>) => setDraft({ ...draft, pages: { ...draft.pages, [id]: { ...page, ...p } } });
        return <li key={id} className={page.on ? "" : "off"}>
          <label className="cz-switch"><input type="checkbox" checked={page.on} disabled={requiredPages.includes(id)} onChange={(e) => set({ on: e.target.checked })} /><span>{t(pageLabels[id])}</span></label>
          <input value={page.label ?? ""} maxLength={40} placeholder={t(pageLabels[id])} aria-label={t("Nom de la page « {name} »", { name: t(pageLabels[id]) })} disabled={!page.on} onChange={(e) => set({ label: e.target.value || undefined })} />
          <Select value={page.group} onValueChange={(v) => set({ group: v as typeof page.group })} disabled={!page.on}>
            <SelectTrigger className="pick" aria-label={t("Groupe de « {name} »", { name: t(pageLabels[id]) })}><SelectValue /></SelectTrigger>
            <SelectContent>{groupIds.map((g) => <SelectItem key={g} value={g}>{draft.groups[g]?.label || t(groupLabels[g])}</SelectItem>)}</SelectContent>
          </Select>
        </li>;
      })}
    </ul>
  </div>;
}
