/**
 * Decides WHEN to sync (docs/TechStack.md section 6.2):
 * at start, when the browser comes back online, when the tab becomes visible,
 * about one second after a local change, and every 5 seconds.
 * After a failure it retries with growing delays.
 */
import { nextDelay } from './backoff';
import type { SyncEngine } from './engine';

export interface RunnerEnv {
  isOnline(): boolean;
  isVisible(): boolean;
  on(event: 'online' | 'visible', handler: () => void): () => void;
  random?(): number;
}

export interface Runner {
  start(): void;
  stop(): void;
  /** Sync now, also after an authentication problem (e.g. the user logged in again). */
  trigger(): void;
  /** A local change was made: sync soon. */
  notifyChange(): void;
}

export interface RunnerOptions {
  engine: SyncEngine;
  env: RunnerEnv;
  onAuthRequired?: () => void;
  intervalMs?: number;
  debounceMs?: number;
}

export function createSyncRunner(opts: RunnerOptions): Runner {
  const { engine, env, onAuthRequired, intervalMs = 5000, debounceMs = 1000 } = opts;

  let started = false;
  let running = false;
  let again = false;
  let blocked = false; // waiting for the user to log in again
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;
  const unsubscribe: (() => void)[] = [];

  function clearRetry() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  async function run(): Promise<void> {
    if (!started) return;
    if (running) {
      again = true;
      return;
    }
    clearRetry();
    if (!env.isOnline()) {
      engine.markOffline();
      return;
    }

    running = true;
    try {
      do {
        again = false;
        const result = await engine.sync();
        if (!started) return;
        if (result.ok) {
          attempt = 0;
        } else if (result.kind === 'auth') {
          blocked = true;
          attempt = 0;
          again = false;
          onAuthRequired?.();
        } else {
          again = false;
          retryTimer = setTimeout(() => void run(), nextDelay(attempt++, env.random));
        }
      } while (again);
    } finally {
      running = false;
    }
  }

  const runIfAllowed = () => {
    if (!blocked) void run();
  };

  return {
    start() {
      if (started) return;
      started = true;
      unsubscribe.push(
        env.on('online', () => {
          attempt = 0;
          clearRetry();
          runIfAllowed();
        }),
        env.on('visible', runIfAllowed),
      );
      intervalTimer = setInterval(runIfAllowed, intervalMs);
      void run();
    },

    stop() {
      started = false;
      clearRetry();
      clearTimeout(debounceTimer);
      clearInterval(intervalTimer);
      for (const off of unsubscribe.splice(0)) off();
    },

    trigger() {
      blocked = false;
      attempt = 0;
      void run();
    },

    notifyChange() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runIfAllowed, debounceMs);
    },
  };
}

/** The real browser: `online` events and tab visibility. */
export function browserEnv(): RunnerEnv {
  return {
    isOnline: () => navigator.onLine,
    isVisible: () => document.visibilityState === 'visible',
    on(event, handler) {
      if (event === 'online') {
        window.addEventListener('online', handler);
        return () => window.removeEventListener('online', handler);
      }
      const onChange = () => {
        if (document.visibilityState === 'visible') handler();
      };
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
  };
}
