import { describe, expect, it, vi } from 'vitest';
import {
  enablePush,
  disablePush,
  ensurePush,
  pushState,
  releasePushForLogout,
  urlBase64ToUint8Array,
  type PushDeps,
} from '../src/app/push';

const KEY = 'BPk-_AbC123'; // a url-safe base64 string
const SUB_JSON = {
  endpoint: 'https://push.example/d1',
  expirationTime: null,
  keys: { p256dh: 'p', auth: 'a' },
};

function setup(
  over: Partial<{
    secure: boolean;
    hasPush: boolean;
    permission: NotificationPermission;
    requestResult: NotificationPermission;
    existing: boolean;
    flag: string | null;
    server: (url: string) => Response | 'network-error';
  }> = {},
) {
  const o = {
    secure: true,
    hasPush: true,
    permission: 'default' as NotificationPermission,
    requestResult: 'granted' as NotificationPermission,
    existing: false,
    flag: null as string | null,
    ...over,
  };
  let permission = o.permission;
  let subscribed = o.existing;
  const subscription = {
    endpoint: SUB_JSON.endpoint,
    toJSON: () => SUB_JSON,
    unsubscribe: vi.fn(async () => {
      subscribed = false;
      return true;
    }),
  };
  const subscribe = vi.fn<
    (o: {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    }) => Promise<typeof subscription>
  >(async () => {
    subscribed = true;
    return subscription;
  });
  const storage = new Map<string, string>(o.flag === null ? [] : [['todoness.push', o.flag]]);
  const calls: { url: string; method: string; body: unknown }[] = [];
  const deps: PushDeps = {
    isSecureContext: o.secure,
    hasPushSupport: o.hasPush,
    notification: {
      get permission() {
        return permission;
      },
      requestPermission: vi.fn(async () => {
        permission = o.requestResult;
        return permission;
      }),
    },
    registration: async () => ({
      pushManager: { getSubscription: async () => (subscribed ? subscription : null), subscribe },
    }),
    fetch: async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const reply = o.server
        ? o.server(url)
        : url.endsWith('/key')
          ? new Response(JSON.stringify({ publicKey: KEY }), { status: 200 })
          : new Response(null, { status: 204 });
      if (reply === 'network-error') throw new TypeError('Failed to fetch');
      return reply;
    },
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) },
  };
  return {
    deps,
    calls,
    subscribe,
    subscription,
    storage,
    requestPermission: deps.notification!.requestPermission as ReturnType<typeof vi.fn>,
  };
}

describe('urlBase64ToUint8Array', () => {
  it('decodes url-safe base64 with or without padding', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQI')]).toEqual([1, 2]);
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]);
  });
});

describe('pushState (FR-65)', () => {
  it('says why push is not possible', async () => {
    expect(await pushState(setup({ secure: false }).deps)).toBe('insecure');
    expect(await pushState(setup({ hasPush: false }).deps)).toBe('unsupported');
    expect(await pushState(setup({ permission: 'denied' }).deps)).toBe('denied');
  });

  it('off until the user allows it, then on once this device is subscribed', async () => {
    expect(await pushState(setup({ permission: 'default' }).deps)).toBe('off');
    expect(await pushState(setup({ permission: 'granted' }).deps)).toBe('off');
    expect(await pushState(setup({ permission: 'granted', existing: true }).deps)).toBe('on');
  });
});

