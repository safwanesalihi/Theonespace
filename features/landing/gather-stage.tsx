"use client";
// The hub on wide screens (v6.tsx loads it only there, with motion): the stage stays pinned while the
// visitor scrolls, and the scroll gathers the agency's six tools, grain by grain, into The One Space's
// mark (fx/gather.tsx). Then each tool comes back around the mark as the module that replaces it.
// The words drawn on the canvas are printed for screen readers; the modules are real text.
import { useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { Check } from "lucide-react";
import Gather, { type GatherWord } from "./fx/gather";

export type GatherModule = { name: string; note: string };

function Module({ module, i, progress }: { module: GatherModule; i: number; progress: MotionValue<number> }) {
  const at = 0.76 + i * 0.025;
  const opacity = useTransform(progress, [at, at + 0.08], [0, 1]);
  const y = useTransform(progress, [at, at + 0.08], [10, 0]);
  return (
    <motion.li className={`v6-gather-node n${i}`} style={{ opacity, y }}>
      <b><Check size={13} aria-hidden="true" />{module.name}</b>
      <span>{module.note}</span>
    </motion.li>
  );
}

export default function GatherStage({ words, modules, before, after }: { words: GatherWord[]; modules: GatherModule[]; before: [string, string]; after: [string, string] }) {
  const track = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  const progress = useTransform(scrollYProgress, [0.08, 0.82], [0, 1], { clamp: true });
  const beforeOn = useTransform(progress, [0.15, 0.35], [1, 0]);
  const afterOn = useTransform(progress, [0.6, 0.8], [0, 1]);
  const name = useTransform(progress, [0.72, 0.86], [0, 1]);
  return (
    <div className="v6-gather" ref={track}>
      <div className="v6-gather-pin">
        <div className="v6-gather-stage ts-deep">
          <Gather className="v6-gather-canvas" words={words} progress={progress} />
          <div className="v6-gather-state">
            <motion.p style={{ opacity: beforeOn }}><span className="ts-hub-tag bad">{before[0]}</span><b>{before[1]}</b></motion.p>
            <motion.p style={{ opacity: afterOn }}><span className="ts-hub-tag good">{after[0]}</span><b>{after[1]}</b></motion.p>
          </div>
          <ul className="v6-gather-sr">{words.map((w) => <li key={w.text}>{w.text} : {w.note}</li>)}</ul>
          <motion.p className="v6-gather-name" style={{ opacity: name }} aria-hidden="true">The One Space</motion.p>
          <ul className="v6-gather-nodes">{modules.map((m, i) => <Module key={m.name} module={m} i={i} progress={progress} />)}</ul>
        </div>
      </div>
    </div>
  );
}
