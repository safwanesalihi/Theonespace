"use client";
// Deciding with the thumb: on a touch screen the decision card can be thrown toward the reading
// direction's end to approve, or back toward its start to ask for changes. Under the card the answer it
// is about to give shows through, and the phone ticks once when the throw is far enough. A throw only
// opens the same confirmation as the buttons, which stay where they are; with a mouse, a keyboard or
// reduced motion the card simply doesn't move.
import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { spring } from "@/lib/motion";

const coarse = "(pointer: coarse)";
const subscribe = (change: () => void) => { const m = window.matchMedia(coarse); m.addEventListener("change", change); return () => m.removeEventListener("change", change); };
const FAR = 96;

export function SwipeDecide({ onApprove, onChanges, approve, changes, hint, rtl, disabled, children }: {
  onApprove: () => void; onChanges: () => void; approve: ReactNode; changes: ReactNode; hint: string;
  rtl: boolean; disabled?: boolean; children: ReactNode;
}) {
  const touch = useSyncExternalStore(subscribe, () => window.matchMedia(coarse).matches, () => false);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  // Toward the end of the line (right, or left in Arabic) is « yes ».
  const end = rtl ? -1 : 1;
  const yes = useTransform(x, (v) => Math.min(1, Math.max(0, (v * end) / FAR)));
  const no = useTransform(x, (v) => Math.min(1, Math.max(0, (-v * end) / FAR)));
  const tilt = useTransform(x, [-240, 240], [-3, 3]);
  const ticked = useRef(false);
  if (!touch || reduce) return <>{children}</>;
  return (
    <div className="swipe-deck">
      <div className="swipe-track">
      <div className="swipe-under" aria-hidden="true">
        <motion.span className="swipe-yes" style={{ opacity: yes }}>{approve}</motion.span>
        <motion.span className="swipe-no" style={{ opacity: no }}>{changes}</motion.span>
      </div>
      <motion.div
        className="swipe-card"
        drag={disabled ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        dragSnapToOrigin
        dragTransition={{ bounceStiffness: spring.settle.stiffness, bounceDamping: spring.settle.damping }}
        style={{ x, rotate: tilt, touchAction: "pan-y" }}
        onDrag={(_, info) => {
          const far = Math.abs(info.offset.x) >= FAR;
          if (far && !ticked.current) navigator.vibrate?.(8);
          ticked.current = far;
        }}
        onDragEnd={(_, info) => {
          ticked.current = false;
          const along = info.offset.x * end;
          if (along >= FAR) onApprove();
          else if (along <= -FAR) onChanges();
        }}
      >
        {children}
      </motion.div>
      </div>
      <p className="swipe-hint">{hint}</p>
    </div>
  );
}
