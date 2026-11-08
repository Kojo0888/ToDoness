/// <reference lib="webworker" />
/**
 * The service worker: offline app shell (as before) plus web push (docs/v1/PRD.md 4.7).
 * Built by vite-plugin-pwa in `injectManifest` mode, which fills in `self.__WB_MANIFEST`.
 * The decisions live in `sw-logic.ts`, which is tested on its own.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { chooseWindow, notificationOptions, parsePushPayload, safeAppUrl } from './sw-logic';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

// --- Offline app shell (same behaviour as the generated worker had) ----------------------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }),
);

// The app asks before switching to a new version (UpdateBanner), then sends this.
self.addEventListener('message', (event) => {
  if (event.data && (event.data as { type?: string }).type === 'SKIP_WAITING')
    void self.skipWaiting();
});

// --- Web push ----------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  const message = parsePushPayload(event.data?.text());
  event.waitUntil(self.registration.showNotification(message.title, notificationOptions(message)));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeAppUrl((event.notification.data as { url?: unknown } | null)?.url);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const i = chooseWindow(
        windows.map((w) => ({ focused: w.focused, visibilityState: w.visibilityState })),
      );
      if (i < 0) {
        await self.clients.openWindow(url);
        return;
      }
      const client = windows[i]!;
      await client.focus();
      client.postMessage({ type: 'navigate', url }); // the app changes its own route
    })(),
  );
});
