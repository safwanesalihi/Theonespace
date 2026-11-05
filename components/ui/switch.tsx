// The app's on/off control, with its text beside it, or a label for screen readers when the row already says what it is.
import type { ReactNode } from "react";

export function Switch({ checked, onChange, disabled, label, id, children }: {
  checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label?: string; id?: string; children?: ReactNode;
}) {
  return (
    <label className="ui-switch" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" />{children}
    </label>
  );
}
