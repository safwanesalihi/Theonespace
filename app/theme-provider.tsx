'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useI18n } from './locale-provider';

type Theme = 'light' | 'dark' | 'system';
const storageKey = 'one-core-theme';
const ThemeContext = createContext({ theme: 'light' as Theme, dark: false, setTheme: (() => {}) as (theme: Theme) => void });
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setPreference] = useState<Theme>('light');
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const read = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(storageKey); } catch {}
      setPreference(saved === 'dark' || saved === 'system' ? saved : 'light');
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
      const isDark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', isDark);
      setDark(isDark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, ready]);
  const setTheme = useCallback((next: Theme) => {
    try { localStorage.setItem(storageKey, next); } catch {}
    setPreference(next);
  }, []);
  return <ThemeContext.Provider value={{ theme, dark, setTheme }}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle({ sidebar = false }: { sidebar?: boolean }) {
  const { dark, setTheme } = useContext(ThemeContext);
  const { t } = useI18n();
  const label = t(dark ? 'Activer le mode clair' : 'Activer le mode sombre');
  return <button type="button" className={`theme-toggle ${sidebar ? 'sidebar-theme' : 'icon-button'}`} aria-label={label} title={label} onClick={() => setTheme(dark ? 'light' : 'dark')}>
    {dark ? <Sun size={17} /> : <Moon size={17} />}{sidebar && <span>{t(dark ? 'Mode clair' : 'Mode sombre')}</span>}
  </button>;
}
export function ThemeChoices() {
  const { theme, setTheme } = useContext(ThemeContext);
  const { t } = useI18n();
  return <div className="theme-choices" role="group" aria-label={t('Apparence')}>
    {([{ value: 'light', label: 'Clair', icon: Sun }, { value: 'dark', label: 'Sombre', icon: Moon }, { value: 'system', label: 'Système', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <button type="button" key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}><Icon size={16} />{t(label)}</button>)}
  </div>;
}
