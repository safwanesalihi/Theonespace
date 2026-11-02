"use client";
// Gather — every shape is made of the same grains of light, and the scroll (`progress`, 0 to 1) tells
// one story in four acts:
//   1. scattered: the agency's six tools, each as its icon and its name in its own colours (WhatsApp's
//      green, Drive's three colours, Figma's five...), drift loosely apart, their trouble written under;
//   2. pulled in: each tool, whole and recognisable, spirals into the middle, a trail of its colour
//      behind it;
//   3. fused: their grains melt into The One Space's mark, turning gold, with a flash of light;
//   4. the mark holds, lit (the stage then draws the modules around it: gather-stage.tsx).
// In the spirit of the image-to-particles tools (and React Bits' particle backgrounds), written for this
// one picture: the shapes are painted on an offscreen canvas and sampled, colour included, so any word
// in any script becomes grains. The pointer pushes the grains aside; they spring back.
// Smooth by design: flat typed arrays, one fill per colour, paths worked out once per size, never above
// 1.5x; it draws while the tools are in the air and rests once the mark has formed and nothing moves.
// Wide screens with motion only (the page shows the plain drawing otherwise), so the canvas never has
// to be accessible: the section prints every word it shows.
import { useEffect, useRef } from "react";
import type { MotionValue } from "motion/react";

export type GatherTool = "whatsapp" | "mail" | "drive" | "excel" | "invoice" | "design";
export type GatherWord = { tool: GatherTool; text: string; note: string; x: number; y: number; rot: number };

// The One Space's mark (public/favicon.svg): a disc inside an open ring, on a 364.41 grid.
const MARK = new Path2D("M337.66,184.61l24.76,24.73c-1.4,9.44-3.53,18.62-6.32,27.49-23.74,75.61-95.39,129.97-179.4,127.5C79.96,361.48,1.54,281.9.02,185.13-1.58,83.17,80.61,0,182.21,0s182.21,81.59,182.21,182.21l-29.51-29.51c-14.36-74.67-82.09-130.34-161.97-125.7C95.82,31.46,32.96,93.15,27.17,170.18c-6.87,91.33,65.19,167.54,155.03,167.54,74.64,0,137.02-52.61,152.04-122.77l-25-25,16.86-16.89,11.55,11.55Z");
const MARK_SIZE = 364.41;
/** The mark's size on the stage, as a share of its shorter side (gather-stage.tsx places the name under it). */
export const MARK_SHARE = 0.4;

// The story's beats, in `progress`.
const NOTES_OUT = 0.13; // the trouble under each tool has faded
const PULL = [0.1, 0.03, 0.32]; // tool i starts spiralling in at PULL[0] + i * PULL[1], for PULL[2]
const FUSE = [0.52, 0.1, 0.16]; // a grain melts into the mark from FUSE[0] + its delay * FUSE[1], for FUSE[2]
const LIT = 0.74; // the flash when the mark has formed
const REST = 0.78; // from here on, nothing moves on its own

