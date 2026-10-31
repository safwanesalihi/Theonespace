"use client";
// Gather — every shape is made of the same grains of light. The agency's six tools are drawn as words
// scattered askew (grey grains, with their thread of trouble under each); as `progress` goes from 0 to 1
// the grains leave the words and gather into The One Space's mark, turning gold on the way. In the spirit
// of the image-to-particles tools (and React Bits' particle backgrounds), written for this one picture:
// the shapes are sampled from an offscreen canvas, so any word, in any script, becomes grains.
// The pointer pushes the grains aside; they spring back. Drawn only while on screen. Wide screens with
// motion only (the page shows the plain drawing otherwise), so the canvas never has to be accessible:
// the section prints every word it shows.
import { useEffect, useRef } from "react";
import type { MotionValue } from "motion/react";

export type GatherWord = { text: string; note: string; x: number; y: number; rot: number };

// The One Space's mark (public/favicon.svg): a disc inside an open ring, on a 364.41 grid.
const MARK = new Path2D("M337.66,184.61l24.76,24.73c-1.4,9.44-3.53,18.62-6.32,27.49-23.74,75.61-95.39,129.97-179.4,127.5C79.96,361.48,1.54,281.9.02,185.13-1.58,83.17,80.61,0,182.21,0s182.21,81.59,182.21,182.21l-29.51-29.51c-14.36-74.67-82.09-130.34-161.97-125.7C95.82,31.46,32.96,93.15,27.17,170.18c-6.87,91.33,65.19,167.54,155.03,167.54,74.64,0,137.02-52.61,152.04-122.77l-25-25,16.86-16.89,11.55,11.55Z");
const MARK_SIZE = 364.41;

const SILVER = [176, 178, 186];
const GOLD = [233, 192, 98];
const SHADES = 10;
const shade = (k: number) => `rgb(${SILVER.map((c, i) => Math.round(c + (GOLD[i] - c) * k)).join(",")})`;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type Grain = { ax: number; ay: number; bx: number; by: number; delay: number; swirl: number; seed: number; size: number; ox: number; oy: number; vx: number; vy: number };

/** The points of whatever `draw` paints, every `gap` pixels. */
function sample(w: number, h: number, gap: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  draw(ctx);
  const data = ctx.getImageData(0, 0, w, h).data;
  const out: [number, number][] = [];
  for (let y = 0; y < h; y += gap) for (let x = 0; x < w; x += gap) if (data[(y * w + x) * 4 + 3] > 128) out.push([x, y]);
  return out;
}

function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

