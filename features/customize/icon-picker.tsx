"use client";
// Chooses one of the icons an agency may use (lib/icon-choices.ts), by theme or by name; the first choice goes
// back to the app's own. Changes the draft only, like the rest of « Personnaliser ».
import { useState } from "react";
import { Search, type LucideIcon } from "lucide-react";
import { ChoiceIcon, iconOf } from "@/components/choice-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n/locale-provider";
import { iconChoices, iconGroups } from "@/lib/icon-choices";

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function IconPicker({ value, fallback, onChange, label, disabled }: { value?: string; fallback: LucideIcon; onChange: (icon: string | undefined) => void; label: string; disabled?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wanted = plain(query.trim());
  const choose = (icon: string | undefined) => { onChange(icon); setOpen(false); setQuery(""); };
  const found = iconChoices.filter((choice) => !wanted || plain(t(choice.label)).includes(wanted) || choice.id.includes(wanted));
  return <Popover modal open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
    <PopoverTrigger asChild>
      <button type="button" className="icon-button cz-icon-pick" aria-label={label} title={label} disabled={disabled}><ChoiceIcon id={value} fallback={fallback} size={17} aria-hidden="true" /></button>
    </PopoverTrigger>
    <PopoverContent align="start" className="cz-icons">
      <label className="search-input"><Search size={15} aria-hidden="true" /><input autoFocus value={query} placeholder={t("Chercher une icône…")} aria-label={t("Chercher une icône…")} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="cz-icons-list">
        {!wanted && <button type="button" className={`cz-icons-own ${iconOf(value) ? "" : "on"}`} aria-pressed={!iconOf(value)} onClick={() => choose(undefined)}><ChoiceIcon fallback={fallback} size={18} aria-hidden="true" />{t("Icône d’origine")}</button>}
        {iconGroups.map((group) => {
          const shown = found.filter((choice) => choice.group === group);
          if (!shown.length) return null;
          return <section key={group}><h4>{t(group)}</h4>
            <div className="cz-icons-grid">{shown.map((choice) => <button type="button" key={choice.id} className={value === choice.id ? "on" : ""} aria-pressed={value === choice.id} aria-label={t(choice.label)} title={t(choice.label)} onClick={() => choose(choice.id)}><ChoiceIcon id={choice.id} fallback={fallback} size={18} aria-hidden="true" /></button>)}</div>
          </section>;
        })}
        {!found.length && <p className="cz-hint">{t("Aucune icône à ce nom.")}</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
