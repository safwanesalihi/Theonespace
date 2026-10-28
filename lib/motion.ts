// Our motion language, « Le geste de la décision »: the screen moves only when the work changes hands,
// gold moves only for a decision, and each moment has its own material (a seal that strikes, paper that
// prints, a road the card walks). Every moment takes its rhythm from here, so six of them read as one hand.
// CSS keeps the same numbers in styles/moments.css (--m-*).
import type { Transition } from "motion/react";

/** How long things take, in seconds. */
export const beat = {
  tap: 0.12,     // a press answers
  move: 0.32,    // something changes place
  moment: 0.6,   // a decision lands
  hold: 0.8,     // a gesture that must be meant (hold to send)
  print: 0.7,    // the receipt comes out
} as const;

/** One ease for what arrives, one for what leaves: fast out, soft landing. */
export const ease = {
  arrive: [0.2, 0.8, 0.2, 1],
  leave: [0.4, 0, 1, 1],
} as const;

/** The springs: a seal strikes (heavy, one bounce), a card walks (light, no bounce), a sheet settles. */
export const spring = {
  strike: { type: "spring", stiffness: 640, damping: 24, mass: 1.1 },
  walk: { type: "spring", stiffness: 380, damping: 34 },
  settle: { type: "spring", stiffness: 260, damping: 30 },
} satisfies Record<string, Transition>;

/** With reduced motion every moment still says what happened, at once and without travel. */
export const still: Transition = { duration: 0 };