describe('enablePush (FR-59)', () => {
  it('asks permission, subscribes with the server’s key and tells the server', async () => {
    const s = setup();
    expect(await enablePush(s.deps)).toBe('on');
    expect(s.requestPermission).toHaveBeenCalledTimes(1);
    const opts = s.subscribe.mock.calls[0]![0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(opts.userVisibleOnly).toBe(true);
    expect([...opts.applicationServerKey]).toEqual([...urlBase64ToUint8Array(KEY)]);
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/push/key',
      'POST /api/push/subscribe',
    ]);
    expect(s.calls[1]!.body).toEqual(SUB_JSON);
    expect(s.storage.get('todoness.push')).toBe('on');
  });

  it('does not ask again when it is already allowed', async () => {
    const s = setup({ permission: 'granted' });
    await enablePush(s.deps);
    expect(s.requestPermission).not.toHaveBeenCalled();
  });

  it('stops quietly when the user says no', async () => {
    const s = setup({ requestResult: 'denied' });
    expect(await enablePush(s.deps)).toBe('denied');
    expect(s.subscribe).not.toHaveBeenCalled();
    expect(s.calls).toEqual([]);
  });

  it('does nothing without HTTPS or support', async () => {
    for (const o of [{ secure: false }, { hasPush: false }]) {
      const s = setup(o);
      await enablePush(s.deps);
      expect(s.subscribe).not.toHaveBeenCalled();
      expect(s.requestPermission).not.toHaveBeenCalled();
    }
  });

  it('never throws: a server or push service problem leaves it off', async () => {
    expect(await enablePush(setup({ server: () => 'network-error' }).deps)).toBe('off');
    expect(
      await enablePush(setup({ server: () => new Response('{}', { status: 500 }) }).deps),
    ).toBe('off');
    const s = setup();
    s.subscribe.mockRejectedValueOnce(new Error('push service error'));
    expect(await enablePush(s.deps)).toBe('off');
  });
});

describe('disablePush', () => {
  it('unsubscribes in the browser and on the server, and remembers the choice', async () => {
    const s = setup({ permission: 'granted', existing: true, flag: 'on' });
    expect(await disablePush(s.deps)).toBe('off');
    expect(s.subscription.unsubscribe).toHaveBeenCalled();
    expect(s.calls).toEqual([
      { url: '/api/push/unsubscribe', method: 'POST', body: { endpoint: SUB_JSON.endpoint } },
    ]);
    expect(s.storage.get('todoness.push')).toBe('off');
  });
});

describe('ensurePush (every start, FR-59 / FR-60)', () => {
  it('re-registers an existing subscription for the logged-in user', async () => {
    const s = setup({ permission: 'granted', existing: true });
    await ensurePush(s.deps);
    expect(s.calls).toEqual([{ url: '/api/push/subscribe', method: 'POST', body: SUB_JSON }]);
    expect(s.subscribe).not.toHaveBeenCalled();
  });

  it('subscribes when notifications are allowed and the user never switched push off', async () => {
    const s = setup({ permission: 'granted' });
    await ensurePush(s.deps);
    expect(s.subscribe).toHaveBeenCalled();
  });

  it('respects a user who switched it off, and never asks for permission by itself', async () => {
    const off = setup({ permission: 'granted', flag: 'off' });
    await ensurePush(off.deps);
    expect(off.subscribe).not.toHaveBeenCalled();
    expect(off.calls).toEqual([]);

    const ask = setup({ permission: 'default' });
    await ensurePush(ask.deps);
    expect(ask.requestPermission).not.toHaveBeenCalled();
    expect(ask.subscribe).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    await expect(
      ensurePush(
        setup({ permission: 'granted', existing: true, server: () => 'network-error' }).deps,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('releasePushForLogout (FR-60)', () => {
  it('tells the server to forget this device, but keeps the browser subscription', async () => {
    const s = setup({ permission: 'granted', existing: true });
    await releasePushForLogout(s.deps);
    expect(s.calls).toEqual([
      { url: '/api/push/unsubscribe', method: 'POST', body: { endpoint: SUB_JSON.endpoint } },
    ]);
    expect(s.subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('does nothing without a subscription, and never throws', async () => {
    const s = setup({ permission: 'granted' });
    await releasePushForLogout(s.deps);
    expect(s.calls).toEqual([]);
    await expect(
      releasePushForLogout(
        setup({ permission: 'granted', existing: true, server: () => 'network-error' }).deps,
      ),
    ).resolves.toBeUndefined();
  });
});
