// The sky behind the signed-in screens (Nuage d'or): silver, clouds that drift, a few dark-gold lights that
// breathe; at night, faint clouds and small bright points of light. In the client portal the lights take
// the agency's colour. Pure CSS (components/sky.css), behind everything, ignored by assistive technology.
export function Sky() {
  return (
    <div className="sky" aria-hidden="true">
      <span className="sky-light sky-light-1" />
      <span className="sky-light sky-light-2" />
      <span className="sky-light sky-light-3" />
      <span className="sky-cloud sky-cloud-1" />
      <span className="sky-cloud sky-cloud-2" />
      <span className="sky-cloud sky-cloud-3" />
      <span className="sky-cloud sky-cloud-4" />
    </div>
  );
}
