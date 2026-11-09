/**
 * Decides WHEN to sync (docs/mvp/TechStack.md section 6.2):
 * at start, when the browser comes back online, when the tab becomes visible,
 * about one second after a local change, and every 5 seconds.
 * Every 3 seconds it also asks the server whether it can be reached, because the browser's
 * online flag is only a hint (it can be wrong both ways). After a failure it retries: every second while the connection is down, with growing
 * delays (up to 5 s) for server errors.
 */
import { nextDelay } from './backoff';
import type { Connectivity } from './connectivity';
import type { SyncDiagnostics } from './diagnostics';
import type { SyncEngine } from './engine';

export interface RunnerEnv {
  isOnline(): boolean;
  isVisible(): boolean;
  on(event: 'online' | 'offline' | 'visible', handler: () => void): () => void;
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
  /** Records what happens, for the admin diagnostics. */
  diag?: SyncDiagnostics;
  /** What the app found out about the connection; the UI shows this, not the browser flag. */
  connectivity?: Connectivity;
  /** How often to ask the server whether it can be reached. */
  probeIntervalMs?: number;
}

/** While the connection is down, try again this often (a failed try itself takes <= 2 s). */
const OFFLINE_RETRY_MAX_MS = 1000;

export function createSyncRunner(opts: RunnerOptions): Runner {
  const {
    engine,
    env,
    onAuthRequired,
    intervalMs = 5000,
    debounceMs = 1000,
    diag,
    connectivity,
    probeIntervalMs = 3000,
  } = opts;

  let started = false;
  let running = false;
  let again = false;
  /** The connection came back while a (hanging) request was waiting: run again at once. */
  let urgent = false;
  let blocked = false; // waiting for the user to log in again
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;
  let probeTimer: ReturnType<typeof setInterval> | undefined;
  let probing = false;
  const unsubscribe: (() => void)[] = [];

  function clearRetry() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  /** What the app found out; `why` is only for the admin diagnostics. */
  function report(online: boolean, why: string) {
    if (connectivity?.report(online)) {
      diag?.log('connection', `${online ? 'online' : 'offline'}: ${why}`);
    }
  }

  /**
   * Asks the server whether it can be reached (every 3 s). The browser's own flag is only
   * a hint and can be wrong in both directions, so this is what decides.
   */
  async function probe(): Promise<void> {
    if (!started || probing) return;
    probing = true;
    const t0 = Date.now();
    const ok = await engine.ping().finally(() => {
      probing = false;
    });
    if (!started) return;
    diag?.probe(ok, Date.now() - t0);
    if (ok) {
      const wasDown =
        !(connectivity?.getSnapshot().online ?? true) || engine.status.state === 'offline';
      report(true, 'the server answered a check');
      if (wasDown) runIfAllowed('connection check worked'); // do not wait for the next timer
    } else {
      report(false, 'no answer to a check');
      if (engine.status.state !== 'offline') engine.markOffline();
    }
  }

  /** `why` is only for the admin diagnostics. */
  async function run(why: string): Promise<void> {
    if (!started) return;
    if (running) {
      again = true;
      diag?.log('trigger', `${why} (a sync is already running; it will run again)`);
      return;
    }
    clearRetry();
    running = true;
    try {
      let reason = why;
      do {
        again = false;
        diag?.log('sync', `started (${reason})`);
        const result = await engine.sync();
        if (!started) return;
        if (result.ok) {
          attempt = 0;
          report(true, 'a sync worked');
          diag?.runEnd(true, 'all changes saved');
        } else if (result.kind === 'auth') {
          blocked = true;
          attempt = 0;
          again = false;
          report(true, 'the server answered (login needed)');
          diag?.runEnd(false, 'login required');
          onAuthRequired?.();
        } else if (urgent) {
          report(result.kind !== 'offline', result.message);
          // The connection came back while we were waiting for a dead one: do not wait.
          urgent = false;
          attempt = 0;
          again = true;
          reason = 'connection came back';
          diag?.runEnd(false, `${result.kind}: ${result.message}; running again at once`);
        } else {
          again = false;
          // A dead connection: try again soon and often (cheap, and short requests).
          // A server problem: back off.
          const delay = nextDelay(
            attempt++,
            env.random,
            result.kind === 'offline' ? OFFLINE_RETRY_MAX_MS : undefined,
          );
          report(result.kind !== 'offline', result.message); // a server error still means: reachable
          diag?.runEnd(false, `${result.kind}: ${result.message}`);
          diag?.retryScheduled(delay, attempt);
          retryTimer = setTimeout(() => void run('retry'), delay);
        }
      } while (again);
    } finally {
      running = false;
    }
  }

  const runIfAllowed = (why: string) => {
    if (!blocked) void run(why);
  };

  return {
    start() {
      if (started) return;
      started = true;
      diag?.browserOnline(env.isOnline());
      unsubscribe.push(
        env.on('online', () => {
          diag?.browserOnline(true);
          attempt = 0;
          clearRetry();
          if (running) {
            // The request in flight is probably waiting on the dead connection.
            urgent = true;
            engine.abort();
          }
          runIfAllowed('browser online event');
        }),
        env.on('offline', () => {
          diag?.browserOnline(false);
          clearRetry();
          engine.abort(); // no point in waiting for answers any more
          engine.markOffline(); // shown at once, not after the next failed request
          report(false, 'the browser reported offline');
          void probe(); // the browser may be wrong: ask the server right away
        }),
        env.on('visible', () => runIfAllowed('tab became visible')),
      );
      intervalTimer = setInterval(() => runIfAllowed('timer'), intervalMs);
      probeTimer = setInterval(() => void probe(), probeIntervalMs);
      void run('start');
    },

    stop() {
      started = false;
      clearRetry();
      clearTimeout(debounceTimer);
      clearInterval(intervalTimer);
      clearInterval(probeTimer);
      for (const off of unsubscribe.splice(0)) off();
    },

    trigger() {
      blocked = false;
      attempt = 0;
      void run('trigger');
    },

    notifyChange() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runIfAllowed('local change'), debounceMs);
    },
  };
}

/** The real browser: `online` events and tab visibility. */
export function browserEnv(): RunnerEnv {
  return {
    isOnline: () => navigator.onLine,
    isVisible: () => document.visibilityState === 'visible',
    on(event, handler) {
      if (event === 'online' || event === 'offline') {
        window.addEventListener(event, handler);
        return () => window.removeEventListener(event, handler);
      }
      const onChange = () => {
        if (document.visibilityState === 'visible') handler();
      };
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
  };
}
