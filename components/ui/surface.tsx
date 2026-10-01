import type { ComponentProps } from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

export type SurfaceTone = "default" | "subtle" | "gold" | "inverse";

/** One surface contract for cards, metrics and panels. asChild preserves the
 * native button/link/section, its events, accessibility and layout. */
export function Surface({ asChild = false, tone = "default", className, ...props }:
  ComponentProps<"div"> & { asChild?: boolean; tone?: SurfaceTone }) {
  const Component = asChild ? Slot.Root : "div";
  return <Component data-ui="card" data-tone={tone} className={cn("ui-surface", className)} {...props} />;
}
