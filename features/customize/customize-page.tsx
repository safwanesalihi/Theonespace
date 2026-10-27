"use client";
// « Personnaliser » — the studio's whole setup on one board, like a moodboard: one card per layer of its
// process (lib/process.ts), each drawing what it holds. A card opens its editor (features/customize/layers.tsx)
// beside the board; a template can be remixed into the flow without touching the other layers. The team
// view shows the studio's side, the client view what its clients find in their portal. Nothing is saved
// until « Enregistrer »; a status removed while tasks use it asks where those tasks go.
import { Surface } from "@/components/ui/surface";
import { useMemo, useState, type ReactNode } from "react";
import { Bell, CalendarClock, Gauge, LayoutGrid, ListPlus, MonitorSmartphone, RotateCcw, Save, ShieldCheck, Sparkles, Users, Workflow, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useProcess } from "@/features/workspace/process-context";
import type { ScreenProps } from "@/features/workspace/screen-props";
import { useI18n } from "@/lib/i18n/locale-provider";
import { builtinMetrics, defaultDashboard } from "@/lib/dashboard";
import { chartColorOf, notifyEvents, notifyRoutes, pageIds, portalSections, portalWordKeys, processSchema, rulesOf, type Process } from "@/lib/process";
import { presetProcess, presets } from "@/lib/process-presets";
import { workflowSettingsSchema, type WorkflowSettings } from "@/lib/workflow-settings";
import {
  ChecksLayer, DashboardLayer, FieldsLayer, FlowLayer, NotificationsLayer, PagesLayer, PortalLayer, RolesLayer, RulesLayer,
  sectionLabels, silenceLabels, wordDefaults,
} from "@/features/customize/layers";

type Replacement = { id: string; label: string; count: number };
/** Two settings compared whatever their keys' order: the server returns them in its own order. */
const same = (a: unknown, b: unknown) => JSON.stringify(a, sortedKeys) === JSON.stringify(b, sortedKeys);
const sortedKeys = (_: string, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v);
const layerIds = ["flow", "checks", "rules", "fields", "roles", "notifications", "portal", "dashboard", "pages"] as const;
type LayerId = (typeof layerIds)[number];
const layerMeta: Record<LayerId, { title: string; text: string; icon: LucideIcon; keys: (keyof Process)[] }> = {
  flow: { title: "Processus", text: "Vos étapes et le chemin de chaque type de travail.", icon: Workflow, keys: ["statuses", "workTypes", "preset"] },
  checks: { title: "Validations internes", text: "Qui relit le travail avant le client.", icon: ShieldCheck, keys: [] },
  rules: { title: "Règles et calendrier", text: "Le silence du client, les délais, le gel avant publication.", icon: CalendarClock, keys: ["rules"] },
  fields: { title: "Champs", text: "Ce que vous notez sur chaque tâche.", icon: ListPlus, keys: ["fields"] },
  roles: { title: "Rôles", text: "Les métiers de votre équipe et leurs droits.", icon: Users, keys: ["roles"] },
  notifications: { title: "Messages automatiques", text: "Ce que l’app envoie sur WhatsApp et par e-mail.", icon: Bell, keys: ["notifications"] },
  portal: { title: "Portail client", text: "Ce que vos clients voient, avec vos mots.", icon: MonitorSmartphone, keys: ["portal"] },
  dashboard: { title: "Tableau de bord", text: "Vos chiffres et vos cibles.", icon: Gauge, keys: ["dashboard"] },
  pages: { title: "Pages", text: "Les pages de votre équipe et leur rangement.", icon: LayoutGrid, keys: ["pages", "groups"] },
};

/** A template's flow (statuses, work types, pages) remixed into the studio's setup: its other layers stay. */
function remix(draft: Process, presetId: string): Process {
  const p = presetProcess(presetId);
  const types = new Set((p.workTypes ?? []).map((w) => w.id));
  return {
    ...draft, preset: p.preset, statuses: p.statuses, workTypes: p.workTypes, pages: p.pages, groups: p.groups,
    fields: draft.fields?.map((f) => ({ ...f, workTypes: f.workTypes?.filter((id) => types.has(id)).length ? f.workTypes.filter((id) => types.has(id)) : undefined })),
  };
}

