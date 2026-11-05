/** Registers the service worker and tells the app when a new version is waiting (FR-21). */
import { registerSW } from 'virtual:pwa-register';

let needRefresh = false;
let update: ((reloadPage?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();

export function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  update = registerSW({
    onNeedRefresh() {
      needRefresh = true;
      listeners.forEach((l) => l());
    },
  });
}

export const updateStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => needRefresh,
};

/** Switches to the new version and reloads. */
export function applyUpdate() {
  void update?.(true);
}
