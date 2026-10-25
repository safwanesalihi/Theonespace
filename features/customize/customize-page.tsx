"use client";
// « Personnaliser » — the owner shapes the studio's process (lib/process.ts): its statuses (any name,
// colour, number and order, each with what it does), the pages the studio uses (on or off, their names
// and groups), the client's validation rules, and a ready-made model to start again from. Nothing is
// saved until « Enregistrer »; a status removed while tasks use it asks where those tasks go.
import { Surface } from "@/components/ui/surface";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Timer, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import WorkflowFields from "@/features/workspace/workflow-fields";
import { useProcess } from "@/features/workspace/process-context";
import type { ScreenProps } from "@/features/workspace/screen-props";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  behaviourHelp, behaviourLabels, behaviours, colorClass, groupIds, groupLabels, newStatusId, pageIds, pageLabels, processSchema, requiredPages,
  statusColors, type Behaviour, type Process, type StatusColor, type StatusDef,
} from "@/lib/process";
import { presetProcess, presets } from "@/lib/process-presets";
import { workflowSettingsSchema, type WorkflowSettings } from "@/lib/workflow-settings";

const colorLabels: Record<StatusColor, string> = {
  gray: "Gris", blue: "Bleu", slate: "Ardoise", purple: "Violet", orange: "Orange", green: "Vert",
  indigo: "Indigo", teal: "Turquoise", amber: "Ambre", pink: "Rose", red: "Rouge",
};
type Replacement = { id: string; label: string; count: number };

