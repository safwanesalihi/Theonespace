"use client";
// The stamp: the seal of a validated piece of work (the home page's gold coin, components/ui/seal.tsx, marks
// the one priority; this one marks a decision taken). When the decision has just been taken it strikes (falls
// from above, lands with one heavy bounce, leaves a ring of ink), otherwise it simply sits there. Gold in
// the studio; in the client portal it takes the agency's colour (styles/moments.css, --stamp-*).
import { useId, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { beat, ease, spring, still } from "@/lib/motion";

/** A wax edge of 18 soft teeth around a 32-unit centre. */
const edge = (() => {
  const teeth = 18, out = 31, inner = 28.4, pts: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a = (Math.PI * i) / teeth - Math.PI / 2, r = i % 2 ? inner : out;
    pts.push(`${(32 + r * Math.cos(a)).toFixed(2)} ${(32 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
})();

export function Stamp({ play = false, size = 56, className = "" }: { play?: boolean; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const strike = play && !reduce;
  return (
    <motion.span
      className={`stamp ${className}`}
      style={{ "--stamp": `${size}px` } as CSSProperties}
      aria-hidden="true"
      initial={strike ? { scale: 2.4, rotate: -32, opacity: 0, y: -18 } : false}
      animate={{ scale: 1, rotate: -8, opacity: 1, y: 0 }}
      transition={strike ? { ...spring.strike, opacity: { duration: beat.tap } } : still}
    >
      <svg viewBox="0 0 64 64">
        <defs>
          <linearGradient id={`stamp-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--stamp-1)" }} />
            <stop offset=".46" style={{ stopColor: "var(--stamp-2)" }} />
            <stop offset="1" style={{ stopColor: "var(--stamp-3)" }} />
          </linearGradient>
        </defs>
        <path d={edge} fill={`url(#stamp-${id})`} />
        <circle cx="32" cy="32" r="22.5" fill="none" className="stamp-ring" strokeWidth="1.2" strokeDasharray="2 2.6" />
        <circle cx="32" cy="32" r="19" fill="none" className="stamp-ring" strokeWidth="0.8" />
        <path d="M23.5 32.6l5.6 5.6 11.4-12" fill="none" className="stamp-check" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {strike && (
        <motion.span
          className="stamp-ink"
          initial={{ scale: 0.7, opacity: 0.6 }}
          animate={{ scale: 1.9, opacity: 0 }}
          transition={{ delay: 0.14, duration: beat.moment, ease: ease.arrive }}
        />
      )}
    </motion.span>
  );
}
