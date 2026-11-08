/**
 * Web push on this device (docs/v1/PRD.md section 4.7).
 * The server sends the reminders; this file only manages the subscription:
 * ask permission, subscribe through the browser's push service, tell our server.
 */

export type PushState = 'unsupported' | 'insecure' | 'denied' | 'off' | 'on';

interface SubscriptionLike {
  endpoint: string;
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
}

export interface PushDeps {
  isSecureContext: boolean;
  hasPushSupport: boolean;
  notification?: {
    permission: NotificationPermission;
    requestPermission(): Promise<NotificationPermission>;
  };
  registration(): Promise<{
    pushManager: {
      getSubscription(): Promise<SubscriptionLike | null>;
      subscribe(options: {
        userVisibleOnly: boolean;
        applicationServerKey: Uint8Array<ArrayBuffer>;
      }): Promise<SubscriptionLike>;
    };
  }>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

/** Remembers that the user switched push off here, so it is not turned on again by itself. */
const FLAG = 'todoness.push';

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const REGISTRATION_WAIT_MS = 5000;

export function browserPushDeps(): PushDeps {
  const hasNotification = typeof Notification !== 'undefined';
  return {
    isSecureContext: globalThis.isSecureContext ?? false,
    hasPushSupport:
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      hasNotification,
    ...(hasNotification ? { notification: Notification } : {}),
    async registration() {
      // `ready` never finishes when no service worker is registered (development mode).
      const wait = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('no service worker')), REGISTRATION_WAIT_MS),
      );
      return Promise.race([navigator.serviceWorker.ready, wait]);
    },
    fetch: (url, init) => fetch(url, init),
    storage: {
      getItem(key) {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem(key, value) {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* blocked storage: the choice then lasts until reload */
        }
      },
    },
  };
}

/** What can be known without asking the browser anything slow. */
function staticState(deps: PushDeps): PushState | 'possible' {
  if (!deps.isSecureContext) return 'insecure';
  if (!deps.hasPushSupport || !deps.notification) return 'unsupported';
  if (deps.notification.permission === 'denied') return 'denied';
  return 'possible';
}

async function currentSubscription(deps: PushDeps) {
  return (await deps.registration()).pushManager.getSubscription();
}

export async function pushState(deps: PushDeps = browserPushDeps()): Promise<PushState> {
  const fixed = staticState(deps);
  if (fixed !== 'possible') return fixed;
  if (deps.notification!.permission !== 'granted') return 'off';
  try {
    return (await currentSubscription(deps)) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

const post = (deps: PushDeps, path: string, body: unknown) =>
  deps.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Registers this browser's subscription with our server (it moves to the logged-in user). */
async function register(deps: PushDeps, sub: SubscriptionLike): Promise<boolean> {
  const res = await post(deps, '/api/push/subscribe', sub.toJSON());
  return res.ok;
}

/** Uses the existing subscription, or creates one with the server's public key. */
async function subscribe(deps: PushDeps): Promise<boolean> {
  const { pushManager } = await deps.registration();
  let sub = await pushManager.getSubscription();
  if (!sub) {
    const res = await deps.fetch('/api/push/key');
    if (!res.ok) return false;
    const { publicKey } = (await res.json()) as { publicKey?: string };
    if (!publicKey) return false;
    sub = await pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  return register(deps, sub);
}

/**
 * Switches push on for this device (FR-59). Call it from a click: it may ask for
 * permission. Never throws.
 */
export async function enablePush(deps: PushDeps = browserPushDeps()): Promise<PushState> {
  const fixed = staticState(deps);
  if (fixed !== 'possible') return fixed;

  if (deps.notification!.permission === 'default') await deps.notification!.requestPermission();
  if (deps.notification!.permission === 'denied') return 'denied';
  if (deps.notification!.permission !== 'granted') return 'off';

  try {
    if (!(await subscribe(deps))) return 'off';
  } catch {
    return 'off';
  }
  deps.storage.setItem(FLAG, 'on');
  return 'on';
}

/** Switches push off for this device, in the browser and on the server. */
export async function disablePush(deps: PushDeps = browserPushDeps()): Promise<PushState> {
  deps.storage.setItem(FLAG, 'off');
  try {
    const sub = await currentSubscription(deps);
    if (sub) {
      await post(deps, '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe();
    }
  } catch {
    /* already off */
  }
  return pushState(deps);
}

/**
 * On every start: if notifications are allowed and the user did not switch push off,
 * make sure this device is subscribed and known to the server for the logged-in user
 * (FR-59, FR-60). Never asks for permission. Never throws.
 */
export async function ensurePush(deps: PushDeps = browserPushDeps()): Promise<void> {
  try {
    if (staticState(deps) !== 'possible') return;
    if (deps.notification!.permission !== 'granted') return;
    if (deps.storage.getItem(FLAG) === 'off') return;
    await subscribe(deps);
  } catch {
    /* try again at the next start */
  }
}

/** Logging out: this device must stop receiving this user's reminders (FR-60). */
export async function releasePushForLogout(deps: PushDeps = browserPushDeps()): Promise<void> {
  try {
    if (staticState(deps) !== 'possible') return;
    const sub = await currentSubscription(deps);
    if (sub) await post(deps, '/api/push/unsubscribe', { endpoint: sub.endpoint });
  } catch {
    /* offline: the next login on this device moves the subscription anyway */
  }
}
