import { useEffect, useState, useSyncExternalStore } from 'react';
import { engine, reminderFeed, session } from './services';

export function useSession() {
  return useSyncExternalStore(session.subscribe, session.getState);
}

export function useSyncStatus() {
  return useSyncExternalStore(engine.subscribe, () => engine.status);
}

export function useReminderMessages() {
  return useSyncExternalStore(reminderFeed.subscribe, reminderFeed.getSnapshot);
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

/**
 * Runs `load` now and then every `intervalMs` (and when the tab comes back or the
 * connection returns). `undefined` means "no answer yet or failed".
 */
export function usePolled<T>(load: () => Promise<T | undefined>, intervalMs: number, key = '') {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      void load().then(
        (v) => {
          if (cancelled) return;
          setFailed(v === undefined);
          if (v !== undefined) setValue(v);
        },
        () => !cancelled && setFailed(true),
      );
    run();
    const timer = setInterval(run, intervalMs);
    const onVisible = () => document.visibilityState === 'visible' && run();
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // `load` is recreated on every render; `key` says when it really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, key]);

  return { value, failed };
}
