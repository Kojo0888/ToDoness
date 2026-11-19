/**
 * Runs an action once while it is still running (docs/unstable-connection FR-255, FR-256):
 * a second press on "Add" must not create a second item. The flag is a plain variable, not
 * React state, so presses in the same millisecond (before a re-render) are ignored too.
 */
import { useMemo, useSyncExternalStore } from 'react';

export type GuardResult<T> = { ran: true; value: T } | { ran: false };

export interface SubmitGuard {
  /** Runs `action` unless one is running. Failures reach the caller; the guard is released. */
  run<T>(action: () => Promise<T>): Promise<GuardResult<T>>;
  busy(): boolean;
  subscribe(listener: (busy: boolean) => void): () => void;
}

export function createSubmitGuard(): SubmitGuard {
  let busy = false;
  const listeners = new Set<(busy: boolean) => void>();
  const set = (next: boolean) => {
    busy = next;
    for (const l of listeners) l(busy);
  };
  return {
    async run(action) {
      if (busy) return { ran: false };
      set(true);
      try {
        return { ran: true, value: await action() };
      } finally {
        set(false);
      }
    },
    busy: () => busy,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** `busy` for the button (disabled, `aria-busy`), `run` for the submit handler. */
export function useSubmitGuard(): { busy: boolean; run: SubmitGuard['run'] } {
  const guard = useMemo(() => createSubmitGuard(), []);
  const busy = useSyncExternalStore(guard.subscribe, guard.busy);
  return { busy, run: guard.run };
}
