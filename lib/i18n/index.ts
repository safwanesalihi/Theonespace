// App-wide language: French is the source language, so French strings are the translation keys
// (gettext style). A missing entry falls back to the French text, which keeps the app usable
// while a dictionary is incomplete. The client portal keeps its own structured copy in
// lib/portal-i18n.ts but follows the same locale. The English and Arabic dictionaries are fetched on
// demand (loadLocale): a French visitor downloads none of them.

export type Locale = 'fr' | 'en' | 'ar';
export const locales: Locale[] = ['fr', 'en', 'ar'];
export const localeMeta: Record<Locale, { label: string; short: string; dir: 'ltr' | 'rtl'; tag: string; language: string }> = {
  fr: { label: 'Français', short: 'FR', dir: 'ltr', tag: 'fr-FR', language: 'Français' },
  en: { label: 'English', short: 'EN', dir: 'ltr', tag: 'en-GB', language: 'English' },
  ar: { label: 'العربية', short: 'AR', dir: 'rtl', tag: 'ar-MA', language: 'العربية' },
};
export const storageKey = 'the-one.locale';

// Filled by loadLocale. Until a language has arrived, translate() answers in French, the source.
const dictionaries: Record<Locale, Record<string, string> | undefined> = { fr: {}, en: undefined, ar: undefined };
let loading: Promise<void> | undefined;
// The public page asks for its own small dictionary (public-dictionary.ts, only its words) instead of the app's.
let publicOnly = false;

/** Called by the public page (features/landing/landing.tsx) before any language is loaded. */
export function preferPublicDictionary() { if (!loading) publicOnly = true; }

/** Whether translate() can already answer in this language. */
export const hasLocale = (locale: Locale) => !!dictionaries[locale];

/** Fetches the English and Arabic dictionaries (one module, fetched once); French needs nothing. */
export function loadLocale(locale: Locale): Promise<void> {
  if (hasLocale(locale)) return Promise.resolve();
  loading ??= (publicOnly ? import('./public-dictionary') : import('./dictionaries')).then((d) => { dictionaries.en = d.en; dictionaries.ar = d.ar; }, (error) => { loading = undefined; throw error; });
  return loading;
}

export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && (locales as string[]).includes(value);

/** Translates a French source string; `{name}` placeholders are filled from `vars`. */
export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  const out = locale === 'fr' ? text : dictionaries[locale]?.[text] ?? text;
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
