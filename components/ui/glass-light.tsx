"use client";
// The light a glass card's edge catches under the mouse (after React Bits' Spotlight Card and Magic Bento's
// border glow): one listener for the whole screen marks the card under the pointer with data-lit and the
// pointer's place in it (--glow-x, --glow-y); styles/surfaces.css draws the glow. Touch screens and
// reduced motion see the plain glass.
import { useEffect } from "react";

export function GlassLight() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let lit: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;
    const clear = () => { lit?.removeAttribute("data-lit"); lit = null; };
    const paint = () => {
      frame = 0;
      const target = last?.target;
      const card = target instanceof Element ? target.closest<HTMLElement>("[data-ui=card]") : null;
      if (lit !== card) clear();
      if (!card || !last) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--glow-x", `${Math.round(last.clientX - box.left)}px`);
      card.style.setProperty("--glow-y", `${Math.round(last.clientY - box.top)}px`);
      if (!lit) { card.setAttribute("data-lit", ""); lit = card; }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", clear);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", clear);
      clear();
    };
  }, []);
  return null;
}
