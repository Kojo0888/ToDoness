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
  };
}

function fakeEnv() {
  const handlers: Record<string, Set<() => void>> = { online: new Set(), visible: new Set() };
  const env = {
    online: true,
    visible: true,
    isOnline: () => env.online,
    isVisible: () => env.visible,
    on: (event: 'online' | 'visible', h: () => void) => {
      handlers[event]!.add(h);
      return () => handlers[event]!.delete(h);
    },
    random: () => 0.5,
    fire: (event: 'online' | 'visible') => handlers[event]!.forEach((h) => h()),
    listeners: () => handlers.online!.size + handlers.visible!.size,
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

  it('syncs every 60 seconds while online', async () => {
    const engine = fakeEngine([ok]);
    createSyncRunner({ engine, env: fakeEnv() }).start();
    await flush();
    engine.sync.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.sync).toHaveBeenCalledTimes(2);
  });

  it('retries after failures with growing delays, and starts over after a success', async () => {
    const engine = fakeEngine([offline, offline, offline, ok]);
    createSyncRunner({ engine, env: fakeEnv() }).start();
    await flush(); // fails (attempt 0) -> retry in 1s
    expect(engine.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(engine.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // second try, fails -> retry in 2s
    expect(engine.sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000); // third try, fails -> retry in 4s
    expect(engine.sync).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000); // fourth try works
    expect(engine.sync).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(engine.sync).toHaveBeenCalledTimes(4); // no more retries
  });

  it('syncs at once when the browser comes back online, skipping the wait', async () => {
    const engine = fakeEngine([offline, ok]);
    const env = fakeEnv();
    createSyncRunner({ engine, env }).start();
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
    await vi.advanceTimersByTimeAsync(61_000);
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