export default function CustomizePage({ data, actions }: Pick<ScreenProps, "data" | "actions">) {
  const { t, rtl } = useI18n();
  const process = useProcess();
  const { records, processRevision, workflowSettings, workflowRevision } = data;
  const { mutate, setError, setNotice } = actions;
  const [draft, setDraft] = useState<Process>(() => structuredClone(process));
  const [base, setBase] = useState(process);
  const [saving, setSaving] = useState(false);
  const [replace, setReplace] = useState<{ statuses: Replacement[]; choice: Record<string, string> } | null>(null);
  const [rules, setRules] = useState<WorkflowSettings>(workflowSettings);
  const [rulesBase, setRulesBase] = useState(workflowSettings);
  const [open, setOpen] = useState<LayerId | null>(null);
  // The layer on the sheet: kept while it slides out, so it never goes blank.
  const [shown, setShown] = useState<LayerId>("flow");
  const openLayer = (id: LayerId) => { setShown(id); setOpen(id); };
  const [view, setView] = useState<"team" | "client">("team");
  const processDirty = !same(draft, process);
  const rulesDirty = !same(rules, workflowSettings);
  const dirty = processDirty || rulesDirty;
  // A save elsewhere (or this one) brings a new process: start again from it unless changes are pending.
  if (base !== process) { setBase(process); if (!processDirty || saving) setDraft(structuredClone(process)); }
  if (rulesBase !== workflowSettings) { setRulesBase(workflowSettings); if (!rulesDirty || saving) setRules(workflowSettings); }

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) if ((r.kind === "task" || r.kind === "plan_item") && !r.archived && r.status) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return counts;
  }, [records]);
  const check = processSchema.safeParse(draft);
  const rulesCheck = workflowSettingsSchema.safeParse(rules);
  const problem = !check.success ? t(check.error.issues[0]?.message ?? "")
    : !rulesCheck.success ? t("Indiquez un délai entre 1 minute et 365 jours et un nombre entier de tours entre 0 et 10 000.") : "";
  // A card with changes not yet saved wears a dot.
  // The checks' reviewers live on the statuses but belong to the checks card.
  const withoutReviewers = (p: Process) => p.statuses.map(({ reviewers, ...s }) => { void reviewers; return s; });
  const touched = (id: LayerId) => id === "rules" && rulesDirty ? true
    : id === "checks" ? !same(draft.statuses.map((s) => s.reviewers), process.statuses.map((s) => s.reviewers))
    : id === "flow" ? !same(withoutReviewers(draft), withoutReviewers(process)) || !same(draft.workTypes, process.workTypes) || draft.preset !== process.preset
    : layerMeta[id].keys.some((k) => !same(draft[k], process[k]));

  async function save(replacements?: Record<string, string>) {
    if (problem) { setError(problem); return; }
    setSaving(true);
    try {
      if (processDirty) await mutate({ action: "process-save", data: draft, revision: processRevision, ...(replacements ? { replacements } : {}) });
      if (rulesDirty && rulesCheck.success) await mutate({ action: "set-workflow-settings", data: rulesCheck.data, revision: workflowRevision });
      setReplace(null);
      setNotice(t("Processus du studio enregistré"));
    } catch (error) {
      const err = error as Error & { code?: string; details?: { statuses?: Replacement[] } };
      if (err.code === "replace" && err.details?.statuses?.length) setReplace({ statuses: err.details.statuses, choice: {} });
      else setError(t(err.message));
    } finally { setSaving(false); }
  }

  // What each card draws: the layer at a glance.
  const r = rulesOf(draft);
  const internal = draft.statuses.filter((s) => s.behaviour === "internal");
  const notifyTotal = notifyEvents.reduce((n, e) => n + notifyRoutes[e].length, 0);
  const notifyOn = notifyEvents.reduce((n, e) => n + notifyRoutes[e].filter((c) => draft.notifications?.[e]?.[c] !== false).length, 0);
  const metrics = draft.dashboard?.metrics ?? defaultDashboard;
  const metricLabel = (id: string) => (id in builtinMetrics ? t(builtinMetrics[id as keyof typeof builtinMetrics].label) : draft.fields?.find((f) => `field:${f.id}` === id)?.label ?? id);
  const chips = (items: string[], empty: string) => items.length
    ? <span className="cz-mini-chips">{items.slice(0, 6).map((x, i) => <span key={i}>{x}</span>)}{items.length > 6 && <span>+{items.length - 6}</span>}</span>
    : <small className="cz-mini-empty">{t(empty)}</small>;
  const pictures: Record<LayerId, ReactNode> = {
    flow: <>
      <span className="cz-mini-path">{draft.statuses.map((s) => <span key={s.id} style={{ background: chartColorOf(s.color) }} title={s.label} />)}</span>
      <small>{t("{a} statuts · {b} types de travail", { a: draft.statuses.length, b: draft.workTypes?.length ?? 0 })}</small>
    </>,
    checks: chips(internal.map((s) => s.reviewers?.length ? `${s.label} · ${s.reviewers.map((id) => draft.roles?.find((x) => x.id === id)?.label).filter(Boolean).join(", ")}` : s.label), "Aucune validation interne"),
    rules: <small>{t("{silence} après {h} h · gel J−{d} · {n} tours inclus", { silence: t(silenceLabels[rules.onSilence ?? "approve"][0]), h: rules.validationHours, d: r.lockDays, n: rules.maxRevisionRounds })}</small>,
    fields: chips((draft.fields ?? []).map((f) => f.label), "Aucun champ en plus"),
    roles: chips((draft.roles ?? []).map((x) => x.label), "Les rôles de base seulement"),
    notifications: <span className="cz-mini-meter"><i style={{ width: `${(notifyOn / notifyTotal) * 100}%` }} /><small>{t("{a} sur {b} actifs", { a: notifyOn, b: notifyTotal })}</small></span>,
    portal: <>
      {draft.portal?.welcome && <small className="cz-mini-quote">« {draft.portal.welcome} »</small>}
      {chips(portalSections.filter((s) => draft.portal?.sections?.[s] !== false).map((s) => t(sectionLabels[s])), "L’accueil seulement")}
    </>,
    dashboard: chips(metrics.map((m) => metricLabel(m.id)), "Aucun chiffre"),
    pages: <small>{t("{n} pages actives", { n: pageIds.filter((id) => draft.pages[id].on).length })}</small>,
  };

  const word = (k: (typeof portalWordKeys)[number]) => draft.portal?.words?.[k] || t(wordDefaults[k]);
  return <div className="customize-page">
    <div className="page-heading">
      <div className="heading-line"><h1>{t("Personnaliser")}</h1>
        <div className="live-switch" role="group" aria-label={t("Affichage")}>
          <button aria-pressed={view === "team"} onClick={() => setView("team")}>{t("Côté équipe")}</button>
          <button aria-pressed={view === "client"} onClick={() => setView("client")}>{t("Côté client")}</button>
        </div>
      </div>
      <p>{t("Toute votre agence sur un tableau. Touchez une carte pour la changer ; rien n’est enregistré avant « Enregistrer ».")}</p>
    </div>

    <section className="cz-templates" aria-labelledby="cz-templates">
      <h2 id="cz-templates"><Sparkles size={15} />{t("Partir d’un modèle")}</h2>
      <ul>
        {presets.map((p) => <li key={p.id}><button type="button" className={`cz-template ${draft.preset === p.id ? "on" : ""}`}
          onClick={() => { if (draft.preset === p.id || window.confirm(t("Remplacer vos étapes et vos pages par le modèle « {name} » ? Vos champs, rôles et réglages restent.", { name: t(p.label) }))) setDraft(remix(draft, p.id)); }}>
          <span className="cz-mini-path">{p.process.statuses.map((s) => <span key={s.id} style={{ background: chartColorOf(s.color) }} />)}</span>
          <strong>{t(p.label)}</strong><small>{t(p.description)}</small>
        </button></li>)}
      </ul>
    </section>

    {view === "team" ? <div className="cz-board">
      {layerIds.map((id, index) => {
        const { title, text, icon: Icon } = layerMeta[id];
        return <Surface asChild tone="default" key={id}><button type="button" className={`cz-card cz-card-${id}`} style={{ "--i": index } as React.CSSProperties} onClick={() => openLayer(id)}>
          <span className="cz-card-head"><span className="cz-card-icon"><Icon size={17} /></span><strong>{t(title)}</strong>{touched(id) && <span className="cz-touched" title={t("Modifié")} />}</span>
          <span className="cz-card-picture">{pictures[id]}</span>
          <small className="cz-card-text">{t(text)}</small>
        </button></Surface>;
      })}
    </div> : <div className="cz-client-view">
      <div className="cz-phone" aria-label={t("Aperçu du portail client")}>
        <header><strong>{t("Bonjour Lina")}</strong>{draft.portal?.welcome && <p dir="auto">{draft.portal.welcome}</p>}</header>
        <ul className="cz-phone-tasks">
          <li><span>{t("Reel lancement")}</span><em className="client">{word("client")}</em></li>
          <li><span>{t("Carrousel promo")}</span><em className="work">{word("work")}</em></li>
          <li><span>{t("Affiche salon")}</span><em className="done">{word("done")}</em></li>
          <li><span>{t("Story teaser")}</span><em>{word("todo")}</em></li>
        </ul>
        <nav>{["Accueil", "À valider", ...portalSections.filter((s) => draft.portal?.sections?.[s] !== false).map((s) => sectionLabels[s])].slice(0, 7).map((s) => <span key={s}>{t(s)}</span>)}</nav>
      </div>
      <button type="button" className="btn" onClick={() => openLayer("portal")}>{t("Changer le portail")}</button>
    </div>}

    {problem && dirty && <p className="cz-problem" role="alert">{problem}</p>}

    <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
      <SheetContent side={rtl ? "left" : "right"} className="cz-sheet">
        <>
          <div className="cz-sheet-head">
            <SheetTitle>{t(layerMeta[shown].title)}</SheetTitle>
            <SheetDescription>{t(layerMeta[shown].text)}</SheetDescription>
          </div>
          <div className="cz-sheet-body">
            {shown === "flow" && <FlowLayer draft={draft} setDraft={setDraft} usage={usage} />}
            {shown === "checks" && <ChecksLayer draft={draft} setDraft={setDraft} />}
            {shown === "rules" && <RulesLayer draft={draft} setDraft={setDraft} rules={rules} setRules={setRules} />}
            {shown === "fields" && <FieldsLayer draft={draft} setDraft={setDraft} />}
            {shown === "roles" && <RolesLayer draft={draft} setDraft={setDraft} />}
            {shown === "notifications" && <NotificationsLayer draft={draft} setDraft={setDraft} />}
            {shown === "portal" && <PortalLayer draft={draft} setDraft={setDraft} />}
            {shown === "dashboard" && <DashboardLayer draft={draft} setDraft={setDraft} />}
            {shown === "pages" && <PagesLayer draft={draft} setDraft={setDraft} />}
            {problem && <p className="cz-problem" role="alert">{problem}</p>}
          </div>
          <div className="cz-sheet-foot"><button type="button" className="btn primary" onClick={() => setOpen(null)}>{t("Voir le tableau")}</button></div>
        </>
      </SheetContent>
    </Sheet>

    {dirty && <div className="cz-savebar" role="region" aria-label={t("Modifications du processus")}>
      <span>{t("Modifications non enregistrées")}</span>
      <button type="button" className="btn ghost" disabled={saving} onClick={() => { setDraft(structuredClone(process)); setRules(workflowSettings); }}><RotateCcw size={15} />{t("Annuler")}</button>
      <button type="button" className="btn primary" disabled={saving || !!problem} onClick={() => void save()}><Save size={15} />{t("Enregistrer")}</button>
    </div>}

    <Dialog open={!!replace} onOpenChange={(o) => { if (!o && !saving) setReplace(null); }}>
      <DialogContent className="tracker-modal">
        <DialogHeader>
          <DialogTitle>{t("Où déplacer ces tâches ?")}</DialogTitle>
          <DialogDescription>{t("Ces statuts sont supprimés mais des tâches les utilisent encore. Choisissez leur nouveau statut.")}</DialogDescription>
        </DialogHeader>
        {replace && <div className="form-fields">
          {replace.statuses.map((x) => <div key={x.id} className="form-field"><span>{t("« {name} » · {n} tâches", { name: t(x.label), n: x.count })}</span>
            <Select value={replace.choice[x.id] ?? ""} onValueChange={(v) => setReplace({ ...replace, choice: { ...replace.choice, [x.id]: v } })}>
              <SelectTrigger className="pick"><SelectValue placeholder={t("Choisir un statut")} /></SelectTrigger>
              <SelectContent>{draft.statuses.map((s) => <SelectItem key={s.id} value={s.id}>{t(s.label)}</SelectItem>)}</SelectContent>
            </Select>
          </div>)}
        </div>}
        <DialogFooter className="modal-footer">
          <button type="button" className="btn" disabled={saving} onClick={() => setReplace(null)}>{t("Annuler")}</button>
          <button type="button" className="btn primary" disabled={saving || !replace || replace.statuses.some((x) => !replace.choice[x.id])} onClick={() => replace && void save(replace.choice)}>{t("Déplacer et enregistrer")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
