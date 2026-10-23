// A light that travels around a card's border (after Magic UI's Border Beam), for the one thing on a
// screen that waits for the viewer's decision. Pure CSS (components/border-beam.css): solid brand
// colour on a fine ring, never a wash; still with reduced motion. The card needs `has-beam`.
export function BorderBeam() {
  return <span className="border-beam" aria-hidden="true" />;
}
