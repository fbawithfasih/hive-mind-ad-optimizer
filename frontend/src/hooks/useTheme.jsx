import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeCtx = createContext(null);
const STORAGE_KEY = 'amaiop-theme';

function readInitial() {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

function apply(theme) {
  const el = document.documentElement;
  el.classList.toggle('light', theme === 'light');
  el.classList.toggle('dark',  theme === 'dark');
  el.setAttribute('data-theme', theme);
  el.style.colorScheme = theme;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitial);

  useEffect(() => { apply(theme); }, [theme]);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(t => (t === 'light' ? 'dark' : 'light'));
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
