import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo } from '../src/data/repo';
import { createSyncEngine } from '../src/sync/engine';
import { createSyncRunner, type RunnerEnv } from '../src/sync/runner';
import { fakeNow, seedInbox, testDb } from './helpers';
import { fakeFetch, json, pullBody } from './sync-helpers';

/** Runner + engine + local database together, with a network that can be switched off. */
function setup(mode: 'refuse' | 'hang') {
  const net = { up: true };
  const fetch = fakeFetch((call) => {
    if (!net.up) {
      // A dead connection either fails at once or never answers (until aborted).
      return mode === 'refuse' ? 'network-error' : new Promise<never>(() => {});
    }
    if (call.url === '/api/sync/push') {
      return json(200, {
        accepted: call.body.ops.map((o: { opId: string }) => o.opId),
        rejected: [],
      });
    }
    return json(200, pullBody([]));
  });
  const handlers = new Set<() => void>();
  const env: RunnerEnv & { online: boolean } = {
    online: true,
    isOnline: () => env.online,
    isVisible: () => true,
    on: (event, h) => {
      if (event === 'online') handlers.add(h);
      return () => handlers.delete(h);
    },
    random: () => 0.5,
  };
  const db = testDb();
  const engine = createSyncEngine({ db, fetch });
  const runner = createSyncRunner({ engine, env });
  /** `browserKnows: false` is a flaky connection: requests fail but `navigator.onLine` stays true. */
  const goOffline = (browserKnows = true) => {
    net.up = false;
    env.online = !browserKnows;
  };
  const goOnline = () => {
    net.up = true;
    env.online = true;
    handlers.forEach((h) => h());
  };
  return { db, engine, runner, goOffline, goOnline, fetch };
}

/** Moves the fake clock in 1 s steps, letting IndexedDB (real async I/O) finish in between. */
async function pass(ms: number) {
  for (let t = 0; t < Math.max(ms, 1); t += 1000) {
    await vi.advanceTimersByTimeAsync(Math.min(1000, ms - t));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe.each(['refuse', 'hang'] as const)('changes made while offline (%s)', (mode) => {
  it('are sent once the connection is back', async () => {
    const { db, runner, goOffline, goOnline } = setup(mode);
    const inbox = await seedInbox(db);
    const repo = createRepo(db, { now: fakeNow() });
    db.outbox.hook('creating', () => runner.notifyChange());
    runner.start();
    await pass(0);

    goOffline();
    await repo.createTodo({ listId: inbox.id, title: 'written offline' });
    await pass(5 * 60_000);
    expect(await db.outbox.count()).toBe(1);

    goOnline();
    await pass(5 * 60_000);
    expect(await db.outbox.count()).toBe(0);
  });

  it('are sent when the connection drops during a sync and then returns', async () => {
    const { db, runner, goOffline, goOnline } = setup(mode);
    const inbox = await seedInbox(db);
    const repo = createRepo(db, { now: fakeNow() });
    db.outbox.hook('creating', () => runner.notifyChange());
    runner.start();
    await pass(0);

    goOffline(false); // the browser still believes it is online, so syncs are attempted
    await repo.createTodo({ listId: inbox.id, title: 'written offline' });
    await pass(2000);
    goOnline();
    await pass(5 * 60_000);
    expect(await db.outbox.count()).toBe(0);
  });
});
