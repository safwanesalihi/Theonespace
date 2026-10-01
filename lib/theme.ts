export type Theme = 'light' | 'dark' | 'system';
export const themeStorageKey = 'one-core-theme';
export const themePreference = (saved: unknown): Theme => saved === 'light' || saved === 'dark' ? saved : 'system';
export const isDarkTheme = (theme: Theme, systemDark: boolean) => theme === 'dark' || (theme === 'system' && systemDark);
// Apply before paint, including when storage is unavailable. Keep explicit saved choices.
export const themeBootstrap = `(function(){var t='system';try{var s=localStorage.getItem('${themeStorageKey}');t=s==='light'||s==='dark'?s:'system'}catch(e){}var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.classList.toggle('dark',d)})()`;
