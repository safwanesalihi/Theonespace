"use client";
// The editors behind the « Personnaliser » board (features/customize/customize-page.tsx): one per layer of
// the studio's process (lib/process.ts). Each one changes the draft only; the board's save bar saves it.
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import WorkflowFields from "@/features/workspace/workflow-fields";
import { useI18n } from "@/lib/i18n/locale-provider";
import { builtinMetrics, defaultDashboard } from "@/lib/dashboard";
import {
  chartColorOf, dashboardMetricIds, defaultRules, fieldTypes, gateKeys, groupIds, groupLabels,
  notifyEvents, notifyRoutes, pageIds, pageLabels, portalSections, portalWordKeys, requiredPages, rulesOf,
  type DashboardMetric, type FieldDef, type FieldType, type GateKey, type NotifyChannel, type NotifyEvent, type PortalSection,
  type PortalWordKey, type Process, type StatusColor,
} from "@/lib/process";
import { adminOnly, basePermissions, permissionLabels, permissions, roleBases, type Permission, type StudioRole } from "@/lib/roles";
import { roleLabels } from "@/lib/workspace";
import { silenceModes, type SilenceMode, type WorkflowSettings } from "@/lib/workflow-settings";

export type LayerProps = { draft: Process; setDraft: (next: Process) => void };
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

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

/**
 * A number box that keeps what is typed: it can be emptied and retyped (« 7 » → « » → « 3 »). Each valid number
 * reaches the draft as it is typed; a box left empty reports undefined when the person leaves it.
 */
export function NumberInput({ value, onChange, min = 0, max, label }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; label?: string }) {
  const shown = value === undefined ? "" : String(value);
  const [raw, setRaw] = useState(shown);
  const [seen, setSeen] = useState(value);
  // A value changed elsewhere (a template, « Annuler ») replaces what was typed.
  if (seen !== value) { setSeen(value); if (raw === "" || Number(raw) !== value) setRaw(shown); }
  return <input type="number" min={min} max={max} step="any" inputMode="decimal" aria-label={label} value={raw}
    onChange={(e) => { setRaw(e.target.value); if (e.target.value !== "" && Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value)); }}
    onBlur={() => { if (raw === "") onChange(undefined); setRaw(value === undefined ? "" : String(value)); }} />;
}
function NumberBox({ label, value, onChange, min = 0, max, suffix }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; suffix?: string }) {
  return <label className="form-field cz-number"><span>{label}</span>
    <span className="cz-number-box"><NumberInput value={value} onChange={onChange} min={min} max={max} />{suffix && <small>{suffix}</small>}</span>
  </label>;
}
/** A comma-separated list typed freely (« Instagram, » keeps its comma); the draft gets the clean list. */
function ListInput({ value, onChange, max }: { value: string[]; onChange: (v: string[]) => void; max: number }) {
  const [raw, setRaw] = useState(value.join(", "));
  const parse = (text: string) => text.split(",").map((o) => o.trim()).filter(Boolean).slice(0, max);
  return <input value={raw} onChange={(e) => { setRaw(e.target.value); onChange(parse(e.target.value)); }} onBlur={() => setRaw(parse(raw).join(", "))} />;
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
        <span className="cz-number-box"><small>J −</small><NumberInput min={0} max={90} label={t(gateLabels[g])} value={current.gates[g]} onChange={(v) => setRule({ gates: { [g]: v ?? defaultRules.gates[g] } })} /></span>
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
          <ListInput value={f.options ?? []} max={30} onChange={(options) => patch(i, { options })} /></label>}
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
