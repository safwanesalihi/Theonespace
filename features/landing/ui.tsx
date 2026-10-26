"use client";
// Small pieces shared by the landing. Reveal wraps a block (no entrance effect), DepthCard follows
// the pointer with a spotlight and a slight 3D tilt, CountUp counts a figure up once it is seen (all three
// with motion/react, still for visitors who ask for reduced motion), DeepPanel is the deep silver panel
// with React Bits' silk moving behind it, and the 48-hour countdown.
import { animate, motion, useInView, useMotionValue, useSpring } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/** Follows a media query; during hydration it answers false, like the server, so both render alike. */
function useMedia(query: string, extra: () => boolean = () => true) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches && extra(),
    () => false,
  );
}

/** True for visitors who ask for reduced motion (false on the server and while hydrating). */
export function useStill() {
  return useMedia("(prefers-reduced-motion: reduce)");
}

/** A block of the page. Sections no longer fade in one by one: the page keeps a single orchestrated moment
 *  (the receipt stamped in the hero), so a block is simply there. */
export function Reveal({ children, className }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return <div className={className}>{children}</div>;
}

/** A card with a pointer-following gold spotlight (--mx/--my) and, with `tilt`, a soft 3D lean. */
export function DepthCard({ children, className = "", tilt = false, as = "div", href, onClick }: { children: ReactNode; className?: string; tilt?: boolean; as?: "div" | "a"; href?: string; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const still = useStill();
  const rx = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const r = el.getBoundingClientRect();
    const px = (event.clientX - r.left) / r.width, py = (event.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
    if (tilt && !still) { rx.set((0.5 - py) * 8); ry.set((px - 0.5) * 10); }
  };
  const leave = () => { rx.set(0); ry.set(0); };
  const style = tilt && !still ? { rotateX: rx, rotateY: ry, transformPerspective: 900 } : undefined;
  if (as === "a") return <motion.a href={href} onClick={onClick} className={`ts-depth ${className}`} style={style} onPointerMove={move} onPointerLeave={leave}>{children}</motion.a>;
  return <motion.div className={`ts-depth ${className}`} style={style} onPointerMove={move} onPointerLeave={leave}>{children}</motion.div>;
}

/** Counts from 0 to `to` the first time it is seen; `format` turns the number into text. The server and
 *  the first render show the final figure, so the page reads right before (or without) the animation. */
export function CountUp({ to, format = (n) => String(Math.round(n)), duration = 1.6 }: { to: number; format?: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: "-60px" });
  const still = useStill();
  const [value, setValue] = useState(to);
  useEffect(() => {
    if (!seen || still) return;
    const run = animate(0, to, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: setValue });
    return () => run.stop();
  }, [seen, still, to, duration]);
  return <span ref={ref}>{format(value)}</span>;
}

const Silk = dynamic(() => import("./fx/silk"), { ssr: false });

/** Silk only where it is cheap and welcome: a wide screen, motion allowed, Data Saver off. */
const saveData = () => !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

// Thin waves of gold across a panel, each with a small light running along it.
const waves = [
  "M-40 70 C 200 -30, 380 250, 600 150 S 1000 10, 1240 110",
  "M-40 30 C 300 110, 600 -20, 900 50 S 1150 100, 1240 30",
  "M-40 300 C 120 110, 260 520, 420 330 S 760 110, 900 300 S 1120 520, 1240 250",
  "M-40 210 C 160 430, 330 30, 520 210 S 880 470, 1060 230 S 1200 110, 1240 150",
  "M-40 470 C 200 290, 420 630, 700 520 S 1080 350, 1240 440",
  "M-40 560 C 220 650, 420 380, 640 470 S 1040 630, 1240 520",
  "M-40 590 C 300 520, 650 630, 900 560 S 1150 520, 1240 580",
]

/** Thin gold waves with lights travelling along them, for the silver panels; still with reduced motion. */
function GoldWaves() {
  const id = useId();
  return (
    <svg className="ts-waves" viewBox="0 0 1200 600" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#a9791c" stopOpacity=".15" />
          <stop offset=".25" stopColor="#b98a28" stopOpacity=".85" />
          <stop offset=".6" stopColor="#d9ab45" stopOpacity=".9" />
          <stop offset="1" stopColor="#a9791c" stopOpacity=".2" />
        </linearGradient>
      </defs>
      {waves.map((d, i) => (
        <g key={d}>
          <path className="base" d={d} stroke={`url(#${id})`} vectorEffect="non-scaling-stroke" />
          <path className="light" d={d} pathLength={100} vectorEffect="non-scaling-stroke" style={{ animationDelay: `${i * -1.7}s`, animationDuration: `${7 + (i % 3) * 1.5}s` }} />
        </g>
      ))}
    </svg>
  );
}

/** A metallic panel that sets off the gold: deep graphite by default, or `silver` — a brushed silver
 *  deeper than the page, where black pieces read clearly, crossed by thin waves of gold light. Moving
 *  satin behind it on wide screens (React Bits' Silk), a still metallic gradient everywhere else. */
export function DeepPanel({ children, className = "", tone = "graphite" }: { children: ReactNode; className?: string; tone?: "graphite" | "silver" }) {
  const rich = useMedia("(min-width: 900px) and (prefers-reduced-motion: no-preference)", saveData);
  const silver = tone === "silver";
  return (
    <div className={`ts-deep ${tone} ${className}`}>
      {rich && <Silk className="ts-deep-silk" color={silver ? "#b4b6bc" : "#5d5f66"} sheenColor={silver ? "#ffffff" : "#f0d48c"} lightMode={silver} speed={2.2} scale={1.1} rotation={0.35} sheen={0.7} depth={0.65} glow={0.3} noiseIntensity={0.8} mouseInteraction interactionStrength={0.6} clickRipple={false} />}
      {silver && <GoldWaves />}
      <div className="ts-deep-in">{children}</div>
    </div>
  );
}

/** Seconds left on a 48-hour validation clock that really runs (it starts again when it reaches zero). */
export function useCountdown(start = 48 * 3600 - 1) {
  const [left, setLeft] = useState(start);
  useEffect(() => {
    const tick = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 48 * 3600 - 1)), 1000);
    return () => clearInterval(tick);
  }, []);
  const two = (n: number) => String(n).padStart(2, "0");
  return { hh: two(Math.floor(left / 3600)), mm: two(Math.floor((left % 3600) / 60)), ss: two(left % 60) };
}

/** The countdown as a large mono clock with blinking separators. */
export function LiveClock({ className = "ts-clock" }: { className?: string }) {
  const { hh, mm, ss } = useCountdown();
  return <b className={className} aria-hidden="true">{hh}<i>:</i>{mm}<i>:</i>{ss}</b>;
}
