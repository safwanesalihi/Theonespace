"use client";
// A figure that counts up the first time it comes into view (after Magic UI's Number Ticker, on Motion):
// « 96 % », « 31 h », « 2,4 ». Anything that does not start with a number, and every later change, shows
// as is; with reduced motion the figure never moves.
import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

const figure = /^(\d+(?:[.,]\d+)?)([\s\S]*)$/;

export function NumberTicker({ value, className }: { value: string | number; className?: string }) {
  const text = String(value);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const played = useRef(false), done = useRef(false);
  const [frame, setFrame] = useState<string | null>(() => (figure.test(text) ? text.replace(/^\d+(?:([.,])(\d+))?/, (_, sep, dec) => (dec ? `0${sep}${"0".repeat(dec.length)}` : "0")) : null));
  useEffect(() => {
    const match = figure.exec(text);
    if (!inView || played.current) return;
    played.current = true;
    if (!match || reduce) { queueMicrotask(() => setFrame(null)); return; }
    const [, num, rest] = match;
    const decimals = (num.split(/[.,]/)[1] ?? "").length;
    const sep = num.includes(",") ? "," : ".";
    const controls = animate(0, parseFloat(num.replace(",", ".")), {
      duration: 0.9, ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setFrame(v.toFixed(decimals).replace(".", sep) + rest),
      onComplete: () => { done.current = true; setFrame(null); },
    });
    return () => { controls.stop(); if (!done.current) played.current = false; };
  }, [inView, reduce, text]);
  return <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{frame ?? text}</span>;
}