// Every colour a tool is drawn in: the grains are snapped to the nearest, then shaded towards gold.
const PALETTE = ["#25D366", "#EA4335", "#4285F4", "#FBBC04", "#34A853", "#8AB4F8", "#33C481", "#D5D9E0", "#F24E1E", "#FF7262", "#A259FF", "#1ABCFE", "#0ACF83", "#B886FF"];
const RGB = PALETTE.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const GOLD = [233, 192, 98];
const SHADES = 10;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// Each tool: the colour of its name, and its icon on a 24 grid (simplified, recognisable at a glance).
export const TOOLS: Record<GatherTool, { ink: string; icon: (c: CanvasRenderingContext2D) => void }> = {
  whatsapp: { ink: "#25D366", icon: (c) => {
    c.strokeStyle = c.fillStyle = "#25D366"; c.lineWidth = 2.4;
    c.beginPath(); c.arc(12, 11.6, 8.4, 0.62 * Math.PI, 2.55 * Math.PI); c.stroke();
    c.beginPath(); c.moveTo(6.4, 16.2); c.lineTo(3.6, 21); c.lineTo(8.8, 19.3); c.closePath(); c.fill();
    c.fill(new Path2D("M9.1 7.4c-.6 0-1.3.6-1.3 1.5 0 3.6 3.1 6.9 6.7 7.1.8 0 1.4-.6 1.4-1.2v-1.4l-2.2-.9-1.1 1.1c-1.5-.7-2.7-1.9-3.4-3.4l1.1-1.1-.9-2.2z"));
  } },
  mail: { ink: "#EA4335", icon: (c) => {
    c.strokeStyle = "#EA4335"; c.lineWidth = 2.4;
    c.beginPath(); c.roundRect(3, 5.5, 18, 13, 2.5); c.stroke();
    c.beginPath(); c.moveTo(4, 7); c.lineTo(12, 13); c.lineTo(20, 7); c.stroke();
  } },
  drive: { ink: "#8AB4F8", icon: (c) => {
    c.lineWidth = 3.2;
    const side = (color: string, a: number[], b: number[]) => { c.strokeStyle = color; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); };
    side("#34A853", [12, 3.5], [3, 19]); side("#FBBC04", [12, 3.5], [21, 19]); side("#4285F4", [3, 19.5], [21, 19.5]);
  } },
  excel: { ink: "#33C481", icon: (c) => {
    c.fillStyle = "#33C481"; c.beginPath(); c.roundRect(3, 3, 18, 18, 4); c.fill();
    c.globalCompositeOperation = "destination-out"; c.lineWidth = 2.8;
    c.beginPath(); c.moveTo(8.2, 7.8); c.lineTo(15.8, 16.2); c.moveTo(15.8, 7.8); c.lineTo(8.2, 16.2); c.stroke();
    c.globalCompositeOperation = "source-over";
  } },
  invoice: { ink: "#D5D9E0", icon: (c) => {
    c.strokeStyle = "#D5D9E0"; c.lineWidth = 2.2;
    c.stroke(new Path2D("M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"));
    c.beginPath(); c.moveTo(9, 8); c.lineTo(15, 8); c.moveTo(9, 12); c.lineTo(15, 12); c.moveTo(9, 16); c.lineTo(12.5, 16); c.stroke();
  } },
  design: { ink: "#B886FF", icon: (c) => {
    const part = (color: string, draw: () => void) => { c.fillStyle = color; c.beginPath(); draw(); c.fill(); };
    part("#F24E1E", () => c.roundRect(6, 2.5, 6, 6, [3, 0, 0, 3]));
    part("#FF7262", () => c.roundRect(12, 2.5, 6, 6, [0, 3, 3, 0]));
    part("#A259FF", () => c.roundRect(6, 8.5, 6, 6, [3, 0, 0, 3]));
    part("#1ABCFE", () => c.arc(15, 11.5, 3, 0, Math.PI * 2));
    part("#0ACF83", () => c.roundRect(6, 14.5, 6, 6, [3, 0, 3, 3]));
  } },
};

