import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncRunner, type RunnerEnv } from '../src/sync/runner';
import type { SyncEngine, SyncResult, SyncStatus } from '../src/sync/engine';

function fakeEngine(results: SyncResult[] = []) {
  let i = 0;
  const calls: number[] = [];
  const engine = {
    status: { state: 'idle', lastSyncAt: null } as SyncStatus,
    sync: vi.fn(async (): Promise<SyncResult> => {
      calls.push(Date.now());
      return results[Math.min(i++, results.length - 1)] ?? { ok: true };
    }),
    abort: vi.fn(),
    markOffline: vi.fn(() => {
      engine.status = { state: 'offline', lastSyncAt: null };
    }),
    subscribe: vi.fn(() => () => {}),
    push: vi.fn(),
    pull: vi.fn(),
  };
  return Object.assign(engine, { calls }) as unknown as SyncEngine & {
    calls: number[];
    sync: ReturnType<typeof vi.fn>;
    markOffline: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
}

function fakeEnv() {
  const handlers: Record<string, Set<() => void>> = {
    online: new Set(),
    offline: new Set(),
    visible: new Set(),
  };
  const env = {
    online: true,
    visible: true,
    isOnline: () => env.online,
    isVisible: () => env.visible,
    on: (event: 'online' | 'offline' | 'visible', h: () => void) => {
      handlers[event]!.add(h);
      return () => handlers[event]!.delete(h);
    },
    random: () => 0.5,
    fire: (event: 'online' | 'offline' | 'visible') => handlers[event]!.forEach((h) => h()),
    listeners: () => handlers.online!.size + handlers.offline!.size + handlers.visible!.size,
  };
  return env satisfies RunnerEnv & Record<string, unknown>;
}

const ok: SyncResult = { ok: true };
const offline: SyncResult = { ok: false, kind: 'offline', message: 'offline' };
const auth: SyncResult = { ok: false, kind: 'auth', message: 'auth' };
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('browser connection events (offline → online speed)', () => {
  it('"offline" shows Offline at once and gives up on waiting requests', async () => {
    const engine = fakeEngine([ok]);
    const env = fakeEnv();
    createSyncRunner({ engine, env }).start();
    await flush();
    env.online = false;
    env.fire('offline');
    expect(engine.abort).toHaveBeenCalled();
    expect(engine.markOffline).toHaveBeenCalled();
    expect(engine.status.state).toBe('offline');
  });

  it('"online" during a hanging sync aborts it and runs again straight away', async () => {
    let finishFirst!: (r: SyncResult) => void;
    const engine = fakeEngine([ok]);
    engine.sync.mockImplementationOnce(() => new Promise<SyncResult>((r) => (finishFirst = r)));
    const env = fakeEnv();
    createSyncRunner({ engine, env, intervalMs: 600_000 }).start();
    await flush(); // the first sync is waiting on a dead connection
    expect(engine.sync).toHaveBeenCalledTimes(1);

    env.fire('online');
    expect(engine.abort).toHaveBeenCalledTimes(1);
    finishFirst(offline); // the abort makes the waiting request fail
    await flush();
    expect(engine.sync).toHaveBeenCalledTimes(2); // again at once: no retry delay
  });

  it('"online" while nothing is running does not abort anything', async () => {
    const engine = fakeEngine([ok]);
    const env = fakeEnv();
    createSyncRunner({ engine, env }).start();
    await flush();
    env.fire('online');
    await flush();
    expect(engine.abort).not.toHaveBeenCalled();
  });

  it('removes its listeners when stopped', () => {
    const env = fakeEnv();
    const runner = createSyncRunner({ engine: fakeEngine([ok]), env });
    runner.start();
    expect(env.listeners()).toBe(3);
    runner.stop();
    expect(env.listeners()).toBe(0);
  });
});

describe('createSyncRunner', () => {
  it('syncs right away when started', async () => {
    const engine = fakeEngine([ok]);
    createSyncRunner({ engine, env: fakeEnv() }).start();
    await flush();
    expect(engine.sync).toHaveBeenCalledTimes(1);
  });

  it('waits one second after a local change and sends once for a burst', async () => {
    const engine = fakeEngine([ok]);
    const runner = createSyncRunner({ engine, env: fakeEnv() });
    runner.start();
    await flush();
    engine.sync.mockClear();

    runner.notifyChange();
    await vi.advanceTimersByTimeAsync(400);
    runner.notifyChange();
    await vi.advanceTimersByTimeAsync(400);
    runner.notifyChange();
    expect(engine.sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.sync).toHaveBeenCalledTimes(1);
  });

  it('syncs every 5 seconds while online', async () => {
    const engine = fakeEngine([ok]);
    createSyncRunner({ engine, env: fakeEnv() }).start();
    await flush();
    engine.sync.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.sync).toHaveBeenCalledTimes(2);
  });

  it('while the connection is down it retries every second, not slower', async () => {
    const engine = fakeEngine([offline, offline, offline, offline, offline, ok]);
    createSyncRunner({ engine, env: fakeEnv(), intervalMs: 600_000 }).start();
    await flush(); // fails -> retry in 1s
    expect(engine.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(engine.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.sync).toHaveBeenCalledTimes(2);
    for (let n = 3; n <= 6; n++) {
      await vi.advanceTimersByTimeAsync(1000); // never more than a second apart
      expect(engine.sync).toHaveBeenCalledTimes(n);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.sync).toHaveBeenCalledTimes(6); // it worked: no more retries
  });

  it('after server errors it backs off 1 s, 2 s, 4 s, then stays at 5 s at most', async () => {
    const serverError: SyncResult = { ok: false, kind: 'server', message: 'Server answered 500' };
    const engine = fakeEngine([serverError]);
    createSyncRunner({ engine, env: fakeEnv(), intervalMs: 600_000 }).start();
    await flush();
    expect(engine.sync).toHaveBeenCalledTimes(1);
    for (const [wait, calls] of [
      [1000, 2],
      [2000, 3],
      [4000, 4],
      [5000, 5],
      [5000, 6],
    ] as const) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(engine.sync).toHaveBeenCalledTimes(calls - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(engine.sync).toHaveBeenCalledTimes(calls);
    }
  });

  it('starts over with a short delay after a success', async () => {
    const serverError: SyncResult = { ok: false, kind: 'server', message: 'x' };
    const engine = fakeEngine([serverError, serverError, ok, serverError, ok]);
    const runner = createSyncRunner({ engine, env: fakeEnv(), intervalMs: 600_000 });
    runner.start();
    await vi.advanceTimersByTimeAsync(0 + 1000 + 2000); // fails, fails, works
    expect(engine.sync).toHaveBeenCalledTimes(3);
    runner.trigger(); // the next failure starts at 1 s again, not at 4 s
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.sync).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.sync).toHaveBeenCalledTimes(5);
  });

  it('syncs at once when the browser comes back online, skipping the wait', async () => {
    const engine = fakeEngine([offline, ok]);
    const env = fakeEnv();
    createSyncRunner({ engine, env, intervalMs: 600_000 }).start(); // isolate retries from the timer
    await flush(); // fails, retry planned in 1s
    env.fire('online');
    await flush();
    expect(engine.sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.sync).toHaveBeenCalledTimes(2); // the planned retry was cancelled
  });

  it('syncs when the tab becomes visible again', async () => {
    const engine = fakeEngine([ok]);
    const env = fakeEnv();
    createSyncRunner({ engine, env }).start();
    await flush();
    engine.sync.mockClear();
    env.fire('visible');
    await flush();
    expect(engine.sync).toHaveBeenCalledTimes(1);
  });

  it('does not call the server while the browser knows it is offline', async () => {
    const engine = fakeEngine([ok]);
    const env = fakeEnv();
    env.online = false;
    const runner = createSyncRunner({ engine, env });
    runner.start();
    await flush();
    runner.notifyChange();
    await vi.advanceTimersByTimeAsync(6000);
    expect(engine.sync).not.toHaveBeenCalled();
    expect(engine.markOffline).toHaveBeenCalled();

    env.online = true;
    env.fire('online');
    await flush();
    expect(engine.sync).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after an authentication problem and tells the app', async () => {
    const engine = fakeEngine([auth, ok]);
    const onAuthRequired = vi.fn();
    const runner = createSyncRunner({ engine, env: fakeEnv(), onAuthRequired });
    runner.start();
    await flush();
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(engine.sync).toHaveBeenCalledTimes(1); // no retries, no interval runs

    runner.trigger(); // after the user logged in again
    await flush();
    expect(engine.sync).toHaveBeenCalledTimes(2);
  });

  it('runs again afterwards if something changed while it was syncing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const engine = fakeEngine();
    engine.sync.mockImplementationOnce(async () => {
      await gate;
      return ok;
    });
    const runner = createSyncRunner({ engine, env: fakeEnv() });
    runner.start();
    await flush();
    runner.trigger(); // arrives during the first sync
    runner.trigger();
    expect(engine.sync).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(engine.sync).toHaveBeenCalledTimes(2); // exactly one more
  });

  it('stop() removes timers and listeners', async () => {
    const engine = fakeEngine([ok]);
    const env = fakeEnv();
    const runner = createSyncRunner({ engine, env });
    runner.start();
    await flush();
    runner.notifyChange();
    runner.stop();
    engine.sync.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    env.fire('online');
    await flush();
    expect(engine.sync).not.toHaveBeenCalled();
    expect(env.listeners()).toBe(0);
  });
});
