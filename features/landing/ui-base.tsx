"use client";
// The landing's pieces that need no motion library, for the first screen (the header and the hero, v6.tsx):
// the media queries (reduced motion, rich effects), the deep silver panel with its gold waves, and the
// two scroll readings the header and the hero's lean follow. ui.tsx holds the animated pieces, which come
// with the rest of the page (v6-sections.tsx).
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

/** Follows a media query; during hydration it answers false, like the server, so both render alike. */
export function useMedia(query: string, extra: () => boolean = () => true) {
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

// Data Saver off, and a machine that can carry it: at least 4 cores and 4 GB where the browser says.
const able = () => {
  const n = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  return !n.connection?.saveData && (n.hardwareConcurrency ?? 8) >= 4 && (n.deviceMemory ?? 8) >= 4;
};

/** Rich effects only where they are cheap and welcome: a wide screen, motion allowed, Data Saver off, not a
 *  low-end machine. */
export function useRich() {
  return useMedia("(min-width: 900px) and (prefers-reduced-motion: no-preference)", able);
}

/** Runs `read` on scroll and resize, once per frame at most, and once at the start. */
function useScrollRead(read: () => void) {
  useEffect(() => {
    let frame = 0;
    const queue = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; read(); }); };
    read();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", queue); window.removeEventListener("resize", queue); };
  }, [read]);
}

/** Whether the page has scrolled past `y` pixels (false on the server). */
export function useScrolledPast(y: number) {
  const [past, setPast] = useState(false);
  const [read] = useState(() => () => setPast(window.scrollY > y));
  useScrollRead(read);
  return past;
}

/** Calls `onProgress` with how far `ref` has come into view: 0 when its top meets the bottom of the window,
 *  1 when its centre meets the window's centre (motion's useScroll offsets "start end" → "center center"),
 *  clamped. Straight from the scroll, once per frame, without re-rendering. Always the latest `onProgress`
 *  (it may read state that changes after hydration, such as reduced motion). */
export function useEntering(ref: RefObject<HTMLElement | null>, onProgress: (progress: number) => void) {
  const latest = useRef(onProgress);
  useEffect(() => { latest.current = onProgress; });
  const [read] = useState(() => () => {
    const el = ref.current;
    if (!el) return;
    const { top, height } = el.getBoundingClientRect(), vh = window.innerHeight;
    const span = vh - (vh - height) / 2;
    latest.current(span > 0 ? Math.min(1, Math.max(0, (vh - top) / span)) : 1);
  });
  useScrollRead(read);
}

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
 *  deeper than the page, where black pieces read clearly, crossed by thin waves of gold light. A slow
 *  satin sheen moves across it (space.css: transform only, drawn by the GPU, no WebGL to compile). */
export function DeepPanel({ children, className = "", tone = "graphite" }: { children: ReactNode; className?: string; tone?: "graphite" | "silver" }) {
  const silver = tone === "silver";
  return (
    <div className={`ts-deep ${tone} ${className}`}>
      <span className="ts-deep-silk" aria-hidden="true" />
      {silver && <GoldWaves />}
      <div className="ts-deep-in">{children}</div>
    </div>
  );
}
