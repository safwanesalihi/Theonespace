'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useI18n } from '@/lib/i18n/locale-provider';
import { isDarkTheme, themePreference, themeStorageKey, type Theme } from '@/lib/theme';
import { watchMediaQuery } from '@/lib/media-query';

const ThemeContext = createContext({ theme: 'system' as Theme, dark: false, setTheme: (() => {}) as (theme: Theme) => void });
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setPreference] = useState<Theme>('system');
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const read = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(themeStorageKey); } catch {}
      setPreference(themePreference(saved));
      setReady(true);
    };
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const isDark = isDarkTheme(theme, media.matches);
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', isDark);
      setDark(isDark);
    };
    apply();
    return watchMediaQuery(media, apply);
  }, [theme, ready]);
  const setTheme = useCallback((next: Theme) => {
    try { localStorage.setItem(themeStorageKey, next); } catch {}
    setPreference(next);
  }, []);
  return <ThemeContext.Provider value={{ theme, dark, setTheme }}>{children}</ThemeContext.Provider>;
}
/**
 * Day and night pass over the page as a circle that opens from the button pressed (View Transitions; the
 * new theme is applied inside the transition so the browser can photograph both). Without the API, or
 * with reduced motion, the theme simply changes.
 */
function switchTheme(next: Theme, from: HTMLElement, setTheme: (theme: Theme) => void) {
  const root = document.documentElement;
  const isDark = isDarkTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches);
  const start = (document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } }).startViewTransition?.bind(document);
  if (!start || isDark === (root.dataset.theme === 'dark') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setTheme(next); return; }
  const r = from.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  root.classList.add('theme-turning');
  start(() => {
    root.dataset.theme = isDark ? 'dark' : 'light';
    root.classList.toggle('dark', isDark);
    flushSync(() => setTheme(next));
  }).finished.finally(() => root.classList.remove('theme-turning'));
}

export function ThemeChoices() {
  const { theme, setTheme } = useContext(ThemeContext);
  const { t } = useI18n();
  return <div className="theme-choices" role="group" aria-label={t('Apparence')}>
    {([{ value: 'light', label: 'Clair', icon: Sun }, { value: 'dark', label: 'Sombre', icon: Moon }, { value: 'system', label: 'Système', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <button type="button" key={value} aria-pressed={theme === value} onClick={(e) => switchTheme(value, e.currentTarget, setTheme)}><Icon size={16} />{t(label)}</button>)}
  </div>;
}
