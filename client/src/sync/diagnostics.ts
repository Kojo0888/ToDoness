/**
 * What the sync is doing and how long it takes, so an admin can see why an
 * offline → online switch was slow. Always recorded (it is tiny), shown to admins only.
 */

export interface DiagEvent {
  /** Epoch ms. */
  at: number;
  kind: string;
  detail: string;
}

export interface DiagFlags {
  /** The browser's own idea (`navigator.onLine`), as last reported to the runner. */
  browserOnline: boolean;
  /** A request that has been sent and has not answered yet. */
  inFlight: { what: string; since: number } | null;
  lastRequest: { what: string; ms: number; outcome: string } | null;
  /** The last connection check (`GET /api/health`). */
  lastProbe: { at: number; ok: boolean; ms: number } | null;
  /** The next attempt is planned for this time. */
  retry: { at: number; delayMs: number; attempt: number } | null;
  /** The next regular (timer) run; shown when no retry is planned. */
  nextRun: number | null;
  /** The last time from the browser's `online` event to "all changes saved". */
  reconnectMs: number | null;
  /** The last time from the first failure to "all changes saved". */
  outageMs: number | null;
}

export interface DiagSnapshot {
  events: readonly DiagEvent[];
  flags: Readonly<DiagFlags>;
}

export interface SyncDiagnostics {
  /** Adds a line to the log. */
  log(kind: string, detail?: string): void;
  requestStart(what: string): number;
  requestEnd(id: number, outcome: string): void;
  /** `isEvent`: false when only reading the current flag (no `online`/`offline` event happened). */
  browserOnline(online: boolean, isEvent?: boolean): void;
  retryScheduled(delayMs: number, attempt: number): void;
  /** The planned retry was cancelled (or is starting now). */
  retryCleared(): void;
  /** The regular timer will run a sync at this time (epoch ms). */
  nextRunAt(at: number | null): void;
  /** A connection check finished. */
  probe(ok: boolean, ms: number): void;
  /** A sync run ended. `ok` = everything saved. */
  runEnd(ok: boolean, detail: string): void;
  subscribe(listener: () => void): () => void;
  /** A new object after every change (what `useSyncExternalStore` needs). */
  getSnapshot(): DiagSnapshot;
}

const MAX_EVENTS = 100;

export function createSyncDiagnostics(now: () => number = Date.now): SyncDiagnostics {
  let events: DiagEvent[] = [];
  let flags: DiagFlags = {
    browserOnline: true,
    inFlight: null,
    lastRequest: null,
    lastProbe: null,
    retry: null,
    nextRun: null,
    reconnectMs: null,
    outageMs: null,
  };
  let snapshot: DiagSnapshot = { events, flags };
  let reconnectFrom: number | null = null;
  let outageFrom: number | null = null;
  let seq = 0;
  const started = new Map<number, { what: string; since: number }>();
  const listeners = new Set<() => void>();

  function emit() {
    snapshot = { events, flags };
    for (const l of listeners) l();
  }
  function add(kind: string, detail = '') {
    events = [...events, { at: now(), kind, detail }].slice(-MAX_EVENTS);
  }
  const set = (patch: Partial<DiagFlags>) => {
    flags = { ...flags, ...patch };
  };

  return {
    log(kind, detail) {
      add(kind, detail);
      emit();
    },
    requestStart(what) {
      const id = ++seq;
      started.set(id, { what, since: now() });
      set({ inFlight: { what, since: now() } });
      add('request', `${what} sent`);
      emit();
      return id;
    },
    requestEnd(id, outcome) {
      const s = started.get(id);
      started.delete(id);
      if (!s) return;
      const ms = now() - s.since;
      const newest = [...started.values()].at(-1) ?? null;
      set({ inFlight: newest, lastRequest: { what: s.what, ms, outcome } });
      add('request', `${s.what} ${outcome} after ${ms} ms`);
      emit();
    },
    browserOnline(online, isEvent = true) {
      set({ browserOnline: online });
      if (isEvent) {
        if (online) reconnectFrom = now();
        add('browser', online ? 'online event' : 'offline event');
      }
      emit();
    },
    probe(ok, ms) {
      set({ lastProbe: { at: now(), ok, ms } });
      add('probe', ok ? `server answered after ${ms} ms` : `no answer after ${ms} ms`);
      emit();
    },
    retryScheduled(delayMs, attempt) {
      set({ retry: { at: now() + delayMs, delayMs, attempt } });
      add('retry', `next attempt in ${delayMs} ms (#${attempt})`);
      emit();
    },
    retryCleared() {
      if (!flags.retry) return;
      set({ retry: null });
      emit();
    },
    nextRunAt(at) {
      set({ nextRun: at });
      emit();
    },
    runEnd(ok, detail) {
      set({ retry: ok ? null : flags.retry });
      if (ok) {
        if (reconnectFrom !== null) set({ reconnectMs: now() - reconnectFrom });
        if (outageFrom !== null) set({ outageMs: now() - outageFrom });
        reconnectFrom = null;
        outageFrom = null;
      } else if (outageFrom === null) {
        outageFrom = now();
      }
      add('sync', detail);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}
