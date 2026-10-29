"use client";
// A word that changes in place (a status « En cours » → « À valider »): the old one rises and blurs away
// while the new one comes up from below. Nothing moves when it first appears, nor with reduced motion.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { beat, ease } from "@/lib/motion";

export function TextMorph({ children }: { children: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="text-morph">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={children}
          initial={reduce ? false : { opacity: 0, y: "0.5em", filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.5em", filter: "blur(3px)" }}
          transition={{ duration: beat.move, ease: ease.arrive }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
