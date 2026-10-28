"use client";
// The 48 h clock: a ring that empties as the client's time to answer runs out (from the send to the tacit
// approval). Gold in the studio, the agency's colour in the portal; in the last 6 hours it turns red and
// breathes. When it appears it drains from full to the time left, then follows the minute. Decorative:
// the time is always written next to it.
import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { hoursLeft } from "@/lib/flow";
import type { RecordItem } from "@/lib/model";
import { beat, ease, still } from "@/lib/motion";

const R = 17, C = 2 * Math.PI * R;

/** Hours left and the share of the window still open (1 just sent, 0 at the deadline). */
export function clockOf(task: Pick<RecordItem, "sentAt" | "approvalDueAt">, now: Date) {
  const left = hoursLeft(task, now);
  if (left === null) return null;
  const start = Date.parse(task.sentAt ?? ""), end = Date.parse(task.approvalDueAt ?? "");
  const share = end > start ? Math.min(1, Math.max(0, (end - now.getTime()) / (end - start))) : left > 0 ? 1 : 0;
  return { left: Math.max(0, left), share };
}

export function ClockRing({ task, now, size = 40, children, className = "" }: {
  task: Pick<RecordItem, "sentAt" | "approvalDueAt">; now: Date; size?: number; children?: ReactNode; className?: string;
}) {
  const reduce = useReducedMotion();
  const clock = clockOf(task, now);
  if (!clock) return null;
  const urgent = clock.left <= 6;
  return (
    <span className={`clock-ring${urgent ? " urgent" : ""} ${className}`} style={{ "--ring": `${size}px` } as CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={R} className="clock-ring-track" />
        <motion.circle
          cx="20" cy="20" r={R} className="clock-ring-time"
          strokeDasharray={C}
          initial={reduce ? false : { strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: C * (1 - clock.share) }}
          transition={reduce ? still : { duration: beat.moment * 1.5, ease: ease.arrive }}
        />
      </svg>
      {children && <span className="clock-ring-face">{children}</span>}
    </span>
  );
}