export default function Gather({ words, progress, className = "" }: { words: GatherWord[]; progress: MotionValue<number>; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const { fontFamily: font, direction } = getComputedStyle(el);
    const rtl = direction === "rtl";
    let w = 0, h = 0, grains: Grain[] = [], frame = 0, visible = false;
    const pointer = { x: -1e4, y: -1e4 };
    const fills = Array.from({ length: SHADES + 1 }, (_, k) => shade(k / SHADES));
    const buckets: number[][] = Array.from({ length: SHADES + 1 }, () => []);

    const wordSize = () => Math.round(Math.min(w * 0.075, h * 0.12));
    const layout = () => {
      const box = el.getBoundingClientRect();
      w = Math.max(1, Math.round(box.width)); h = Math.max(1, Math.round(box.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gap = w > 1100 ? 5 : 4;
      const size = wordSize();
      const from = shuffle(sample(w, h, gap, (c) => {
        c.font = `700 ${size}px ${font}`; c.textAlign = "center"; c.textBaseline = "middle";
        // A long word (« البريد الإلكتروني ») shrinks to keep to its third of the stage.
        for (const word of words) { const fit = Math.min(1, (w * 0.27) / c.measureText(word.text).width); c.save(); c.translate((word.x / 100) * w, (word.y / 100) * h); c.rotate((word.rot * Math.PI) / 180); c.scale(fit, fit); c.fillText(word.text, 0, 0); c.restore(); }
      }));
      const mark = Math.min(w, h) * 0.5;
      const to = shuffle(sample(w, h, gap, (c) => { c.translate(w / 2 - mark / 2, h / 2 - mark / 2); c.scale(mark / MARK_SIZE, mark / MARK_SIZE); c.fill(MARK); c.beginPath(); c.arc(182.21, 182.22, 75.13, 0, Math.PI * 2); c.fill(); }));
      if (!from.length || !to.length) { grains = []; return; }
      const n = Math.max(from.length, to.length);
      grains = Array.from({ length: n }, (_, i) => {
        const [ax, ay] = from[i % from.length], [bx, by] = to[i % to.length];
        return { ax, ay, bx, by, delay: Math.random() * 0.35, swirl: (Math.random() - 0.5) * Math.min(w, h) * 0.5, seed: Math.random() * 6.283, size: 1.1 + Math.random() * 0.9, ox: 0, oy: 0, vx: 0, vy: 0 };
      });
    };

    const draw = (time: number) => {
      frame = 0;
      if (!visible) return;
      const p = progress.get();
      const t = time / 1000;
      ctx.clearRect(0, 0, w, h);
      // The trouble under each tool, fading as the grains leave.
      const notes = Math.max(0, 1 - p * 3);
      if (notes > 0) {
        const size = wordSize();
        ctx.save();
        ctx.globalAlpha = notes;
        ctx.fillStyle = "#c9c6bf";
        ctx.font = `500 ${Math.max(12, Math.round(size * 0.24))}px ${font}`;
        ctx.textAlign = "center";
        ctx.direction = rtl ? "rtl" : "ltr";
        for (const word of words) { ctx.save(); ctx.translate((word.x / 100) * w, (word.y / 100) * h); ctx.rotate((word.rot * Math.PI) / 180); ctx.fillText(word.note, 0, size * 0.78); ctx.restore(); }
        ctx.restore();
      }
      for (const b of buckets) b.length = 0;
      for (let i = 0; i < grains.length; i++) {
        const g = grains[i];
        const k = ease(Math.min(1, Math.max(0, (p - g.delay) / 0.65)));
        const arc = Math.sin(Math.PI * k) * g.swirl;
        const dx = g.bx - g.ax, dy = g.by - g.ay, len = Math.hypot(dx, dy) || 1;
        let x = g.ax + dx * k - (dy / len) * arc + Math.sin(t * 1.3 + g.seed) * 0.6;
        let y = g.ay + dy * k + (dx / len) * arc + Math.cos(t * 1.1 + g.seed) * 0.6;
        // The pointer pushes; a spring brings the grain home.
        const px = x + g.ox - pointer.x, py = y + g.oy - pointer.y, d2 = px * px + py * py;
        if (d2 < 8100) { const d = Math.sqrt(d2) || 1, f = (90 - d) / 90; g.vx += (px / d) * f * 2.4; g.vy += (py / d) * f * 2.4; }
        g.vx = (g.vx - g.ox * 0.06) * 0.86; g.vy = (g.vy - g.oy * 0.06) * 0.86;
        g.ox += g.vx; g.oy += g.vy;
        x += g.ox; y += g.oy;
        buckets[Math.round(k * SHADES)].push(x, y, g.size);
      }
      for (let s = 0; s <= SHADES; s++) {
        const b = buckets[s];
        if (!b.length) continue;
        ctx.fillStyle = fills[s];
        for (let j = 0; j < b.length; j += 3) ctx.fillRect(b[j], b[j + 1], b[j + 2], b[j + 2]);
      }
      frame = requestAnimationFrame(draw);
    };
    const start = () => { if (visible && !frame) frame = requestAnimationFrame(draw); };

    layout();
    const resize = new ResizeObserver(() => { layout(); start(); });
    resize.observe(el);
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible && frame) { cancelAnimationFrame(frame); frame = 0; } start(); });
    seen.observe(el);
    const move = (e: PointerEvent) => { const box = el.getBoundingClientRect(); pointer.x = e.clientX - box.left; pointer.y = e.clientY - box.top; };
    const leave = () => { pointer.x = pointer.y = -1e4; };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); seen.disconnect(); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [words, progress]);

  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}
