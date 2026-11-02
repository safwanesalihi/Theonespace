'use client';
// Provides the current language to every screen and mirrors it on <html lang dir>. English and Arabic
// arrive on demand (lib/i18n, loadLocale): a language is shown once its dictionary is in, never half
// translated, and the language switch fetches them as the pointer comes near (preloadLocales), so
// the change stays instant.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { detectLocale, hasLocale, loadLocale, localeMeta, storeLocale, translate, type Locale } from '@/lib/i18n';
import { formatAppDate } from '@/lib/time';

type Vars = Record<string, string | number>;
type I18n = {
  locale: Locale; dir: 'ltr' | 'rtl'; tag: string; rtl: boolean;
  t: (text: string, vars?: Vars) => string;
  setLocale: (locale: Locale) => void;
  /** Formats a day key (YYYY-MM-DD) or ISO timestamp in the current language. */
  date: (value?: string, options?: Intl.DateTimeFormatOptions) => string;
};

const fallback: I18n = {
  locale: 'fr', dir: 'ltr', tag: 'fr-FR', rtl: false,
  t: (text, vars) => translate('fr', text, vars), setLocale: () => undefined,
  date: (value, options) => formatDate('fr-FR', value, options),
};
const LocaleContext = createContext<I18n>(fallback);

export function formatDate(tag: string, value?: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!value) return '';
  return formatAppDate(value, tag, options);
}

/** Starts fetching the English and Arabic dictionaries, for a language change about to happen. */
export const preloadLocales = () => { loadLocale('en').catch(() => undefined); };

export function LocaleProvider({ children, initial }: { children: React.ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initial && hasLocale(initial) ? initial : 'fr');
  // The last language asked for: a slower, earlier request never wins over it.
  const wanted = useRef<Locale>(locale);
  const show = useCallback((next: Locale) => {
    wanted.current = next;
    if (hasLocale(next)) { setLocaleState(next); return; }
    loadLocale(next).then(() => { if (wanted.current === next) setLocaleState(next); }, () => undefined);
  }, []);
  // The stored preference is only known in the browser; apply it after hydration (the server renders French).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored choice is read after hydration on purpose (server renders French)
  useEffect(() => { show(initial ?? detectLocale()); }, [initial, show]);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('lang', locale); root.setAttribute('dir', localeMeta[locale].dir);
  }, [locale]);
  const setLocale = useCallback((next: Locale) => { storeLocale(next); show(next); }, [show]);
  const value = useMemo<I18n>(() => ({
    locale, dir: localeMeta[locale].dir, tag: localeMeta[locale].tag, rtl: localeMeta[locale].dir === 'rtl',
    t: (text, vars) => translate(locale, text, vars), setLocale,
    date: (v, options) => formatDate(localeMeta[locale].tag, v, options),
  }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useI18n = () => useContext(LocaleContext);
