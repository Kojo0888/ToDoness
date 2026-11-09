/**
 * Whether the server can be reached, as the app itself found out (a request worked, a
 * check got an answer, a request got none). The browser's `navigator.onLine` is only a
 * hint: it can say "offline" while everything works (VPN, virtual adapters, a LAN without
 * internet) and its `online` event may never come, so it must not decide anything.
 */

export interface ConnectivitySnapshot {
  online: boolean;
}

export interface Connectivity {
  /** Returns true if the value changed. */
  report(online: boolean): boolean;
  subscribe(listener: () => void): () => void;
  /** A new object only when the value changes (what `useSyncExternalStore` needs). */
  getSnapshot(): ConnectivitySnapshot;
}

/** `initial`: the browser's hint until the first request or check has answered. */
export function createConnectivity(initial: boolean): Connectivity {
  let snapshot: ConnectivitySnapshot = { online: initial };
  const listeners = new Set<() => void>();
  return {
    report(online) {
      if (snapshot.online === online) return false;
      snapshot = { online };
      for (const l of listeners) l();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}