/** The points of whatever `draw` paints, every `gap` pixels, each with its palette colour. */
function sample(w: number, h: number, gap: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  draw(ctx);
  const data = ctx.getImageData(0, 0, w, h).data;
  const out: [number, number, number][] = [];
  for (let y = 0; y < h; y += gap) for (let x = 0; x < w; x += gap) {
    const o = (y * w + x) * 4;
    if (data[o + 3] <= 128) continue;
    let best = 0, dist = Infinity;
    for (let p = 0; p < RGB.length; p++) { const d = (data[o] - RGB[p][0]) ** 2 + (data[o + 1] - RGB[p][1]) ** 2 + (data[o + 2] - RGB[p][2]) ** 2; if (d < dist) { dist = d; best = p; } }
    out.push([x, y, best]);
  }
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
    // The grains, one slot each in flat arrays: its tool and its place in the tool's drawing, its place in
    // the mark, its bend and delay on the way, colour, dot size, and the pointer's push.
    let n = 0, lx = new Float32Array(0), ly = lx, bx = lx, by = lx, bendX = lx, bendY = lx, delay = lx, dot = lx, ox = lx, oy = lx, vx = lx, vy = lx, hue = new Uint8Array(0), owner = hue;
    let w = 0, h = 0, frame = 0, visible = false, lastP = -1, trailing = false;
    const pointer = { x: -1e4, y: -1e4, in: false };
    const fills = RGB.map((rgb) => Array.from({ length: SHADES + 1 }, (_, s) => `rgb(${rgb.map((c, i) => Math.round(c + (GOLD[i] - c) * (s / SHADES))).join(",")})`));
    const buckets: number[][] = Array.from({ length: RGB.length * (SHADES + 1) }, () => []);
    // Each tool's place this frame: centre, and its drawing's turn and scale (cos and sin, scaled).
    const gx = new Float32Array(words.length), gy = new Float32Array(words.length), gc = new Float32Array(words.length), gs = new Float32Array(words.length);

    const wordSize = () => Math.round(Math.min(w * 0.06, h * 0.1));
    /** Lays one tool out around its spot: icon then name (name then icon in Arabic), shrunk to fit. */
    const place = (c: CanvasRenderingContext2D, word: GatherWord, size: number, paint: (left: number, icon: number, gap: number, text: number) => void) => {
      c.font = `700 ${size}px ${font}`;
      const icon = size * 1.05, gap = size * 0.32, text = c.measureText(word.text).width, width = icon + gap + text;
      const fit = Math.min(1, (w * 0.27) / width);
      c.save(); c.translate((word.x / 100) * w, (word.y / 100) * h); c.rotate((word.rot * Math.PI) / 180); c.scale(fit, fit);
      paint(-width / 2, icon, gap, text);
      c.restore();
    };

    const layout = () => {
      const box = el.getBoundingClientRect();
      w = Math.max(1, Math.round(box.width)); h = Math.max(1, Math.round(box.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gap = w > 1100 ? 5 : 4;
      const size = wordSize();
      // Each tool sampled on its own, so every grain knows which tool it belongs to.
      const from: [number, number, number, number][] = [];
      words.forEach((word, t) => {
        const cx = (word.x / 100) * w, cy = (word.y / 100) * h;
        for (const [x, y, colour] of sample(w, h, gap, (c) => {
          c.textBaseline = "middle"; c.textAlign = "left"; c.direction = "ltr";
          place(c, word, size, (left, icon, space, text) => {
            const iconAt = rtl ? left + text + space : left, textAt = rtl ? left : left + icon + space;
            c.save(); c.translate(iconAt, -icon / 2); c.scale(icon / 24, icon / 24); TOOLS[word.tool].icon(c); c.restore();
            c.fillStyle = TOOLS[word.tool].ink;
            if (rtl) { c.direction = "rtl"; c.textAlign = "right"; c.fillText(word.text, textAt + text, 0); c.direction = "ltr"; c.textAlign = "left"; }
            else c.fillText(word.text, textAt, 0);
          });
        })) from.push([x - cx, y - cy, colour, t]);
      });
      shuffle(from);
      const mark = Math.min(w, h) * MARK_SHARE;
      const to = shuffle(sample(w, h, gap, (c) => { c.fillStyle = "#D5D9E0"; c.translate(w / 2 - mark / 2, h / 2 - mark / 2); c.scale(mark / MARK_SIZE, mark / MARK_SIZE); c.fill(MARK); c.beginPath(); c.arc(182.21, 182.22, 75.13, 0, Math.PI * 2); c.fill(); }));
      n = from.length && to.length ? Math.max(from.length, to.length) : 0;
      const f = () => new Float32Array(n);
      lx = f(); ly = f(); bx = f(); by = f(); bendX = f(); bendY = f(); delay = f(); dot = f(); ox = f(); oy = f(); vx = f(); vy = f(); hue = new Uint8Array(n); owner = new Uint8Array(n);
      const reach = Math.min(w, h) * 0.12;
      for (let i = 0; i < n; i++) {
        const a = from[i % from.length], b = to[i % to.length];
        lx[i] = a[0]; ly[i] = a[1]; hue[i] = a[2]; owner[i] = a[3]; bx[i] = b[0]; by[i] = b[1];
        // A small sideways swirl as the grain melts into the mark.
        const angle = Math.random() * Math.PI * 2;
        bendX[i] = Math.cos(angle) * reach * Math.random(); bendY[i] = Math.sin(angle) * reach * Math.random();
        delay[i] = Math.random(); dot[i] = 1.2 + Math.random() * 0.9;
      }
      lastP = -1;
    };

    /** Where each tool is at `p` and time `now`: drifting at its spot, then spiralling into the middle. */
    const tools = (p: number, now: number) => {
      const cx = w / 2, cy = h / 2, end = Math.min(w, h) * 0.14;
      words.forEach((word, t) => {
        const k = ease(clamp01((p - PULL[0] - t * PULL[1]) / PULL[2]));
        const sx = (word.x / 100) * w - cx, sy = (word.y / 100) * h - cy;
        const r = Math.hypot(sx, sy) + (end - Math.hypot(sx, sy)) * k, turn = Math.atan2(sy, sx) + 1.5 * k;
        const drift = 1 - k;
        gx[t] = cx + Math.cos(turn) * r + Math.sin(now * 0.0007 + t * 1.7) * 7 * drift;
        gy[t] = cy + Math.sin(turn) * r + Math.cos(now * 0.0009 + t * 2.3) * 5 * drift;
        const scale = 1 - 0.68 * k, spin = 1.1 * k + Math.sin(now * 0.0006 + t) * 0.03 * drift;
        gc[t] = Math.cos(spin) * scale; gs[t] = Math.sin(spin) * scale;
      });
    };

    const draw = (now: number) => {
      frame = 0;
      if (!visible) return;
      const p = progress.get();
      // While the tools fly, each frame only fades the last one, which leaves a short trail of colour.
      const flying = p > NOTES_OUT && p < LIT;
      if (flying) {
        ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0,0,0,.34)"; ctx.fillRect(0, 0, w, h); ctx.restore();
      } else ctx.clearRect(0, 0, w, h);
      trailing = flying;
      tools(p, now);
      // The trouble under each tool, fading as the tools leave.
      const notes = 1 - p / NOTES_OUT;
      if (notes > 0) {
        const size = wordSize();
        ctx.save();
        ctx.globalAlpha = notes; ctx.fillStyle = "#c9c6bf"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.direction = rtl ? "rtl" : "ltr";
        words.forEach((word, t) => place(ctx, { ...word, x: (gx[t] / w) * 100, y: (gy[t] / h) * 100 }, size, () => { ctx.font = `500 ${Math.max(12, Math.round(size * 0.3))}px ${font}`; ctx.fillText(word.note, 0, size * 1.05); }));
        ctx.restore();
      }
      // The light of the formed mark: a flash as it closes, then a steady glow.
      const lit = clamp01((p - (LIT - 0.1)) / 0.1);
      if (lit > 0) {
        const flash = Math.max(0, 1 - Math.abs(p - LIT) / 0.05), r = Math.min(w, h) * MARK_SHARE;
        const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r * (0.9 + flash * 0.3));
        glow.addColorStop(0, `rgba(233,192,98,${0.22 * lit + 0.3 * flash})`); glow.addColorStop(1, "rgba(233,192,98,0)");
        ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      }
      for (const b of buckets) b.length = 0;
      let moving = false;
      for (let i = 0; i < n; i++) {
        const t = owner[i];
        let x = gx[t] + lx[i] * gc[t] - ly[i] * gs[t];
        let y = gy[t] + lx[i] * gs[t] + ly[i] * gc[t];
        const k = ease(clamp01((p - FUSE[0] - delay[i] * FUSE[1]) / FUSE[2]));
        if (k > 0) { const arc = Math.sin(Math.PI * k); x += (bx[i] - x) * k + bendX[i] * arc; y += (by[i] - y) * k + bendY[i] * arc; }
        // The pointer pushes; a spring brings the grain home.
        if (pointer.in || vx[i] !== 0 || vy[i] !== 0) {
          const px = x + ox[i] - pointer.x, py = y + oy[i] - pointer.y, d2 = px * px + py * py;
          if (d2 < 8100) { const d = Math.sqrt(d2) || 1, f = (90 - d) / 90; vx[i] += (px / d) * f * 2.4; vy[i] += (py / d) * f * 2.4; }
          vx[i] = (vx[i] - ox[i] * 0.06) * 0.86; vy[i] = (vy[i] - oy[i] * 0.06) * 0.86;
          ox[i] += vx[i]; oy[i] += vy[i];
          if (Math.abs(vx[i]) + Math.abs(vy[i]) + Math.abs(ox[i]) + Math.abs(oy[i]) < 0.02) { vx[i] = vy[i] = ox[i] = oy[i] = 0; } else moving = true;
          x += ox[i]; y += oy[i];
        }
        buckets[hue[i] * (SHADES + 1) + Math.round(k * SHADES)].push(x, y, dot[i]);
      }
      for (let c = 0; c < RGB.length; c++) for (let s = 0; s <= SHADES; s++) {
        const b = buckets[c * (SHADES + 1) + s];
        if (!b.length) continue;
        ctx.fillStyle = fills[c][s];
        for (let j = 0; j < b.length; j += 3) ctx.fillRect(b[j], b[j + 1], b[j + 2], b[j + 2]);
      }
      // Before the mark has formed the tools drift and trail, so it keeps drawing; after, only while the
      // scroll or the pointer moves something, and at rest the canvas costs nothing.
      if (p < REST || p !== lastP || moving || trailing) frame = requestAnimationFrame(draw);
      lastP = p;
    };
    const start = () => { if (visible && !frame) frame = requestAnimationFrame(draw); };

    layout();
    const resize = new ResizeObserver(() => { layout(); start(); });
    resize.observe(el);
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible && frame) { cancelAnimationFrame(frame); frame = 0; } start(); });
    seen.observe(el);
    const stop = progress.on("change", start);
    const move = (e: PointerEvent) => { const box = el.getBoundingClientRect(); pointer.x = e.clientX - box.left; pointer.y = e.clientY - box.top; pointer.in = true; start(); };
    const leave = () => { pointer.x = pointer.y = -1e4; pointer.in = false; start(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { cancelAnimationFrame(frame); stop(); resize.disconnect(); seen.disconnect(); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [words, progress]);

  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}
