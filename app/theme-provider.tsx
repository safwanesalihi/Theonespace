'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useI18n } from './locale-provider';
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
export function ThemeChoices() {
  const { theme, setTheme } = useContext(ThemeContext);
  const { t } = useI18n();
  return <div className="theme-choices" role="group" aria-label={t('Apparence')}>
    {([{ value: 'light', label: 'Clair', icon: Sun }, { value: 'dark', label: 'Sombre', icon: Moon }, { value: 'system', label: 'Système', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <button type="button" key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}><Icon size={16} />{t(label)}</button>)}
  </div>;
}
