import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareHlc, newId } from '@todoness/shared';
import { createRepo } from '../../src/data/repo';
import { createSyncEngine, SyncError } from '../../src/sync/engine';
import { fakeNow, seedInbox, T0, testDb } from '../helpers/db';
import { fakeFetch, hlcAt, json, listChange, pullBody, todoChange } from '../helpers/fetch';

async function withPendingTodos(n: number) {
  const db = testDb();
  const inbox = await seedInbox(db);
  const repo = createRepo(db, { now: fakeNow() });
  const ids: string[] = [];
  for (let i = 0; i < n; i++)
    ids.push((await repo.createTodo({ listId: inbox.id, title: `t${i}` })).id);
  return { db, inbox, repo, ids };
}

const acceptAll = (call: { body: { ops: { opId: string }[] } }) =>
  json(200, { accepted: call.body.ops.map((o) => o.opId), rejected: [] });

describe('push', () => {
  it('does nothing when there is nothing to send', async () => {
    const db = testDb();
    const f = fakeFetch(() => json(200, {}));
    expect(await createSyncEngine({ db, fetch: f }).push()).toEqual({ sent: 0, rejected: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('sends the oldest first in batches and removes what was accepted', async () => {
    const { db, ids } = await withPendingTodos(5);
    const f = fakeFetch((call) => acceptAll(call as never));
    const result = await createSyncEngine({ db, fetch: f, batchSize: 2 }).push();

    expect(result).toEqual({ sent: 5, rejected: 0 });
    expect(f.calls.map((c) => c.body.ops.length)).toEqual([2, 2, 1]);
    const sentIds = f.calls.flatMap((c) => c.body.ops.map((o: { entityId: string }) => o.entityId));
    expect(sentIds).toEqual(ids); // creation order
    expect(await db.outbox.count()).toBe(0);
    expect(f.calls[0]!.url).toBe('/api/sync/push');
    expect(f.calls[0]!.method).toBe('POST');
  });

  it('sends the browser id and only the fields the server expects', async () => {
    const { db } = await withPendingTodos(1);
    const f = fakeFetch((call) => acceptAll(call as never));
    await createSyncEngine({ db, fetch: f }).push();
    const clientId = await db.getMeta<string>('clientId');
    expect(f.calls[0]!.body.clientId).toBe(clientId);
    expect(Object.keys(f.calls[0]!.body.ops[0]).sort()).toEqual(
      ['entity', 'entityId', 'hlc', 'opId', 'patch', 'type'].sort(),
    );
  });

  it('moves rejected operations to deadLetter with the reason', async () => {
    const { db } = await withPendingTodos(3);
    const f = fakeFetch((call) => {
      const ops = (call.body as { ops: { opId: string }[] }).ops;
      return json(200, {
        accepted: [ops[0]!.opId, ops[2]!.opId],
        rejected: [{ opId: ops[1]!.opId, reason: 'list_not_found' }],
      });
    });
    const result = await createSyncEngine({ db, fetch: f }).push();
    expect(result).toEqual({ sent: 2, rejected: 1 });
    expect(await db.outbox.count()).toBe(0);
    const dead = await db.deadLetter.toArray();
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ reason: 'list_not_found', entity: 'todo' });
    expect(dead[0]!.failedAt).toBeGreaterThan(0);
  });

  it('keeps everything and reports "offline" when the network fails', async () => {
    const { db } = await withPendingTodos(2);
    const engine = createSyncEngine({ db, fetch: fakeFetch(() => 'network-error') });
    await expect(engine.push()).rejects.toMatchObject({ kind: 'offline' });
    expect(await db.outbox.count()).toBe(2);
    expect((await db.outbox.toArray()).map((o) => o.attempts)).toEqual([1, 1]);
  });

  it('keeps everything and reports "server" on a 5xx answer', async () => {
    const { db } = await withPendingTodos(2);
    const engine = createSyncEngine({ db, fetch: fakeFetch(() => json(503, {})) });
    await expect(engine.push()).rejects.toMatchObject({ kind: 'server' });
    expect(await db.outbox.count()).toBe(2);
  });

  it('reports "auth" on 401 and keeps the queue', async () => {
    const { db } = await withPendingTodos(2);
    const engine = createSyncEngine({
      db,
      fetch: fakeFetch(() => json(401, { error: 'unauthorized' })),
    });
    const err = await engine.push().catch((e) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect(err.kind).toBe('auth');
    expect(await db.outbox.count()).toBe(2);
    expect(await db.deadLetter.count()).toBe(0);
  });

  it('moves a batch the server calls invalid (4xx) to deadLetter instead of retrying forever', async () => {
    const { db } = await withPendingTodos(2);
    const engine = createSyncEngine({
      db,
      fetch: fakeFetch(() => json(400, { error: 'invalid_request' })),
    });
    await engine.push();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.deadLetter.toArray()).map((d) => d.reason)).toEqual(['http_400', 'http_400']);
  });

  it('does not loop forever if the server answers about none of the operations', async () => {
    const { db } = await withPendingTodos(2);
    const f = fakeFetch(() => json(200, { accepted: [], rejected: [] }));
    await expect(createSyncEngine({ db, fetch: f }).push()).rejects.toMatchObject({
      kind: 'server',
    });
    expect(f.calls).toHaveLength(1);
    expect(await db.outbox.count()).toBe(2);
  });

  it('treats a garbled answer as a server error', async () => {
    const { db } = await withPendingTodos(1);
    const engine = createSyncEngine({ db, fetch: fakeFetch(() => json(200, { nope: true })) });
    await expect(engine.push()).rejects.toMatchObject({ kind: 'server' });
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps operations created while a push is in flight', async () => {
    const { db, inbox, repo } = await withPendingTodos(1);
    const f = fakeFetch(async (call, i) => {
      if (i === 0) await repo.createTodo({ listId: inbox.id, title: 'added during push' });
      return acceptAll(call as never);
    });
    await createSyncEngine({ db, fetch: f }).push();
    // The new operation was queued while the first was being sent, then sent in a second round.
    expect(await db.outbox.count()).toBe(0);
    expect(f.calls.flatMap((c) => c.body.ops).length).toBe(2);
  });
});

describe('pull', () => {
  it('applies changes, saves the cursor and then asks from there', async () => {
    const db = testDb();
    const list = listChange({ patch: { name: 'Work', orderKey: 'a1' } });
    const todo = todoChange(list.entityId as string);
    const f = fakeFetch((_, i) =>
      i === 0 ? json(200, pullBody([list, todo])) : json(200, pullBody([], false, todo.serverSeq)),
    );
    const engine = createSyncEngine({ db, fetch: f });

    expect(await engine.pull()).toEqual({ applied: 2 });
    expect(await db.lists.get(list.entityId as string)).toMatchObject({
      name: 'Work',
      isInbox: false,
    });
    expect(await db.todos.get(todo.entityId as string)).toMatchObject({ title: 'From server' });
    expect(await db.getMeta('lastServerSeq')).toBe(todo.serverSeq);
    expect(f.calls[0]!.url).toBe(
      '/api/sync/pull?since=0&limit=500&reminders=list&lists=modules&plans=1&activities=done,groups',
    );

    await engine.pull();
    expect(f.calls[1]!.url).toBe(
      `/api/sync/pull?since=${todo.serverSeq}&limit=500&reminders=list&lists=modules&plans=1&activities=done,groups`,
    );
  });

  it('keeps asking while the server says there is more', async () => {
    const db = testDb();
    const l1 = listChange();
    const l2 = listChange();
    const f = fakeFetch((c) =>
      json(200, c.url.includes('since=0') ? pullBody([l1], true) : pullBody([l2], false)),
    );
    expect(await createSyncEngine({ db, fetch: f, pullLimit: 1 }).pull()).toEqual({ applied: 2 });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.url).toContain(`since=${l1.serverSeq}`);
    expect(await db.lists.count()).toBe(2);
  });

  it('applies delete and restore', async () => {
    const db = testDb();
    const list = listChange();
    const id = list.entityId as string;
    const del = listChange({
      entityId: id,
      type: 'delete',
      patch: { deletedAt: T0 + 5 },
      hlc: hlcAt(T0 + 5),
    });
    const f = fakeFetch(() => json(200, pullBody([list, del])));
    await createSyncEngine({ db, fetch: f }).pull();
    expect((await db.lists.get(id))!.deletedAt).toBe(T0 + 5);

    const restore = listChange({
      entityId: id,
      type: 'restore',
      patch: { deletedAt: null },
      hlc: hlcAt(T0 + 9),
    });
    const f2 = fakeFetch(() => json(200, pullBody([restore])));
    await createSyncEngine({ db, fetch: f2 }).pull();
    expect((await db.lists.get(id))!.deletedAt).toBeNull();
  });

  it('a remote edit older than the local one does not overwrite it, a newer one does', async () => {
    const { db, inbox, repo } = await withPendingTodos(0);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'Local' }); // HLC around T0
    const older = todoChange(inbox.id, {
      entityId: todo.id,
      type: 'update',
      patch: { title: 'Remote old' },
      hlc: hlcAt(T0 - 5_000),
    });
    await createSyncEngine({ db, fetch: fakeFetch(() => json(200, pullBody([older]))) }).pull();
    expect((await db.todos.get(todo.id))!.title).toBe('Local');

    const newer = todoChange(inbox.id, {
      entityId: todo.id,
      type: 'update',
      patch: { title: 'Remote new' },
      hlc: hlcAt(T0 + 5_000),
    });
    await createSyncEngine({ db, fetch: fakeFetch(() => json(200, pullBody([newer]))) }).pull();
    expect((await db.todos.get(todo.id))!.title).toBe('Remote new');
  });

  it('keeps a pending local edit of another field when a remote change arrives', async () => {
    const { db, inbox, repo } = await withPendingTodos(0);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'Base' });
    await repo.updateTodo(todo.id, { priority: 3 }); // not sent yet
    const remote = todoChange(inbox.id, {
      entityId: todo.id,
      type: 'update',
      patch: { title: 'Remote title' },
      hlc: hlcAt(T0 + 9_000),
    });
    await createSyncEngine({ db, fetch: fakeFetch(() => json(200, pullBody([remote]))) }).pull();
    expect(await db.todos.get(todo.id)).toMatchObject({ title: 'Remote title', priority: 3 });
  });

  it('ignores a change for a row it does not have, without failing', async () => {
    const db = testDb();
    const orphan = todoChange(newId(), { type: 'update', patch: { title: 'x' } });
    const real = listChange();
    const engine = createSyncEngine({
      db,
      fetch: fakeFetch(() => json(200, pullBody([orphan, real]))),
    });
    expect(await engine.pull()).toEqual({ applied: 2 });
    expect(await db.todos.count()).toBe(0);
    expect(await db.lists.get(real.entityId as string)).toBeDefined();
  });

  it('moves the local clock past a remote timestamp from the future', async () => {
    const { db, inbox } = await withPendingTodos(0);
    const farFuture = T0 + 10 * 86_400_000;
    const remote = listChange({ hlc: hlcAt(farFuture) });
    await createSyncEngine({ db, fetch: fakeFetch(() => json(200, pullBody([remote]))) }).pull();

    const repo = createRepo(db, { now: fakeNow() }); // device clock is still at T0
    await repo.createTodo({ listId: inbox.id, title: 'after pull' });
    const op = (await db.outbox.toArray()).at(-1)!;
    expect(compareHlc(hlcAt(farFuture), op.hlc)).toBe(-1);
  });

  it('applies nothing and keeps the cursor when the answer is garbled', async () => {
    const db = testDb();
    const good = listChange();
    const bad = { ...listChange(), type: 'explode' };
    const engine = createSyncEngine({
      db,
      fetch: fakeFetch(() => json(200, pullBody([good, bad]))),
    });
    await expect(engine.pull()).rejects.toMatchObject({ kind: 'server' });
    expect(await db.lists.count()).toBe(0);
    expect(await db.getMeta('lastServerSeq')).toBeUndefined();
  });

  it('reports offline, auth and server problems', async () => {
    const db = testDb();
    await expect(
      createSyncEngine({ db, fetch: fakeFetch(() => 'network-error') }).pull(),
    ).rejects.toMatchObject({ kind: 'offline' });
    await expect(
      createSyncEngine({ db, fetch: fakeFetch(() => json(401, {})) }).pull(),
    ).rejects.toMatchObject({ kind: 'auth' });
    await expect(
      createSyncEngine({ db, fetch: fakeFetch(() => json(500, {})) }).pull(),
    ).rejects.toMatchObject({ kind: 'server' });
  });

  it('never moves the cursor backwards', async () => {
    const db = testDb();
    await db.setMeta('lastServerSeq', 50);
    const f = fakeFetch(() => json(200, pullBody([], false, 10)));
    await createSyncEngine({ db, fetch: f }).pull();
    expect(await db.getMeta('lastServerSeq')).toBe(50);
  });
});

