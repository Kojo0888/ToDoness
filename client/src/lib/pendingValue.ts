/**
 * A value edited on this screen whose save has not come back yet.
 *
 * While saves are under way the local value is shown and built on, so quick edits combine
 * and a stale saved value (the emit of an earlier save) cannot bring an old value back.
 * Once nothing is in flight it gives way to the saved value as soon as that matches it,
 * a newer saved value arrives (e.g. from another device) or the save failed — so it can
 * never get stuck.
 */
export interface PendingValue<T> {
  readonly pending: boolean;
  /** What to show and build on: the local value while one is pending, else `saved`. */
  current(saved: T): T;
  /** A save of `next` starts. */
  start(next: T): void;
  /** A save ended; `saved` is the saved value as known right now. */
  settle(ok: boolean, saved: T): void;
  /** A new saved value arrived. */
  saved(saved: T): void;
}

export function createPendingValue<T>(
  same: (a: T, b: T) => boolean = Object.is,
  onChange?: () => void,
): PendingValue<T> {
  let local: { value: T } | null = null;
  let inFlight = 0;
  const clear = () => {
    if (!local) return;
    local = null;
    onChange?.();
  };
  return {
    get pending() {
      return local !== null;
    },
    current: (saved) => (local ? local.value : saved),
    start(next) {
      local = { value: next };
      inFlight++;
      onChange?.();
    },
    settle(ok, saved) {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0 && local && (!ok || same(saved, local.value))) clear();
    },
    saved() {
      if (inFlight === 0) clear();
    },
  };
}
