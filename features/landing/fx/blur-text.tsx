// Blur Text — after React Bits (https://reactbits.dev/text-animations/blur-text) by David Haz, MIT + Commons
// Clause. Pared down for the hero's headline: the words come out of a blur one after another, once, as the
// page opens. Plain CSS (blur-text.css), so it plays from the first paint, before any script has loaded.
// Words only, never letters, so Arabic keeps its joined shapes; screen readers get the whole sentence at
// once; with reduced motion the words are simply there.
import type { CSSProperties } from 'react';
import './blur-text.css';

export default function BlurText({ text, delay = 0, step = 0.09 }: { text: string; delay?: number; step?: number }) {
  const words = text.split(' ');
  return (
    <>
      <span className="blur-text-sr">{text}</span>
      {words.map((word, i) => (
        <span key={`${i}-${word}`} aria-hidden="true">
          {i > 0 && ' '}
          <span className="blur-text-word" style={{ animationDelay: `${delay + i * step}s` } as CSSProperties}>{word}</span>
        </span>
      ))}
    </>
  );
}
