"use client";
// A dark card with a soft neutral light that follows the pointer (after React Bits' Spotlight Card). The
// light is white at a few percent, never the brand colour, so it never tints the black. Styles live in
// components/spotlight.css; touch screens and reduced motion simply see the plain card.
import { useRef, type HTMLAttributes, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

export function SpotlightCard({ className, children, onPointerMove, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(e);
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const box = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${Math.round(e.clientX - box.left)}px`);
    el.style.setProperty("--spot-y", `${Math.round(e.clientY - box.top)}px`);
  };
  return <div ref={ref} className={cn("spotlight-card", className)} onPointerMove={move} {...rest}>{children}</div>;
}
