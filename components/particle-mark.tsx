"use client";
// The loading mark: grains of light drift in from around it and gather into a shape, then breathe with
// a slow gleam until the page is ready — the landing's « gathering » (features/landing/fx/gather.tsx),
// as a loader. The shape is The One Space's mark when no brand is known (app/loading.tsx, the session
// screens), or an agency's own logo or name once it is (features/studio/session-screens.tsx): the
// loader stays theirs, in their colours.
//
// The shape is painted on an offscreen canvas and sampled, so any logo or word becomes grains. Flat typed
// arrays and one fill per colour keep it light; it stops when the tab is hidden. With reduced motion, the
// grains are drawn in place once. Before the script runs, a still mark shows if the wait drags on.
import { useEffect, useRef, useState } from "react";
import "./particle-mark.css";

// The One Space's mark (public/favicon.svg): a disc inside an open ring, on a 364.41 grid — the same
// drawing the landing's gathering forms.
const MARK_PATH = "M337.66,184.61l24.76,24.73c-1.4,9.44-3.53,18.62-6.32,27.49-23.74,75.61-95.39,129.97-179.4,127.5C79.96,361.48,1.54,281.9.02,185.13-1.58,83.17,80.61,0,182.21,0s182.21,81.59,182.21,182.21l-29.51-29.51c-14.36-74.67-82.09-130.34-161.97-125.7C95.82,31.46,32.96,93.15,27.17,170.18c-6.87,91.33,65.19,167.54,155.03,167.54,74.64,0,137.02-52.61,152.04-122.77l-25-25,16.86-16.89,11.55,11.55Z";
const MARK_SIZE = 364.41;
const GATHER_MS = 1500; // scattered → formed
const SPREAD_MS = 450; // the share of the gathering over which the grains set off, one after another
const GOLD = ["#f6dc8f", "#ecc76c", "#e2b450", "#d29d3a", "#bb8530"]; // light to deep, top to bottom

type Shape = { kind: "mark" } | { kind: "image"; src: string } | { kind: "text"; text: string; color: string };
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** The shape's points, every `gap` pixels, each with its colour (gold for the mark, the logo's own otherwise). */
function sample(w: number, h: number, gap: number, paint: (c: CanvasRenderingContext2D) => void, gold: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  paint(c);
  const data = c.getImageData(0, 0, w, h).data;
  const points: { x: number; y: number; color: string }[] = [];
  for (let y = 0; y < h; y += gap) for (let x = 0; x < w; x += gap) {
    const o = (y * w + x) * 4;
    if (data[o + 3] < 110) continue;
    // Colours rounded to 1/16 so a logo needs few fills.
    const q = (v: number) => Math.min(255, Math.round(v / 16) * 16);
    const color = gold ? GOLD[Math.min(GOLD.length - 1, Math.floor((y / h) * GOLD.length))] : `rgb(${q(data[o])},${q(data[o + 1])},${q(data[o + 2])})`;
    points.push({ x, y, color });
  }
  return points;
}

