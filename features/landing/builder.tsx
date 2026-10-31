"use client";
// « Construisez votre agence », in small: three of the five questions an agency answers at sign-up
// (features/customize/build-agency.tsx), and the path its answers build, drawn as the visitor plays. The
// path comes from the app's own builder (lib/agency-builder.ts) on the app's own models
// (lib/process-presets.ts), so the page never shows a path the app would not build. v6.tsx loads this
// file only when the section comes near, so the builder's code stays out of the page's first load.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Check, Clock3, Eye, PenLine, Send } from "lucide-react";
import { buildAgency, checkIdeas } from "@/lib/agency-builder";
import { presets } from "@/lib/process-presets";
import type { Behaviour } from "@/lib/process";
import { useI18n } from "@/lib/i18n/locale-provider";
import { useStill } from "./ui";

// The silence choices of the real game (features/customize/layers.ts), with its hours.
const silence = { approve: "Le silence vaut accord", remind: "On relance", escalate: "On prévient les responsables" } as const;
type Silence = keyof typeof silence;
const hours = [24, 48, 72];
const icons: Partial<Record<Behaviour, typeof Check>> = { work: PenLine, internal: Eye, client: Send, done: Check };

export default function Builder() {
  const { t } = useI18n();
  const still = useStill();
  const [preset, setPreset] = useState("social");
  const [checks, setChecks] = useState<string[]>(["Check DA"]);
  const [mode, setMode] = useState<Silence>("approve");
  const [after, setAfter] = useState(48);
  // Paused is a side state, not a step of the path.
  const path = buildAgency({ preset, workTypes: [], checks, channels: { whatsapp: true, email: true } }).statuses.filter((s) => s.behaviour !== "paused");
  const toggle = (check: string) => setChecks((list) => (list.includes(check) ? list.filter((c) => c !== check) : checkIdeas.filter((c) => c === check || list.includes(c))));
  // On phones the path is one scrolling strip: after each answer, bring the client's step (and its rule) into view.
  // Only after an answer changes, never as the builder mounts (before it is on screen): the page must not jump.
  const strip = useRef<HTMLOListElement>(null);
  const answers = `${preset}|${checks.join(",")}|${mode}|${after}`;
  const shown = useRef(answers);
  useEffect(() => {
    const ol = strip.current;
    if (shown.current === answers || !ol) return;
    shown.current = answers;
    if (ol.scrollWidth > ol.clientWidth) ol.querySelector(".b-client")?.scrollIntoView({ block: "nearest", inline: "center", behavior: still ? "auto" : "smooth" });
  }, [answers, still]);
  const spring = still ? { duration: 0 } : { type: "spring" as const, stiffness: 380, damping: 32 };

  return (
    <div className="v6-build">
      <div className="v6-build-q">
        <fieldset>
          <legend><span>1</span>{t("Quel genre d’agence êtes-vous ?")}</legend>
          <div className="v6-chips">{presets.map((p) => <button key={p.id} type="button" aria-pressed={preset === p.id} className={preset === p.id ? "on" : ""} onClick={() => setPreset(p.id)}>{t(p.label)}</button>)}</div>
        </fieldset>
        <fieldset>
          <legend><span>2</span>{t("Qui relit avant le client ?")}</legend>
          <div className="v6-chips">{checkIdeas.map((c) => <button key={c} type="button" aria-pressed={checks.includes(c)} className={checks.includes(c) ? "on" : ""} onClick={() => toggle(c)}>{checks.includes(c) && <Check size={14} aria-hidden="true" />}{t(c)}</button>)}</div>
        </fieldset>
        <fieldset>
          <legend><span>3</span>{t("Le client ne répond pas. On fait quoi ?")}</legend>
          <div className="v6-chips">{(Object.keys(silence) as Silence[]).map((m) => <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{t(silence[m])}</button>)}</div>
          <div className="v6-chips small" role="group" aria-label={t("Après combien d’heures ?")}>{hours.map((h) => <button key={h} type="button" aria-pressed={after === h} className={after === h ? "on" : ""} onClick={() => setAfter(h)}>{t("{n} h", { n: h })}</button>)}</div>
        </fieldset>
      </div>

      <div className="v6-build-out ts-deep" aria-live="polite">
        <p className="v6-build-title"><b>{t("Votre chemin")}</b><span>{t("{n} étapes", { n: path.length })}</span></p>
        <LayoutGroup>
          <ol className="v6-path" ref={strip}>
            <AnimatePresence initial={false} mode="popLayout">
              {path.map((s) => {
                const Icon = icons[s.behaviour];
                return (
                  <motion.li key={`${preset}-${s.id}`} layout={!still} className={`b-${s.behaviour}`} initial={still ? false : { opacity: 0, x: -14, filter: "blur(6px)" }} animate={{ opacity: 1, x: 0, filter: "blur(0px)" }} exit={still ? undefined : { opacity: 0, x: 14, filter: "blur(6px)" }} transition={spring}>
                    <i aria-hidden="true">{Icon && <Icon size={13} />}</i>
                    <span>{t(s.label)}</span>
                    {s.behaviour === "client" && (
                      <motion.small key={`${mode}-${after}`} initial={still ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                        <Clock3 size={13} aria-hidden="true" />{t("Sans réponse après {h} h", { h: after })} · <b>{t(silence[mode])}</b>
                      </motion.small>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        </LayoutGroup>
        <p className="v6-build-note">{t("Puis tout se change sur « Personnaliser » : étapes, champs, rôles, messages.")}</p>
      </div>
    </div>
  );
}
