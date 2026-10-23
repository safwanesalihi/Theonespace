// Text in solid gold with a slow sheen crossing it (after React Bits' Shiny Text). The sheen is a lighter
// gold, never a darker one; with reduced motion the text is plain gold. Styles: components/spotlight.css.
import type { ReactNode } from "react";

export function ShinyText({ children }: { children: ReactNode }) {
  return <span className="shiny-text">{children}</span>;
}
