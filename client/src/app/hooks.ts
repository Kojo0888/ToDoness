import { useEffect, useState, useSyncExternalStore } from 'react';
import { engine, session } from './services';

export function useSession() {
  return useSyncExternalStore(session.subscribe, session.getState);
}

export function useSyncStatus() {
  return useSyncExternalStore(engine.subscribe, () => engine.status);
}

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** The browser's own idea of whether it is online (a hint, not a guarantee). */
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'todoness.theme';

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return [
    theme,
    (next) => {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* storage may be blocked; the choice then lasts until reload */
      }
      setTheme(next);
    },
  ];
}
