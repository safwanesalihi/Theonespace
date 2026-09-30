"use client";
// A time picked as hours 00–23 and minutes — never AM/PM, whatever the browser or phone language
// (the browser's own time field follows the device and can show AM/PM). Value: "HH:MM".
import { useI18n } from "@/app/locale-provider";

const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const steps = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

export default function TimeField({ value, onChange, required, disabled, label }: {
  value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean; label?: string;
}) {
  const { t } = useI18n();
  const [h = "", m = ""] = /^\d{2}:\d{2}$/.test(value) ? value.split(":") : [];
  // A minute that isn't on the 5-minute grid (set earlier, or by the assistant) stays selectable.
  const minutes = m && !steps.includes(m) ? [...steps, m].sort() : steps;
  return (
    <div className="time-field" role="group" aria-label={label}>
      <select value={h} required={required} disabled={disabled} aria-label={t("Heure")} onChange={(e) => onChange(`${e.target.value}:${m || "00"}`)}>
        {!h && <option value="">--</option>}
        {hours.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <b aria-hidden="true">:</b>
      <select value={m} required={required} disabled={disabled} aria-label={t("Minutes")} onChange={(e) => onChange(`${h || "00"}:${e.target.value}`)}>
        {!m && <option value="">--</option>}
        {minutes.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  );
}
