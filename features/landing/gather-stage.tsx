"use client";
// The hub on wide screens (v6.tsx loads it only there, with motion): the stage stays pinned while the
// visitor scrolls, and the scroll tells the story (fx/gather.tsx draws the grains). The six tools lie
// scattered, joined by broken threads; they spiral into the middle and melt into The One Space's mark;
// then the space runs everything: a spoke of gold goes out from the mark to each module, set where the
// tool it replaces came from and marked with that tool's colour, light keeps running along the spokes
// and round the orbit. The words drawn on the canvas are printed for screen readers; the modules are
// real text.
import { useMemo, useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { Check } from "lucide-react";
import Gather, { TOOLS, type GatherWord } from "./fx/gather";

/** A module of the space: what it is, what it replaces, and where it sits on the stage (in %). */
export type GatherModule = { name: string; note: string; x: number; y: number };

// Which tools are tangled with which in the first act.
const TANGLE = [[0, 4], [1, 3], [2, 5], [0, 5], [3, 2], [4, 1]];

function Module({ module, word, i, progress }: { module: GatherModule; word: GatherWord; i: number; progress: MotionValue<number> }) {
  const at = 0.8 + i * 0.022;
  const opacity = useTransform(progress, [at, at + 0.06], [0, 1]);
  const scale = useTransform(progress, [at, at + 0.06], [0.86, 1]);
  // It comes out of the mark, along its spoke.
  const x = useTransform(progress, [at, at + 0.06], [(50 - module.x) * 1.4, 0]);
  const y = useTransform(progress, [at, at + 0.06], [(50 - module.y) * 1.4, 0]);
  return (
    <li className="v6-gather-node" style={{ left: `${module.x}%`, top: `${module.y}%` }}>
      <motion.div style={{ opacity, scale, x, y }}>
        <b><Check size={13} aria-hidden="true" />{module.name}</b>
        <span><i style={{ background: TOOLS[word.tool].ink }} aria-hidden="true" />{module.note}</span>
      </motion.div>
    </li>
  );
}

/** A spoke runs from the mark's edge out to the module, in % of the stage (so its strokes stay true). */
const spoke = (m: GatherModule) => ({ x1: `${50 + (m.x - 50) * 0.32}%`, y1: `${50 + (m.y - 50) * 0.32}%`, x2: `${m.x}%`, y2: `${m.y}%` });

function Spoke({ module, i, progress }: { module: GatherModule; i: number; progress: MotionValue<number> }) {
  const at = 0.77 + i * 0.022;
  const pathLength = useTransform(progress, [at, at + 0.06], [0, 1]);
  const opacity = useTransform(progress, [at, at + 0.01], [0, 1]);
  return <motion.line className="spoke" {...spoke(module)} style={{ pathLength, opacity }} />;
}

export default function GatherStage({ words, modules, before, after, tagline }: { words: GatherWord[]; modules: GatherModule[]; before: [string, string]; after: [string, string]; tagline: string }) {
  const track = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  const progress = useTransform(scrollYProgress, [0.06, 0.86], [0, 1], { clamp: true });
  const beforeOn = useTransform(progress, [0.12, 0.26], [1, 0]);
  const tangle = useTransform(progress, [0, 0.1, 0.2], [1, 1, 0]);
  const afterOn = useTransform(progress, [0.72, 0.8], [0, 1]);
  const name = useTransform(progress, [0.74, 0.82], [0, 1]);
  const running = useTransform(progress, [0.86, 0.92], [0, 1]);
  const threads = useMemo(() => TANGLE.map(([a, b]) => {
    const p = words[a], q = words[b];
    return `M${p.x} ${p.y} C ${q.x} ${p.y}, ${p.x} ${q.y}, ${q.x} ${q.y}`;
  }), [words]);
  return (
    <div className="v6-gather" ref={track}>
      <div className="v6-gather-pin">
        <div className="v6-gather-stage ts-deep">
          <motion.svg className="v6-gather-lines tangle" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{ opacity: tangle }}>
            {threads.map((d) => <path key={d} d={d} vectorEffect="non-scaling-stroke" />)}
          </motion.svg>
          <svg className="v6-gather-lines" aria-hidden="true">
            <motion.ellipse className="orbit" cx="50%" cy="50%" rx="37%" ry="40%" style={{ opacity: running }} />
            {modules.map((m, i) => <Spoke key={m.name} module={m} i={i} progress={progress} />)}
            {/* Once the space runs, light keeps going out along every spoke. */}
            <motion.g className="pulses" style={{ opacity: running }}>{modules.map((m, i) => <line key={m.name} {...spoke(m)} pathLength={100} style={{ animationDelay: `${i * -0.45}s` }} />)}</motion.g>
          </svg>
          <Gather className="v6-gather-canvas" words={words} progress={progress} />
          <div className="v6-gather-state">
            <motion.p style={{ opacity: beforeOn }}><span className="ts-hub-tag bad">{before[0]}</span><b>{before[1]}</b></motion.p>
            <motion.p style={{ opacity: afterOn }}><span className="ts-hub-tag good">{after[0]}</span><b>{after[1]}</b></motion.p>
          </div>
          <ul className="v6-gather-sr">{words.map((w) => <li key={w.text}>{w.text} : {w.note}</li>)}</ul>
          <motion.p className="v6-gather-name" style={{ opacity: name }}><b aria-hidden="true">The One Space</b><span>{tagline}</span></motion.p>
          <ul className="v6-gather-nodes">{modules.map((m, i) => <Module key={m.name} module={m} word={words[i]} i={i} progress={progress} />)}</ul>
        </div>
      </div>
    </div>
  );
}
