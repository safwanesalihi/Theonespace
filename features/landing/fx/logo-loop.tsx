// Logo Loop — after React Bits (https://reactbits.dev/animations/logo-loop) by David Haz, MIT + Commons
// Clause. Pared down to CSS: the row is written twice and slides by half its width, so it never ends; it
// runs toward the start of the line (left, or right in Arabic), slows under the pointer, fades at both
// edges, and with reduced motion it is one still, wrapped row.
import type { ReactNode } from 'react';
import './logo-loop.css';

export default function LogoLoop({ items, label, seconds = 36 }: { items: { key: string; node: ReactNode }[]; label: string; seconds?: number }) {
  const row = (copy: boolean) => (
    <ul className={`logo-loop-row${copy ? ' copy' : ''}`} aria-hidden={copy || undefined}>
      {items.map((item) => <li key={item.key}>{item.node}</li>)}
    </ul>
  );
  return (
    <div className="logo-loop" role="group" aria-label={label}>
      <div className="logo-loop-track" style={{ animationDuration: `${seconds}s` }}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