describe('sync() and status', () => {
  it('pushes first, then pulls, and ends idle with a time', async () => {
    const { db } = await withPendingTodos(1);
    const order: string[] = [];
    const f = fakeFetch((call) => {
      order.push(call.url.split('?')[0]!);
      return call.url.includes('push') ? acceptAll(call as never) : json(200, pullBody([]));
    });
    const engine = createSyncEngine({ db, fetch: f, now: () => 123 });
    expect(await engine.sync()).toEqual({ ok: true });
    expect(order).toEqual(['/api/sync/push', '/api/sync/pull']);
    expect(engine.status).toEqual({ state: 'idle', lastSyncAt: 123 });
  });

  it('never throws; it reports the problem and sets the status', async () => {
    const db = testDb();
    const cases: [ReturnType<typeof fakeFetch>, string, string][] = [
      [fakeFetch(() => 'network-error'), 'offline', 'offline'],
      [fakeFetch(() => json(401, {})), 'auth', 'auth_required'],
      [fakeFetch(() => json(500, {})), 'server', 'error'],
    ];
    for (const [f, kind, state] of cases) {
      const engine = createSyncEngine({ db, fetch: f });
      expect(await engine.sync()).toMatchObject({ ok: false, kind });
      expect(engine.status.state).toBe(state);
    }
  });

  it('tells listeners about every change, and stops after unsubscribe', async () => {
    const db = testDb();
    const f = fakeFetch(() => json(200, pullBody([])));
    const engine = createSyncEngine({ db, fetch: f });
    const seen: string[] = [];
    const off = engine.subscribe((s) => seen.push(s.state));
    await engine.sync();
    expect(seen).toEqual(['syncing', 'idle']);
    off();
    await engine.sync();
    expect(seen).toEqual(['syncing', 'idle']);
  });

  it('runs one sync at a time', async () => {
    const db = testDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fakeFetch(async () => {
      await gate;
      return json(200, pullBody([]));
    });
    const engine = createSyncEngine({ db, fetch: f });
    const a = engine.sync();
    const b = engine.sync();
    release();
    await Promise.all([a, b]);
    expect(f.calls).toHaveLength(1);
  });

  it('markOffline sets the status without a request', () => {
    const f = fakeFetch(() => json(200, {}));
    const engine = createSyncEngine({ db: testDb(), fetch: f });
    engine.markOffline();
    expect(engine.status.state).toBe('offline');
    expect(f.calls).toHaveLength(0);
  });
});

