import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectivity } from '../../src/sync/connectivity';
import {
  createSyncRunner as createRunner,
  type RunnerEnv,
  type RunnerOptions,
} from '../../src/sync/runner';
import type { SyncEngine, SyncResult, SyncStatus } from '../../src/sync/engine';

/** Most tests are about syncing, so the 5 s connection check is far away unless asked for. */
const createSyncRunner = (o: RunnerOptions) => createRunner({ probeIntervalMs: 600_000, ...o });

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
    ping: vi.fn(async () => true),
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
    ping: ReturnType<typeof vi.fn>;
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

  it('the aborted request does not flip the connection flag back to offline', async () => {
    let finishFirst!: (r: SyncResult) => void;
    const engine = fakeEngine([ok]);
    engine.sync.mockImplementationOnce(() => new Promise<SyncResult>((r) => (finishFirst = r)));
    const env = fakeEnv();
    const connectivity = createConnectivity(true); // a check just found the server
    createSyncRunner({ engine, env, connectivity, intervalMs: 600_000 }).start();
    await flush();
    env.fire('online');
    const seen: boolean[] = [];
    connectivity.subscribe(() => seen.push(connectivity.getSnapshot().online));
    finishFirst(offline); // our own abort, not a real failure
    await flush();
    expect(seen).not.toContain(false);
    expect(connectivity.getSnapshot().online).toBe(true);
  });

  it('a check that started before "online" and failed after it is ignored', async () => {
    let failPing!: (ok: boolean) => void;
    const engine = fakeEngine([ok]);
    const env = fakeEnv();
    const connectivity = createConnectivity(true);
    createSyncRunner({ engine, env, connectivity, probeIntervalMs: 1000 }).start();
    await flush();
    engine.ping.mockImplementationOnce(() => new Promise<boolean>((r) => (failPing = r)));
    await vi.advanceTimersByTimeAsync(1000); // a check is now waiting
    env.fire('online');
    failPing(false);
    await flush();
    expect(connectivity.getSnapshot().online).toBe(true);
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

  it('does not trust the browser’s offline flag: it still tries to sync', async () => {
    const engine = fakeEngine([ok]);
    const env = fakeEnv();
    env.online = false; // the browser says offline (it may be wrong)
    createSyncRunner({ engine, env }).start();
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

describe('connection check every 5 seconds (the browser flag is only a hint)', () => {
  function setup(opts: { sync?: SyncResult[]; ping?: boolean[] } = {}) {
    const engine = fakeEngine(opts.sync ?? [ok]);
    const answers = opts.ping ?? [true];
    let i = 0;
    engine.ping.mockImplementation(async () => answers[Math.min(i++, answers.length - 1)]!);
    const env = fakeEnv();
    const connectivity = createConnectivity(true);
    const runner = createRunner({ engine, env, connectivity, intervalMs: 600_000 });
    return { engine, env, connectivity, runner };
  }

  it('asks the server every 5 seconds, not before', async () => {
    const { engine, runner } = setup();
    runner.start();
    await flush();
    expect(engine.ping).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4999);
    expect(engine.ping).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.ping).toHaveBeenCalledTimes(2);
    runner.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.ping).toHaveBeenCalledTimes(2);
  });

  it('while everything works, the check changes nothing and starts no extra sync', async () => {
    const { engine, connectivity, runner } = setup();
    runner.start();
    await flush();
    engine.sync.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(engine.ping).toHaveBeenCalledTimes(3);
    expect(engine.sync).not.toHaveBeenCalled();
    expect(connectivity.getSnapshot().online).toBe(true);
  });

  it('a check that gets no answer shows Offline', async () => {
    const { engine, connectivity, runner } = setup({ ping: [false] });
    runner.start();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(connectivity.getSnapshot().online).toBe(false);
    expect(engine.markOffline).toHaveBeenCalled();
    expect(engine.status.state).toBe('offline');
  });

  it('the first check that gets an answer shows Online again and syncs at once', async () => {
    const { engine, connectivity, runner } = setup({ ping: [false, false, true] });
    runner.start();
    await flush();
    await vi.advanceTimersByTimeAsync(5000); // no answer
    await vi.advanceTimersByTimeAsync(5000); // no answer
    expect(connectivity.getSnapshot().online).toBe(false);
    engine.sync.mockClear();
    await vi.advanceTimersByTimeAsync(5000); // answer
    expect(connectivity.getSnapshot().online).toBe(true);
    expect(engine.sync).toHaveBeenCalledTimes(1); // no waiting for the next timer
  });

  it('works even when the browser says offline all the time (the headline case)', async () => {
    const { engine, env, connectivity, runner } = setup({
      sync: [offline, offline, ok],
      ping: [false, true],
    });
    env.online = false; // the browser is wrong
    runner.start();
    await flush();
    expect(connectivity.getSnapshot().online).toBe(false); // the first sync failed
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(connectivity.getSnapshot().online).toBe(true);
    expect(engine.sync.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a sync result also tells the app: saved = online, no answer = offline', async () => {
    const { connectivity, runner, engine } = setup({ sync: [offline, ok] });
    runner.start();
    await flush();
    expect(connectivity.getSnapshot().online).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); // the retry works
    expect(connectivity.getSnapshot().online).toBe(true);
    void engine;
  });

  it('a server error or a login problem still means the server is reachable', async () => {
    for (const result of [
      { ok: false, kind: 'server', message: 'x' },
      { ok: false, kind: 'auth', message: 'x' },
    ] as SyncResult[]) {
      const { connectivity, runner } = setup({ sync: [result] });
      connectivity.report(false);
      runner.start();
      await flush();
      expect(connectivity.getSnapshot().online, result.ok ? '' : result.kind).toBe(true);
      runner.stop();
    }
  });

  it('the browser’s "offline" event shows Offline at once, and a check right away can put it right', async () => {
    const { engine, env, connectivity, runner } = setup({ ping: [true] });
    runner.start();
    await flush();
    env.fire('offline');
    expect(connectivity.getSnapshot().online).toBe(false); // at once
    await flush();
    expect(engine.ping).toHaveBeenCalledTimes(1); // no waiting for the 5 s timer
    expect(connectivity.getSnapshot().online).toBe(true); // it was a false alarm
  });

  it('records the checks for the admin diagnostics', async () => {
    const { createSyncDiagnostics } = await import('../../src/sync/diagnostics');
    const diag = createSyncDiagnostics(() => Date.now());
    const engine = fakeEngine([ok]);
    engine.ping.mockResolvedValue(false);
    const runner = createRunner({
      engine,
      env: fakeEnv(),
      connectivity: createConnectivity(true),
      diag,
      intervalMs: 600_000,
    });
    runner.start();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(diag.getSnapshot().flags.lastProbe).toMatchObject({ ok: false });
    expect(diag.getSnapshot().events.some((e) => e.kind === 'connection')).toBe(true);
  });
});

describe('the browser flag shown in the diagnostics', () => {
  it('start() records the flag without inventing an "online event" or a reconnect timer', async () => {
    const { createSyncDiagnostics } = await import('../../src/sync/diagnostics');
    const diag = createSyncDiagnostics(() => Date.now());
    const env = fakeEnv();
    env.online = false;
    createSyncRunner({ engine: fakeEngine([ok]), env, diag }).start();
    await flush();
    expect(diag.getSnapshot().flags.browserOnline).toBe(false);
    expect(diag.getSnapshot().events.some((e) => e.kind === 'browser')).toBe(false);
    expect(diag.getSnapshot().flags.reconnectMs).toBeNull();
  });

  it('follows the real flag when an event arrives, not just the event name', async () => {
    const { createSyncDiagnostics } = await import('../../src/sync/diagnostics');
    const diag = createSyncDiagnostics(() => Date.now());
    const env = fakeEnv();
    createSyncRunner({ engine: fakeEngine([ok]), env, diag }).start();
    await flush();
    env.online = false;
    env.fire('offline');
    expect(diag.getSnapshot().flags.browserOnline).toBe(false);
    env.online = true;
    env.fire('online');
    expect(diag.getSnapshot().flags.browserOnline).toBe(true);
  });

  it('an "online" event whose abort came too late does not make the next real failure look like our own abort', async () => {
    let finishFirst!: (r: SyncResult) => void;
    const engine = fakeEngine([offline]);
    engine.sync.mockImplementationOnce(() => new Promise<SyncResult>((r) => (finishFirst = r)));
    const env = fakeEnv();
    const connectivity = createConnectivity(true);
    createSyncRunner({ engine, env, connectivity, intervalMs: 600_000 }).start();
    await flush();
    env.fire('online'); // aborts, but the request had already worked
    finishFirst(ok);
    await flush();
    engine.sync.mockClear();
    // a genuine outage afterwards must be reported, not swallowed as "our abort"
    env.fire('offline');
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connectivity.getSnapshot().online).toBe(false);
  });
});
