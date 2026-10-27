// The One's seal (Nuage d'or): the gold coin that marks the one thing that matters on a screen, inside a
// stamp ring that turns slowly. Decorative; styles in components/sky.css.
import type { CSSProperties } from "react";

export function Seal({ size = 56 }: { size?: number }) {
  const style = { width: size, height: size, "--seal-size": `${size}px` } as CSSProperties;
  return (
    <span className="seal" style={style} aria-hidden="true">
      <svg className="seal-ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" /></svg>
      <span className="seal-coin">1</span>
    </span>
  );
}