describe('timeouts and abort (offline → online speed)', () => {
  const never = () => new Promise<never>(() => {}); // a dead connection: never answers

  async function setup(opts: { diag?: import('../../src/sync/diagnostics').SyncDiagnostics } = {}) {
    const db = testDb();
    await seedInbox(db);
    const f = fakeFetch(() => never());
    const engine = createSyncEngine({ db, fetch: f, ...opts });
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    return { engine, f };
  }
  /** Moves the fake clock in small steps, letting IndexedDB (real async I/O) finish in between. */
  async function pass(ms: number) {
    for (let t = 0; t < ms; t += 100) {
      await vi.advanceTimersByTimeAsync(Math.min(100, ms - t));
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    }
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up on a silent connection after 3.5 s, and reports offline', async () => {
    const { engine } = await setup();
    const result = engine.sync();
    await pass(3400);
    expect(engine.status.state).toBe('syncing');
    await pass(200);
    expect(await result).toMatchObject({ ok: false, kind: 'offline' });
  });

  it('after a failure the next request only waits 2 s', async () => {
    const { engine } = await setup();
    const first = engine.sync();
    await pass(3600);
    await first;
    const second = engine.sync();
    await pass(1900);
    expect(engine.status.state).toBe('syncing');
    await pass(200);
    expect(await second).toMatchObject({ ok: false, kind: 'offline' });
  });

  it('abort() ends a waiting request at once', async () => {
    const { engine } = await setup();
    const result = engine.sync();
    await pass(300);
    engine.abort();
    await pass(100);
    expect(await result).toMatchObject({ ok: false, kind: 'offline' });
  });

  it('abort() with nothing waiting does nothing', async () => {
    const { engine } = await setup();
    expect(() => engine.abort()).not.toThrow();
  });

  it('records request timings for the admin diagnostics', async () => {
    const { createSyncDiagnostics } = await import('../../src/sync/diagnostics');
    const diag = createSyncDiagnostics(() => Date.now()); // read the (fake) clock each time
    const { engine } = await setup({ diag });
    const result = engine.sync();
    await pass(3700);
    await result;
    expect(diag.getSnapshot().flags.lastRequest).toMatchObject({
      what: 'pull',
      outcome: 'no answer (timeout)',
    });
    expect(diag.getSnapshot().flags.lastRequest!.ms).toBeGreaterThanOrEqual(3500);
  });

  describe('ping (is the server reachable?)', () => {
    async function pingSetup(answer: () => Response | 'network-error' | Promise<never>) {
      const db = testDb();
      await seedInbox(db);
      const f = fakeFetch(answer as never);
      const engine = createSyncEngine({ db, fetch: f });
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });
      return { engine, f };
    }

    it('is true when the server answers, whatever it answers (it is reachable)', async () => {
      for (const status of [200, 401, 500, 503]) {
        const { engine, f } = await pingSetup(() => json(status, {}));
        expect(await engine.ping(), String(status)).toBe(true);
        expect(f.calls.at(-1)).toMatchObject({ url: '/api/health', method: 'GET' });
        vi.useRealTimers();
      }
    });

    it('is false when the request fails', async () => {
      const { engine } = await pingSetup(() => 'network-error');
      expect(await engine.ping()).toBe(false);
    });

    it('is false when nothing answers within 2 seconds', async () => {
      const { engine } = await pingSetup(() => never());
      const result = engine.ping();
      await pass(1900);
      let done = false;
      void result.then(() => (done = true));
      await pass(50);
      expect(done).toBe(false);
      await pass(100);
      expect(await result).toBe(false);
    });

    it('does not change the sync status', async () => {
      const { engine } = await pingSetup(() => 'network-error');
      await engine.ping();
      expect(engine.status.state).toBe('idle');
    });
  });
});