export function ParticleMark({ shape = { kind: "mark" }, className = "", onFail }: { shape?: Shape; className?: string; onFail?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const key = shape.kind === "mark" ? "mark" : shape.kind === "image" ? `image:${shape.src}` : `text:${shape.text}:${shape.color}`;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let alive = true, frame = 0;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const box = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width)), h = Math.max(1, Math.round(box.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const run = (points: { x: number; y: number; color: string }[]) => {
      if (!alive || !points.length) return;
      const n = points.length;
      const tx = new Float32Array(n), ty = new Float32Array(n), sx = new Float32Array(n), sy = new Float32Array(n);
      const bend = new Float32Array(n), delay = new Float32Array(n), dot = new Float32Array(n), phase = new Float32Array(n);
      const colors = [...new Set(points.map((p) => p.color))];
      const tone = new Uint16Array(n);
      const reach = Math.hypot(w, h) * 0.55;
      points.forEach((p, i) => {
        tx[i] = p.x; ty[i] = p.y; tone[i] = colors.indexOf(p.color);
        // From anywhere around, a little outside the shape, swirling in.
        const angle = Math.random() * Math.PI * 2, r = reach * (0.45 + Math.random() * 0.55);
        sx[i] = w / 2 + Math.cos(angle) * r; sy[i] = h / 2 + Math.sin(angle) * r;
        bend[i] = (Math.random() - 0.5) * 0.9;
        // The grains nearest the middle arrive first: the shape grows from its heart outwards.
        delay[i] = Math.min(1, Math.hypot(p.x - w / 2, p.y - h / 2) / (Math.min(w, h) * 0.6)) * 0.7 + Math.random() * 0.3;
        dot[i] = 1.1 + Math.random() * 0.8; phase[i] = Math.random() * Math.PI * 2;
      });
      const buckets: number[][] = colors.map(() => []);
      const start = performance.now();
      setLive(true);

      const draw = (now: number) => {
        frame = 0;
        if (!alive) return;
        const elapsed = still ? Infinity : now - start;
        ctx.clearRect(0, 0, w, h);
        for (const b of buckets) b.length = 0;
        // After forming, a gleam sweeps across every 2.6 s and the grains breathe a little.
        const formed = elapsed > GATHER_MS + SPREAD_MS;
        const sweep = formed ? ((elapsed - GATHER_MS - SPREAD_MS) % 2600) / 2600 : -1;
        const gleamX = sweep * (w + 80) - 40;
        for (let i = 0; i < n; i++) {
          const k = ease(Math.min(1, Math.max(0, (elapsed - delay[i] * SPREAD_MS) / GATHER_MS)));
          let x = tx[i], y = ty[i];
          if (k < 1) {
            const dx = tx[i] - sx[i], dy = ty[i] - sy[i], arc = Math.sin(Math.PI * k) * bend[i];
            x = sx[i] + dx * k - dy * arc; y = sy[i] + dy * k + dx * arc;
          } else if (!still) {
            x += Math.sin(elapsed * 0.0021 + phase[i]) * 0.45; y += Math.cos(elapsed * 0.0017 + phase[i]) * 0.45;
          }
          buckets[tone[i]].push(x, y, dot[i] * (0.55 + 0.45 * k), formed ? Math.max(0, 1 - Math.abs(x - gleamX) / 26) : 0);
        }
        for (let c = 0; c < colors.length; c++) {
          const b = buckets[c];
          if (!b.length) continue;
          ctx.fillStyle = colors[c];
          for (let j = 0; j < b.length; j += 4) ctx.fillRect(b[j], b[j + 1], b[j + 2], b[j + 2]);
        }
        if (formed) {
          // The gleam: the same grains again in light, faded by their distance to the sweep.
          ctx.fillStyle = "#fff8e6";
          for (const b of buckets) for (let j = 0; j < b.length; j += 4) {
            if (b[j + 3] <= 0) continue;
            ctx.globalAlpha = b[j + 3] * 0.85; ctx.fillRect(b[j], b[j + 1], b[j + 2], b[j + 2]);
          }
          ctx.globalAlpha = 1;
        }
        if (!still && !document.hidden) frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      const wake = () => { if (!document.hidden && !frame && alive && !still) frame = requestAnimationFrame(draw); };
      document.addEventListener("visibilitychange", wake);
      cleanup.push(() => document.removeEventListener("visibilitychange", wake));
    };
    const cleanup: (() => void)[] = [];

    const gap = Math.max(2, Math.round(Math.min(w, h) / 70));
    const fit = (iw: number, ih: number, share: number) => { const s = Math.min((w * share) / iw, (h * share) / ih); return { s, x: (w - iw * s) / 2, y: (h - ih * s) / 2 }; };
    if (shape.kind === "mark") {
      const { s, x, y } = fit(MARK_SIZE, MARK_SIZE, 0.62);
      run(sample(w, h, gap, (c) => {
        c.translate(x, y); c.scale(s, s); c.fillStyle = "#000"; c.fill(new Path2D(MARK_PATH));
        c.beginPath(); c.arc(182.21, 182.22, 75.13, 0, Math.PI * 2); c.fill();
      }, true));
    } else if (shape.kind === "text") {
      run(sample(w, h, gap, (c) => {
        const font = getComputedStyle(el).fontFamily;
        let size = h * 0.42;
        c.font = `650 ${size}px ${font}`;
        size = Math.min(size, (size * w * 0.86) / Math.max(1, c.measureText(shape.text).width));
        c.font = `650 ${size}px ${font}`; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillStyle = shape.color === "currentColor" ? getComputedStyle(el).color : shape.color;
        c.fillText(shape.text, w / 2, h / 2);
      }, false));
    } else {
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        const { s, x, y } = fit(img.naturalWidth || w, img.naturalHeight || h, 0.86);
        try { run(sample(w, h, gap, (c) => c.drawImage(img, x, y, (img.naturalWidth || w) * s, (img.naturalHeight || h) * s), false)); }
        catch { onFail?.(); } // a logo that cannot be read back
      };
      img.onerror = () => { if (alive) onFail?.(); };
      img.src = shape.src;
    }
    return () => { alive = false; cancelAnimationFrame(frame); cleanup.forEach((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the shape is identified by its key
  }, [key]);

  return (
    <span className={`particle-mark ${shape.kind} ${live ? "live" : ""} ${className}`} aria-hidden="true">
      {/* The still mark, for the first instants before the script runs. */}
      {shape.kind === "mark" && (
        <svg className="particle-mark-still" viewBox="0 0 364.41 364.41" focusable="false">
          <path d={MARK_PATH} /><circle cx="182.21" cy="182.22" r="75.13" />
        </svg>
      )}
      <canvas ref={canvas} />
    </span>
  );
}
