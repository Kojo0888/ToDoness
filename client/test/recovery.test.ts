import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo } from '../src/data/repo';
import { createSyncEngine } from '../src/sync/engine';
import { createSyncRunner, type RunnerEnv } from '../src/sync/runner';
import { fakeNow, seedInbox, testDb } from './helpers';
import { fakeFetch, json, pullBody } from './sync-helpers';

/**
 * How long does it take from "the connection works again" to "all changes saved"?
 * The user wants this to be 5 seconds at most in every case, also when the dead
 * connection never answers (requests hang) and the browser does not notice the return.
 */
const LIMIT_MS = 5000;

function setup() {
  const net = { up: true };
  const fetch = fakeFetch(() => {
    if (!net.up) return new Promise<never>(() => {}); // a black hole: never answers
    return json(200, pullBody([]));
  });
  // Real answers for push, once the network is up.
  const answering = async (url: string, init?: RequestInit) => {
    if (net.up && url === '/api/sync/push') {
      const ops = (JSON.parse(String(init!.body)) as { ops: { opId: string }[] }).ops;
      return json(200, { accepted: ops.map((o) => o.opId), rejected: [] });
    }
    return fetch(url, init);
  };
  const handlers: Record<string, Set<() => void>> = {
    online: new Set(),
    offline: new Set(),
    visible: new Set(),
  };
  const env: RunnerEnv & { online: boolean } = {
    online: true,
    isOnline: () => env.online,
    isVisible: () => true,
    on: (event, h) => {
      handlers[event]!.add(h);
      return () => handlers[event]!.delete(h);
    },
    random: () => 0.5,
  };
  const db = testDb();
  const engine = createSyncEngine({ db, fetch: answering });
  const runner = createSyncRunner({ engine, env });
  const repo = createRepo(db, { now: fakeNow() });
  const fire = (event: 'online' | 'offline') => handlers[event]!.forEach((h) => h());
  return { db, engine, runner, repo, net, env, fire };
}

/** Moves the fake clock in 100 ms steps, letting IndexedDB (real async I/O) finish in between. */
async function pass(ms: number) {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(Math.min(100, ms - t));
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
  }
}

/** Runs one outage and returns how long after the return everything was saved. */
async function recovery(opts: {
  outageMs: number;
  browserNotices: boolean;
  extraChanges?: number;
}) {
  const { db, runner, repo, net, env, fire } = setup();
  const inbox = await seedInbox(db);
  db.outbox.hook('creating', () => runner.notifyChange());
  runner.start();
  await pass(100);

  net.up = false; // the connection dies silently: requests hang
  await repo.createTodo({ listId: inbox.id, title: 'during the outage' });
  for (let i = 0; i < (opts.extraChanges ?? 0); i++) {
    await repo.createTodo({ listId: inbox.id, title: `more ${i}` });
  }
  await pass(opts.outageMs);

  net.up = true; // the connection works again...
  if (opts.browserNotices) {
    env.online = true;
    fire('online'); // ...and the browser says so
  }
  let waited = 0;
  while ((await db.outbox.count()) > 0 && waited < 30_000) {
    await pass(100);
    waited += 100;
  }
  runner.stop();
  return waited;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('offline → online recovery time', () => {
  it('is immediate when the browser reports the connection is back', async () => {
    for (const outageMs of [500, 1500, 3000, 6000, 20_000]) {
      const ms = await recovery({ outageMs, browserNotices: true });
      expect(ms, `outage ${outageMs} ms`).toBeLessThanOrEqual(600);
    }
  });

  it('is at most 5 seconds even when nobody tells the app (silent return, hanging requests)', async () => {
    const worst: [number, number][] = [];
    for (let outageMs = 500; outageMs <= 14_000; outageMs += 500) {
      const ms = await recovery({ outageMs, browserNotices: false });
      worst.push([outageMs, ms]);
    }
    const bad = worst.filter(([, ms]) => ms > LIMIT_MS);
    expect(bad, `slower than ${LIMIT_MS} ms: ${JSON.stringify(bad)}`).toEqual([]);
  }, 120_000);

  it('a browser "offline" event shows Offline at once, without waiting for a failed request', async () => {
    const { runner, engine, env, fire } = setup();
    runner.start();
    await pass(100);
    env.online = false;
    fire('offline');
    await pass(0);
    expect(engine.status.state).toBe('offline');
    runner.stop();
  });
});