export default function CustomizePage({ data, actions }: Pick<ScreenProps, "data" | "actions">) {
  const { t } = useI18n();
  const process = useProcess();
  const { records, processRevision, workflowSettings, workflowRevision } = data;
  const { mutate, setError, setNotice } = actions;
  const [draft, setDraft] = useState<Process>(() => structuredClone(process));
  const [base, setBase] = useState(process);
  const [saving, setSaving] = useState(false);
  const [replace, setReplace] = useState<{ statuses: Replacement[]; choice: Record<string, string> } | null>(null);
  const [rules, setRules] = useState<WorkflowSettings>(workflowSettings);
  const [rulesBase, setRulesBase] = useState(workflowSettings);
  const [rulesBusy, setRulesBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(process);
  // A save elsewhere (or this one) brings a new process: start again from it unless changes are pending.
  if (base !== process) { setBase(process); if (!dirty || saving) setDraft(structuredClone(process)); }
  if (rulesBase !== workflowSettings) { setRulesBase(workflowSettings); setRules(workflowSettings); }

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) if ((r.kind === "task" || r.kind === "plan_item") && !r.archived && r.status) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return counts;
  }, [records]);
  const check = processSchema.safeParse(draft);
  const problem = check.success ? "" : t(check.error.issues[0]?.message ?? "");

  const setStatuses = (statuses: StatusDef[]) => setDraft({ ...draft, statuses });
  const patchStatus = (index: number, patch: Partial<StatusDef>) => setStatuses(draft.statuses.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...draft.statuses];
    const [s] = next.splice(index, 1);
    next.splice(index + by, 0, s);
    setStatuses(next);
  };
  const add = () => setStatuses([...draft.statuses, { id: newStatusId(), label: t("Nouveau statut"), color: "indigo", behaviour: "work" }]);

  async function save(replacements?: Record<string, string>) {
    if (!check.success) { setError(problem); return; }
    setSaving(true);
    try {
      await mutate({ action: "process-save", data: draft, revision: processRevision, ...(replacements ? { replacements } : {}) });
      setReplace(null);
      setNotice(t("Processus du studio enregistré"));
    } catch (error) {
      const err = error as Error & { code?: string; details?: { statuses?: Replacement[] } };
      if (err.code === "replace" && err.details?.statuses?.length) setReplace({ statuses: err.details.statuses, choice: {} });
      else setError(t(err.message));
    } finally { setSaving(false); }
  }
  async function saveRules() {
    const parsed = workflowSettingsSchema.safeParse(rules);
    if (!parsed.success) { setError(t("Indiquez un délai entre 1 minute et 365 jours et un nombre entier de tours entre 0 et 10 000.")); return; }
    setRulesBusy(true);
    try { await mutate({ action: "set-workflow-settings", data: parsed.data, revision: workflowRevision }); setNotice(t("Règles de validation enregistrées")); }
    catch (error) { setError(t((error as Error).message)); }
    finally { setRulesBusy(false); }
  }

  return <div className="customize-page">
    <div className="page-heading">
      <div className="heading-line"><h1>{t("Personnaliser")}</h1></div>
      <p>{t("Le processus de votre studio : vos statuts, ce que chacun déclenche, et les pages que votre équipe utilise. S’applique à tout le studio.")}</p>
    </div>

    <Surface asChild tone="default"><section className="cz-panel" aria-labelledby="cz-statuses">
      <header>
        <h2 id="cz-statuses">{t("Statuts des tâches")}</h2>
        <p>{t("Nommez vos étapes et choisissez ce que fait chacune : le chrono, la validation interne, l’envoi au client, la fin.")}</p>
      </header>
      <ol className="cz-statuses">
        {draft.statuses.map((s, i) => <li key={s.id}>
          <span className="cz-order">
            <button type="button" className="icon-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Monter « {name} »", { name: s.label })}><ArrowUp size={14} /></button>
            <button type="button" className="icon-button" disabled={i === draft.statuses.length - 1} onClick={() => move(i, 1)} aria-label={t("Descendre « {name} »", { name: s.label })}><ArrowDown size={14} /></button>
          </span>
          <Select value={s.color} onValueChange={(v) => patchStatus(i, { color: v as StatusColor })}>
            <SelectTrigger className="pick cz-color" aria-label={t("Couleur de « {name} »", { name: s.label })}><span className={`status ${colorClass(s.color)} cz-swatch`} aria-hidden="true" /></SelectTrigger>
            <SelectContent>{statusColors.map((c) => <SelectItem key={c} value={c}><span className="inline"><span className={`status ${colorClass(c)} cz-swatch`} aria-hidden="true" />{t(colorLabels[c])}</span></SelectItem>)}</SelectContent>
          </Select>
          <input className="cz-name" value={s.label} maxLength={40} aria-label={t("Nom du statut")} onChange={(e) => patchStatus(i, { label: e.target.value })} />
          <Select value={s.behaviour} onValueChange={(v) => patchStatus(i, { behaviour: v as Behaviour, ...(v === "work" ? {} : { clock: undefined }) })}>
            <SelectTrigger className="pick cz-behaviour" aria-label={t("Ce que fait « {name} »", { name: s.label })}><SelectValue /></SelectTrigger>
            <SelectContent>{behaviours.map((b) => <SelectItem key={b} value={b}><span className="cz-behaviour-item"><strong>{t(behaviourLabels[b])}</strong><small>{t(behaviourHelp[b])}</small></span></SelectItem>)}</SelectContent>
          </Select>
          {s.behaviour === "work"
            ? <label className="cz-clock" title={t("Le chrono de la personne tourne dans ce statut")}><input type="checkbox" checked={s.clock !== false} onChange={(e) => patchStatus(i, { clock: e.target.checked ? undefined : false })} /><Timer size={13} />{t("Chrono")}</label>
            : <span className="cz-clock" />}
          <small className="cz-count">{usage.get(s.id) ? t("{n} en cours", { n: usage.get(s.id)! }) : ""}</small>
          <button type="button" className="icon-button cz-remove" disabled={draft.statuses.length === 1} onClick={() => setStatuses(draft.statuses.filter((_, j) => j !== i))} aria-label={t("Supprimer « {name} »", { name: s.label })}><Trash2 size={14} /></button>
        </li>)}
      </ol>
      <button type="button" className="btn" onClick={add} disabled={draft.statuses.length >= 20}><Plus size={15} />{t("Ajouter un statut")}</button>
      {problem && <p className="cz-problem" role="alert">{problem}</p>}
    </section></Surface>

    <Surface asChild tone="default"><section className="cz-panel" aria-labelledby="cz-pages">
      <header>
        <h2 id="cz-pages">{t("Pages du studio")}</h2>
        <p>{t("Activez les pages que votre studio utilise, renommez-les et rangez-les dans la barre latérale.")}</p>
      </header>
      <div className="cz-groups">
        {groupIds.map((g) => <label key={g} className="form-field"><span>{t("Groupe « {name} »", { name: t(groupLabels[g]) })}</span>
          <input value={draft.groups[g]?.label ?? ""} maxLength={40} placeholder={t(groupLabels[g])} onChange={(e) => setDraft({ ...draft, groups: { ...draft.groups, [g]: { label: e.target.value || undefined } } })} /></label>)}
      </div>
      <ul className="cz-pages">
        {pageIds.map((id) => {
          const page = draft.pages[id];
          const required = requiredPages.includes(id);
          const set = (patch: Partial<typeof page>) => setDraft({ ...draft, pages: { ...draft.pages, [id]: { ...page, ...patch } } });
          return <li key={id} className={page.on ? "" : "off"}>
            <label className="cz-switch"><input type="checkbox" checked={page.on} disabled={required} onChange={(e) => set({ on: e.target.checked })} /><span>{t(pageLabels[id])}</span></label>
            <input value={page.label ?? ""} maxLength={40} placeholder={t(pageLabels[id])} aria-label={t("Nom de la page « {name} »", { name: t(pageLabels[id]) })} disabled={!page.on} onChange={(e) => set({ label: e.target.value || undefined })} />
            <Select value={page.group} onValueChange={(v) => set({ group: v as typeof page.group })} disabled={!page.on}>
              <SelectTrigger className="pick" aria-label={t("Groupe de « {name} »", { name: t(pageLabels[id]) })}><SelectValue /></SelectTrigger>
              <SelectContent>{groupIds.map((g) => <SelectItem key={g} value={g}>{draft.groups[g]?.label || t(groupLabels[g])}</SelectItem>)}</SelectContent>
            </Select>
          </li>;
        })}
      </ul>
    </section></Surface>

    <div className="cz-grid">
      <Surface asChild tone="default"><form className="cz-panel" aria-labelledby="cz-rules" onSubmit={(e) => { e.preventDefault(); void saveRules(); }}>
        <header>
          <h2 id="cz-rules">{t("Validation client")}</h2>
          <p>{t("Le délai avant la validation tacite et les tours de retours inclus, pour les clients sans contrat.")}</p>
        </header>
        <WorkflowFields value={rules} onChange={setRules} disabled={rulesBusy} />
        <button className="btn" disabled={rulesBusy || JSON.stringify(rules) === JSON.stringify(workflowSettings)}>{t("Enregistrer les règles")}</button>
      </form></Surface>

      <Surface asChild tone="default"><section className="cz-panel" aria-labelledby="cz-presets">
        <header>
          <h2 id="cz-presets">{t("Repartir d’un modèle")}</h2>
          <p>{t("Remplace vos statuts et vos pages par ceux d’un type de studio ; rien n’est enregistré avant « Enregistrer ».")}</p>
        </header>
        <ul className="cz-presets">
          {presets.map((p) => <li key={p.id}>
            <span><strong>{t(p.label)}</strong><small>{t(p.description)}</small></span>
            <button type="button" className="btn" onClick={() => { if (window.confirm(t("Remplacer vos statuts et vos pages par le modèle « {name} » ?", { name: t(p.label) }))) setDraft(presetProcess(p.id)); }}>{t("Utiliser")}</button>
          </li>)}
        </ul>
      </section></Surface>
    </div>

    {dirty && <div className="cz-savebar" role="region" aria-label={t("Modifications du processus")}>
      <span>{t("Modifications non enregistrées")}</span>
      <button type="button" className="btn ghost" disabled={saving} onClick={() => setDraft(structuredClone(process))}><RotateCcw size={15} />{t("Annuler")}</button>
      <button type="button" className="btn primary" disabled={saving || !check.success} onClick={() => void save()}><Save size={15} />{t("Enregistrer")}</button>
    </div>}

    <Dialog open={!!replace} onOpenChange={(o) => { if (!o && !saving) setReplace(null); }}>
      <DialogContent className="tracker-modal">
        <DialogHeader>
          <DialogTitle>{t("Où déplacer ces tâches ?")}</DialogTitle>
          <DialogDescription>{t("Ces statuts sont supprimés mais des tâches les utilisent encore. Choisissez leur nouveau statut.")}</DialogDescription>
        </DialogHeader>
        {replace && <div className="form-fields">
          {replace.statuses.map((r) => <div key={r.id} className="form-field"><span>{t("« {name} » · {n} tâches", { name: t(r.label), n: r.count })}</span>
            <Select value={replace.choice[r.id] ?? ""} onValueChange={(v) => setReplace({ ...replace, choice: { ...replace.choice, [r.id]: v } })}>
              <SelectTrigger className="pick"><SelectValue placeholder={t("Choisir un statut")} /></SelectTrigger>
              <SelectContent>{draft.statuses.map((s) => <SelectItem key={s.id} value={s.id}>{t(s.label)}</SelectItem>)}</SelectContent>
            </Select>
          </div>)}
        </div>}
        <DialogFooter className="modal-footer">
          <button type="button" className="btn" disabled={saving} onClick={() => setReplace(null)}>{t("Annuler")}</button>
          <button type="button" className="btn primary" disabled={saving || !replace || replace.statuses.some((r) => !replace.choice[r.id])} onClick={() => replace && void save(replace.choice)}>{t("Déplacer et enregistrer")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
