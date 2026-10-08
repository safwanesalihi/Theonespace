// App-wide language: French is the source language, so French strings are the translation keys
// (gettext style). A missing entry falls back to the French text, which keeps the app usable
// while a dictionary is incomplete. The client portal keeps its own structured copy in
// lib/portal-i18n.ts but follows the same locale.
import { catalogAr, catalogEn } from './catalog';
import { printingEn, printingAr } from './printing';
import { pipelineEn, pipelineAr } from './pipeline';
import { driveEn, driveAr } from './drive';

export type Locale = 'fr' | 'en' | 'ar';
export const locales: Locale[] = ['fr', 'en', 'ar'];
export const localeMeta: Record<Locale, { label: string; short: string; dir: 'ltr' | 'rtl'; tag: string; language: string }> = {
  fr: { label: 'Français', short: 'FR', dir: 'ltr', tag: 'fr-FR', language: 'Français' },
  en: { label: 'English', short: 'EN', dir: 'ltr', tag: 'en-GB', language: 'English' },
  ar: { label: 'العربية', short: 'AR', dir: 'rtl', tag: 'ar-MA', language: 'العربية' },
};
export const storageKey = 'the-one.locale';

// The catalogs (lib/i18n/catalog/, one per area) first, then the printing, pipeline and Drive copy, which
// win for the few keys they share with a catalog — the precedence these dictionaries always had.
const dictionaries: Record<Locale, Record<string, string>> = { fr: {}, en: { ...catalogEn, ...printingEn, ...pipelineEn, ...driveEn }, ar: { ...catalogAr, ...printingAr, ...pipelineAr, ...driveAr } };

export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && (locales as string[]).includes(value);

/** Translates a French source string; `{name}` placeholders are filled from `vars`. */
export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  const out = locale === 'fr' ? text : dictionaries[locale][text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m)) : out;
}

/** French plural helper kept readable in source: `plural(n, 'tâche')` → "3 tâches". Translated per locale. */
export function readStoredLocale(): Locale | null {
  try { const v = window.localStorage.getItem(storageKey); return isLocale(v) ? v : null; } catch { return null; }
}
export function storeLocale(locale: Locale) {
  try { window.localStorage.setItem(storageKey, locale); } catch { /* private mode */ }
}
export function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'fr';
  return isLocale(nav) ? nav : 'fr';
}
