"use client";
// Send = hold: a button that acts only when it is held, for the one action that can't be taken back
// (sending the work to the client). Held, it fills from its start edge; let go early and it drains back.
// Full, the icon flies off and the action runs. A quick tap teaches the gesture instead of acting. The
// keyboard holds Space or Enter the same way; a click from assistive technology (no press to hold) acts
// at once, since it was meant.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import { beat, ease } from "@/lib/motion";

export function HoldButton({ onConfirm, disabled, icon, children, hint, holding: holdingLabel, className = "" }: {
  onConfirm: () => unknown; disabled?: boolean; icon: ReactNode; children: ReactNode;
  /** Said to screen readers, and shown after a tap too short: « Maintenez pour envoyer ». */
  hint: string;
  /** The label while it fills: « Envoi… ». */
  holding: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const hintId = useId();
  const progress = useMotionValue(0);
  const run = useRef<AnimationPlaybackControls | null>(null);
  const phase = useRef<"idle" | "holding" | "sent">("idle");
  const pressed = useRef(0);
  const keyed = useRef(false);
  const [state, setState] = useState<"idle" | "holding" | "sent" | "taught">("idle");
  const [flight, setFlight] = useState(1);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => () => run.current?.stop(), []);
  useEffect(() => {
    if (state !== "taught") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);

  const to = (next: typeof phase.current) => { phase.current = next; setState(next); };
  const fire = () => {
    to("sent");
    setFlight(getComputedStyle(ref.current ?? document.body).direction === "rtl" ? -1 : 1);
    setTimeout(() => {
      void Promise.resolve(onConfirm()).finally(() => { phase.current = "idle"; setState("idle"); progress.set(0); });
    }, reduce ? 0 : beat.move * 1000);
  };
  const start = () => {
    if (disabled || phase.current !== "idle") return;
    pressed.current = Date.now();
    to("holding");
    run.current?.stop();
    run.current = animate(progress, 1, { duration: beat.hold * (1 - progress.get()), ease: "linear", onComplete: fire });
  };
  const cancel = () => {
    if (phase.current !== "holding") return;
    run.current?.stop();
    const tap = Date.now() - pressed.current < 250;
    phase.current = "idle";
    setState(tap ? "taught" : "idle");
    run.current = animate(progress, 0, { duration: beat.move, ease: ease.leave });
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`btn primary hold-button is-${state} ${className}`}
      disabled={disabled}
      aria-describedby={hintId}
      onPointerDown={(e) => { if (e.button === 0) { e.currentTarget.setPointerCapture?.(e.pointerId); start(); } }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); keyed.current = true; start(); } }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); cancel(); } }}
      onClick={(e) => {
        // A click without a press to hold (a screen reader's activation) was meant: act now.
        if (e.detail === 0 && !keyed.current && phase.current === "idle" && !disabled) fire();
        keyed.current = false;
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <motion.span className="hold-fill" style={{ scaleX: progress }} aria-hidden="true" />
      <motion.span
        className="hold-icon"
        aria-hidden="true"
        animate={state === "sent" && !reduce ? { x: 34 * flight, y: -22, opacity: 0, rotate: -14 * flight } : { x: 0, y: 0, opacity: 1, rotate: 0 }}
        transition={state === "sent" ? { duration: beat.move, ease: ease.leave } : { duration: 0 }}
      >
        {icon}
      </motion.span>
      {/* The three labels share one cell, so the button keeps the width of the longest. */}
      <span className="hold-labels">
        <span className={state === "idle" ? "on" : ""}>{children}</span>
        <span className={state === "holding" || state === "sent" ? "on" : ""}>{holdingLabel}</span>
        <span className={state === "taught" ? "on" : ""}>{hint}</span>
      </span>
      <span id={hintId} className="sr-only">{hint}</span>
    </button>
  );
}
