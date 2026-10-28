"use client";
// « Build your agency » (phase 4, concept B): the guided setup a new agency plays once, right after
// sign-up — five quick questions, with its space assembling live beside them. The answers become its
// process (lib/agency-builder.ts) and its client-validation rules; everything stays editable on the
// « Personnaliser » board. « Passer » keeps the model chosen at sign-up and never asks again.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Mail, MessageCircle, Plus, Sparkles, X } from "lucide-react";
import type { ScreenProps } from "@/features/workspace/screen-props";
import { useProcess } from "@/features/workspace/process-context";
import { useI18n } from "@/lib/i18n/locale-provider";
import { buildAgency, checkIdeas, workIdeas, type AgencyAnswers } from "@/lib/agency-builder";
import { chartColorOf, flowFor } from "@/lib/process";
import { presets } from "@/lib/process-presets";
import { silenceModes, workflowSettingsSchema, type SilenceMode } from "@/lib/workflow-settings";
import { silenceLabels, wordDefaults } from "@/features/customize/layers";

const steps = ["kind", "work", "checks", "silence", "channels"] as const;
const hourChoices = [24, 48, 72];

export default function BuildAgency({ data, actions, onDone }: Pick<ScreenProps, "data" | "actions"> & { onDone: () => void }) {
  const { t } = useI18n();
  const process = useProcess();
  const { processRevision, workflowSettings, workflowRevision, workspace } = data;
  const { mutate, setError, setNotice } = actions;
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [answers, setAnswers] = useState<AgencyAnswers>(() => ({
    preset: presets.some((p) => p.id === process.preset) ? process.preset : presets[0].id,
    workTypes: [t("Reel"), t("Carrousel"), t("Story")],
    checks: [t("Check DA")],
    channels: { whatsapp: true, email: true },
  }));
  const [silence, setSilence] = useState<SilenceMode>(workflowSettings.onSilence ?? "approve");
  const [hours, setHours] = useState(workflowSettings.validationHours);
  const [typed, setTyped] = useState("");
  // The ideas in the person's language: what they tap is what their work types and checks are called.
  const ideas = workIdeas.map((w) => t(w));
  const checkNames = checkIdeas.map((c) => t(c));
  const built = useMemo(() => buildAgency(answers), [answers]);
  const path = flowFor(built, { workType: built.workTypes?.[0]?.id }).statuses;
  // The sample task walks along the path, one stone at a time.
  const [walk, setWalk] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setWalk((w) => w + 1), 1100); return () => window.clearInterval(id); }, []);
  // A real dialog for the keyboard: focus starts on each question, and Tab stays inside the game.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>("#ba-title")?.focus(); }, [step]);
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !root.current) return;
    const items = [...root.current.querySelectorAll<HTMLElement>("button:not([disabled]), input")].filter((el) => el.offsetParent !== null);
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  const here = path[walk % Math.max(path.length, 1)];

  const set = (patch: Partial<AgencyAnswers>) => setAnswers({ ...answers, ...patch });
  const toggleWork = (label: string) => set({ workTypes: answers.workTypes.includes(label) ? answers.workTypes.filter((w) => w !== label) : [...answers.workTypes, label] });
  const addTyped = () => { const label = typed.trim(); if (label && !answers.workTypes.includes(label)) set({ workTypes: [...answers.workTypes, label] }); setTyped(""); };

  async function finish(skip = false) {
    setSaving(true);
    try {
      await mutate({ action: "process-save", data: skip ? { ...process, built: true } : built, revision: processRevision });
      const rules = workflowSettingsSchema.safeParse({ ...workflowSettings, validationHours: hours, onSilence: silence === "approve" ? undefined : silence });
      if (!skip && rules.success && JSON.stringify(rules.data) !== JSON.stringify(workflowSettings)) {
        await mutate({ action: "set-workflow-settings", data: rules.data, revision: workflowRevision });
      }
      setNotice(skip ? t("Votre espace garde le modèle choisi. Tout se change dans « Personnaliser ».") : t("Votre agence est prête !"));
      onDone();
    } catch (error) { setError(t((error as Error).message)); setSaving(false); }
  }

  const last = step === steps.length - 1;
  const name = workspace?.name || t("Votre agence");
  return <div className="ba" role="dialog" aria-modal="true" aria-labelledby="ba-title" ref={root} onKeyDown={trap}>
    <div className="ba-play">
      <header className="ba-head">
        <span className="ba-badge"><Sparkles size={14} />{t("Construisez votre agence")}</span>
        <ol className="ba-dots" aria-label={t("Étape {a} sur {b}", { a: step + 1, b: steps.length })}>{steps.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "on" : ""} />)}</ol>
        <button type="button" className="btn ghost" disabled={saving} onClick={() => void finish(true)}>{t("Passer")}<X size={14} /></button>
      </header>

      <div className="ba-step" key={step}>
        {steps[step] === "kind" && <>
          <h1 id="ba-title" tabIndex={-1}>{t("Quel genre d’agence êtes-vous ?")}</h1>
          <p>{t("On part de vos habitudes ; vous changerez tout ce que vous voulez ensuite.")}</p>
          <div className="ba-tiles">
            {presets.map((p) => <button type="button" key={p.id} className={`ba-tile ${answers.preset === p.id ? "on" : ""}`} aria-pressed={answers.preset === p.id} onClick={() => set({ preset: p.id })}>
              <span className="ba-mini-path">{p.process.statuses.map((s) => <i key={s.id} style={{ background: chartColorOf(s.color) }} />)}</span>
              <strong>{t(p.label)}</strong><small>{t(p.description)}</small>
              {answers.preset === p.id && <Check className="ba-check" size={16} />}
            </button>)}
          </div>
        </>}

        {steps[step] === "work" && <>
          <h1 id="ba-title" tabIndex={-1}>{t("Que fabriquez-vous pour vos clients ?")}</h1>
          <p>{t("Chaque type de travail aura son propre chemin. Rien de coché : un seul chemin pour tout.")}</p>
          <div className="ba-chips">
            {[...ideas, ...answers.workTypes.filter((w) => !ideas.includes(w))].map((w) => <button type="button" key={w} className={`ba-chip ${answers.workTypes.includes(w) ? "on" : ""}`} aria-pressed={answers.workTypes.includes(w)} onClick={() => toggleWork(w)}>{w}</button>)}
          </div>
          <form className="ba-add" onSubmit={(e) => { e.preventDefault(); addTyped(); }}>
            <input value={typed} maxLength={40} placeholder={t("Autre chose ? Ex. Podcast")} onChange={(e) => setTyped(e.target.value)} aria-label={t("Ajouter un type de travail")} />
            <button className="btn" disabled={!typed.trim()}><Plus size={14} />{t("Ajouter")}</button>
          </form>
        </>}

        {steps[step] === "checks" && <>
          <h1 id="ba-title" tabIndex={-1}>{t("Qui relit avant le client ?")}</h1>
          <p>{t("Touchez dans l’ordre où ça se passe. Touchez une étape de la chaîne pour la retirer.")}</p>
          <div className="ba-chain">
            <span className="ba-link">{t("Production")}</span>
            {answers.checks.map((c) => <button type="button" key={c} className="ba-link check" onClick={() => set({ checks: answers.checks.filter((x) => x !== c) })} aria-label={t("Retirer « {name} »", { name: c })}>{c}<X size={12} /></button>)}
            <span className="ba-link client">{t("Le client")}</span>
          </div>
          <div className="ba-chips">
            {checkNames.filter((c) => !answers.checks.includes(c)).map((c) => <button type="button" key={c} className="ba-chip" disabled={answers.checks.length >= 4} onClick={() => set({ checks: [...answers.checks, c] })}><Plus size={13} />{c}</button>)}
          </div>
          {!answers.checks.length && <p className="ba-note">{t("Pas de relecture : le travail part directement chez le client.")}</p>}
        </>}

        {steps[step] === "silence" && <>
          <h1 id="ba-title" tabIndex={-1}>{t("Le client ne répond pas. On fait quoi ?")}</h1>
          <div className="ba-options">
            {silenceModes.map((m) => <button type="button" key={m} className={`ba-option ${silence === m ? "on" : ""}`} aria-pressed={silence === m} onClick={() => setSilence(m)}>
              <strong>{t(silenceLabels[m][0])}</strong><small>{t(silenceLabels[m][1])}</small>
            </button>)}
          </div>
          <p>{t("Après combien d’heures ?")}</p>
          <div className="ba-chips">{hourChoices.map((h) => <button type="button" key={h} className={`ba-chip ${hours === h ? "on" : ""}`} aria-pressed={hours === h} onClick={() => setHours(h)}>{t("{n} h", { n: h })}</button>)}</div>
        </>}

        {steps[step] === "channels" && <>
          <h1 id="ba-title" tabIndex={-1}>{t("Comment prévient-on les gens ?")}</h1>
          <p>{t("Les messages automatiques : tâche assignée, travail envoyé, retours, validation. Les notifications dans l’app restent toujours.")}</p>
          <div className="ba-switches">
            {([["whatsapp", MessageCircle, "WhatsApp"], ["email", Mail, "E-mail"]] as const).map(([c, Icon, label]) =>
              <button type="button" key={c} className={`ba-switch ${answers.channels[c] ? "on" : ""}`} role="switch" aria-checked={answers.channels[c]} onClick={() => set({ channels: { ...answers.channels, [c]: !answers.channels[c] } })}>
                <Icon size={22} /><strong>{label}</strong><span className="ba-knob" aria-hidden="true" />
              </button>)}
          </div>
          <p className="ba-note">{t("{a} types de travail · {b} relecture(s) avant le client · {c} après {h} h. Tout se change ensuite sur votre tableau « Personnaliser ».", {
            a: answers.workTypes.length, b: answers.checks.length, c: t(silenceLabels[silence][0]), h: hours })}</p>
        </>}
      </div>

      <footer className="ba-foot">
        <button type="button" className="btn ghost" disabled={step === 0 || saving} onClick={() => setStep(step - 1)}><ArrowLeft size={15} />{t("Retour")}</button>
        {last
          ? <button type="button" className="btn primary" disabled={saving} onClick={() => void finish()}><Sparkles size={15} />{t("Ouvrir mon espace")}</button>
          : <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>{t("Continuer")}<ArrowRight size={15} /></button>}
      </footer>
    </div>

    <aside className="ba-preview" aria-label={t("Aperçu de votre espace")}>
      <div className="ba-window">
        <div className="ba-window-bar"><i /><i /><i /><span>{name}</span></div>
        <div className="ba-window-body">
          <span className="ba-types">{(built.workTypes ?? [{ id: "all", label: t("Toutes les tâches") }]).slice(0, 5).map((w, i) => <em key={w.id} className={i === 0 ? "on" : ""}>{w.label}</em>)}</span>
          <ol className="ba-road">
            {path.map((s) => <li key={s.id} className={here?.id === s.id ? "here" : ""} style={{ "--c": chartColorOf(s.color) } as React.CSSProperties}>
              <span className="ba-stone" /><small>{s.label}</small>
            </li>)}
          </ol>
          <div className="ba-card" style={{ "--c": here ? chartColorOf(here.color) : "var(--t-brand)" } as React.CSSProperties}>
            <strong>{t("{type} lancement", { type: built.workTypes?.[0]?.label ?? t("Contenu") })}</strong>
            <span className="ba-status">{here?.label}</span>
            <small>{here ? (here.behaviour === "internal" ? t("Relu par l’équipe") : here.behaviour === "client" ? t("Le client lit « {w} »", { w: t(wordDefaults.client) }) : here.behaviour === "done" ? t("Terminé : compte dans vos chiffres") : t("En production")) : ""}</small>
          </div>
          <span className="ba-pings">{answers.channels.whatsapp && <em><MessageCircle size={12} />WhatsApp</em>}{answers.channels.email && <em><Mail size={12} />E-mail</em>}<em>{t(silenceLabels[silence][0])} · {hours} h</em></span>
        </div>
      </div>
    </aside>
  </div>;
}
