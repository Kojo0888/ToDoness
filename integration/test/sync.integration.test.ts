import { describe, expect, it } from 'vitest';
import { getLists, getOpenTodos } from '../../client/src/data/queries';
import { Browser, startServer, twoBrowsers, T0 } from './harness';

/** Both browsers must hold exactly the same data, including the field clocks. */
async function expectConverged(a: Browser, b: Browser) {
  expect(await a.snapshot()).toEqual(await b.snapshot());
}

const count = (db: ReturnType<typeof startServer>['db'], sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;

describe('first login on a device', () => {
  it('delivers the Inbox created at sign-up', async () => {
    const server = startServer();
    const a = new Browser(server, 'laptop');
    await a.register('ann@corp.test');
    const lists = await getLists(a.db);
    expect(lists.map((l) => [l.name, l.isInbox])).toEqual([['Inbox', true]]);
    expect(await a.db.getMeta('lastServerSeq')).toBeGreaterThan(0);
  });

  it('a second device gets the same Inbox and existing tasks', async () => {
    const server = startServer();
    const a = new Browser(server, 'laptop');
    await a.register('ann@corp.test');
    const inbox = await a.inboxId();
    await a.repo.createTodo({ listId: inbox, title: 'Already there' });
    await a.sync();

    const b = new Browser(server, 'phone');
    await b.login('ann@corp.test');
    await b.sync();
    expect(await b.inboxId()).toBe(inbox);
    expect(await b.titles(inbox)).toEqual(['Already there']);
    await expectConverged(a, b);
  });
});

describe('step 6: syncing between browsers', () => {
  it('a task created on one browser appears on the other', async () => {
    const { a, b, inbox } = await twoBrowsers();
    await a.repo.createTodo({ listId: inbox, title: 'Buy milk', priority: 2 });
    await a.sync();
    await b.sync();
    expect(await b.titles(inbox)).toEqual(['Buy milk']);
    await expectConverged(a, b);
  });

  it('works offline, shows pending changes, and sends them once when back online', async () => {
    const { a, b, inbox, server } = await twoBrowsers();
    a.online = false;
    await a.repo.createTodo({ listId: inbox, title: 'one' });
    await a.repo.createTodo({ listId: inbox, title: 'two' });
    const t3 = await a.repo.createTodo({ listId: inbox, title: 'three' });
    await a.repo.setDone(t3.id, true);

    expect(await a.sync()).toMatchObject({ ok: false, kind: 'offline' });
    expect(a.engine.status.state).toBe('offline');
    expect(await a.db.outbox.count()).toBe(4);
    expect(await a.titles(inbox)).toEqual(['two', 'one']); // the app still works

    a.online = true;
    expect(await a.sync()).toEqual({ ok: true });
    expect(await a.db.outbox.count()).toBe(0);
    expect(count(server.db, 'SELECT COUNT(*) n FROM todos')).toBe(3);

    await b.sync();
    expect(await b.titles(inbox)).toEqual(['two', 'one']);
    await expectConverged(a, b);
  });

  it('creates no duplicates when the connection drops after the server applied the push', async () => {
    const { a, b, inbox, server } = await twoBrowsers();
    for (const title of ['x', 'y', 'z']) await a.repo.createTodo({ listId: inbox, title });
    const logBefore = count(server.db, 'SELECT COUNT(*) n FROM change_log');

    a.loseNextResponses = 1; // the server applies the push, the answer never arrives
    expect(await a.sync()).toMatchObject({ ok: false, kind: 'offline' });
    expect(count(server.db, 'SELECT COUNT(*) n FROM todos')).toBe(3); // already applied
    expect(await a.db.outbox.count()).toBe(3); // the browser does not know

    expect(await a.sync()).toEqual({ ok: true }); // sends the same operations again
    expect(count(server.db, 'SELECT COUNT(*) n FROM todos')).toBe(3);
    expect(count(server.db, 'SELECT COUNT(*) n FROM change_log')).toBe(logBefore + 3);
    expect(await a.db.outbox.count()).toBe(0);

    await b.sync();
    expect(await b.titles(inbox)).toEqual(['z', 'y', 'x']);
    await expectConverged(a, b);
  });

  it('also copes with several lost answers in a row', async () => {
    const { a, inbox, server } = await twoBrowsers();
    await a.repo.createTodo({ listId: inbox, title: 'persistent' });
    a.loseNextResponses = 3;
    for (let i = 0; i < 3; i++) await a.sync();
    expect(await a.sync()).toEqual({ ok: true });
    expect(count(server.db, "SELECT COUNT(*) n FROM todos WHERE title = 'persistent'")).toBe(1);
  });

  it('sends a long offline period in batches, in order', async () => {
    const server = startServer();
    const a = new Browser(server, 'laptop', { batchSize: 50 });
    await a.register('ann@corp.test');
    const inbox = await a.inboxId();
    a.online = false;
    for (let i = 0; i < 120; i++) await a.repo.createTodo({ listId: inbox, title: `t${i}` });
    a.online = true;
    a.requests.length = 0;

    expect(await a.sync()).toEqual({ ok: true });
    expect(a.requests.filter((r) => r.includes('push'))).toHaveLength(3);
    expect(count(server.db, 'SELECT COUNT(*) n FROM todos')).toBe(120);
    const titles = await a.titles(inbox);
    expect(titles[0]).toBe('t119');
    expect(titles.at(-1)).toBe('t0');
  });

  it('applying its own changes coming back changes nothing', async () => {
    const { a, inbox } = await twoBrowsers();
    const todo = await a.repo.createTodo({ listId: inbox, title: 'mine' });
    await a.sync();
    const before = await a.db.todos.get(todo.id);
    await a.sync();
    expect(await a.db.todos.get(todo.id)).toEqual(before);
  });

  it('two browsers adding tasks while offline see the same order afterwards', async () => {
    const { a, b, inbox } = await twoBrowsers();
    a.online = b.online = false;
    await a.repo.createTodo({ listId: inbox, title: 'from laptop' });
    await b.repo.createTodo({ listId: inbox, title: 'from phone' });
    a.online = b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();
    const order = await a.titles(inbox);
    expect(order.sort()).toEqual(['from laptop', 'from phone']);
    expect(await b.titles(inbox)).toEqual(await a.titles(inbox));
    await expectConverged(a, b);
  });
});

describe('step 7: conflicts and edge cases', () => {
  async function shared(title = 'Base') {
    const ctx = await twoBrowsers();
    const todo = await ctx.a.repo.createTodo({ listId: ctx.inbox, title });
    await ctx.a.sync();
    await ctx.b.sync();
    return { ...ctx, todo };
  }

  it('different fields edited on both devices while offline: both changes are kept', async () => {
    const { a, b, todo } = await shared();
    a.online = b.online = false;
    a.time += 1000;
    await a.repo.updateTodo(todo.id, { title: 'Title from laptop' });
    b.time += 2000;
    await b.repo.updateTodo(todo.id, { dueAt: T0 + 86_400_000, priority: 3 });
    a.online = b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();

    for (const x of [a, b]) {
      expect(await x.db.todos.get(todo.id)).toMatchObject({
        title: 'Title from laptop',
        dueAt: T0 + 86_400_000,
        priority: 3,
      });
    }
    await expectConverged(a, b);
  });

  it('the same field edited on both devices: the later edit wins on both', async () => {
    const { a, b, todo } = await shared();
    a.online = b.online = false;
    a.time += 5000;
    await a.repo.updateTodo(todo.id, { title: 'Earlier (laptop)' });
    b.time += 9000;
    await b.repo.updateTodo(todo.id, { title: 'Later (phone)' });
    a.online = b.online = true;
    // Whatever the order of arrival, the result is the same.
    await b.sync();
    await a.sync();
    await b.sync();
    expect((await a.db.todos.get(todo.id))!.title).toBe('Later (phone)');
    expect((await b.db.todos.get(todo.id))!.title).toBe('Later (phone)');
    await expectConverged(a, b);
  });

  it('delete on one device and edit on another: the task is deleted on both', async () => {
    const { a, b, todo, inbox } = await shared();
    a.online = b.online = false;
    a.time += 1000;
    await a.repo.deleteTodo(todo.id);
    b.time += 2000;
    await b.repo.updateTodo(todo.id, { title: 'Edited offline' });
    a.online = b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();
    expect(await a.titles(inbox)).toEqual([]);
    expect(await b.titles(inbox)).toEqual([]);
    await expectConverged(a, b);
  });

  it('delete then undo before the delete was sent: the task is back everywhere', async () => {
    const { a, b, todo, inbox } = await shared('Keep me');
    a.online = false;
    await a.repo.deleteTodo(todo.id);
    expect(await a.titles(inbox)).toEqual([]);
    a.time += 1000;
    await a.repo.restoreTodo(todo.id);
    a.online = true;
    await a.sync();
    await b.sync();
    expect(await a.titles(inbox)).toEqual(['Keep me']);
    expect(await b.titles(inbox)).toEqual(['Keep me']);
    await expectConverged(a, b);
  });

  it('undo after the delete was already sent brings it back on all devices', async () => {
    const { a, b, todo, inbox, server } = await shared('Keep me');
    await a.repo.deleteTodo(todo.id);
    await a.sync();
    await b.sync();
    expect(await b.titles(inbox)).toEqual([]);
    expect(count(server.db, 'SELECT COUNT(*) n FROM todos WHERE deleted_at IS NOT NULL')).toBe(1);

    a.time += 3000;
    await a.repo.restoreTodo(todo.id);
    await a.sync();
    await b.sync();
    expect(await b.titles(inbox)).toEqual(['Keep me']);
    expect(count(server.db, 'SELECT COUNT(*) n FROM todos WHERE deleted_at IS NOT NULL')).toBe(0);
    await expectConverged(a, b);
  });

  it('deleting a list with tasks removes the list and its tasks on all devices', async () => {
    const { a, b, inbox } = await twoBrowsers();
    const work = await a.repo.createList('Work');
    await a.repo.createTodo({ listId: work.id, title: 'w1' });
    await a.repo.createTodo({ listId: work.id, title: 'w2' });
    await a.repo.createTodo({ listId: inbox, title: 'keep' });
    await a.sync();
    await b.sync();
    expect(await b.titles(work.id)).toEqual(['w2', 'w1']);

    await a.repo.deleteList(work.id);
    await a.sync();
    await b.sync();
    expect((await getLists(b.db)).map((l) => l.name)).toEqual(['Inbox']);
    expect(await b.titles(inbox)).toEqual(['keep']);
    expect(await b.titles(work.id)).toEqual(['w2', 'w1'].slice(2)); // none left
    await expectConverged(a, b);
  });

  it('moving a task into a list that was deleted elsewhere hides it, with no error', async () => {
    const { a, b, inbox } = await twoBrowsers();
    const work = await a.repo.createList('Work');
    const todo = await a.repo.createTodo({ listId: inbox, title: 'wanderer' });
    await a.sync();
    await b.sync();

    a.online = b.online = false;
    await a.repo.deleteList(work.id);
    b.time += 1000;
    await b.repo.moveTodo(todo.id, work.id);
    a.online = b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();

    expect(await b.db.outbox.count()).toBe(0);
    expect(await b.db.deadLetter.count()).toBe(0);
    for (const x of [a, b]) {
      const visible = await Promise.all(
        (await getLists(x.db)).map((l) => getOpenTodos(x.db, l.id)),
      );
      expect(visible.flat().map((t) => t.title)).toEqual([]); // hidden together with the list
    }
    await expectConverged(a, b);
  });

  it('the Inbox cannot be renamed or deleted, not even by a forged operation', async () => {
    const { a, inbox, server } = await twoBrowsers();
    await expect(a.repo.renameList(inbox, 'Mine')).rejects.toMatchObject({
      code: 'inbox_protected',
    });
    await expect(a.repo.deleteList(inbox)).rejects.toMatchObject({ code: 'inbox_protected' });

    const clock = a.clock('aaaa');
    await a.db.outbox.add({
      opId: '0192f0c1-0000-7000-8000-000000000001',
      entity: 'list',
      type: 'delete',
      entityId: inbox,
      patch: {},
      hlc: clock.now(),
      attempts: 0,
      createdAt: a.time,
    });
    expect(await a.sync()).toEqual({ ok: true });
    expect((await a.db.deadLetter.toArray()).map((d) => d.reason)).toEqual(['inbox_protected']);
    expect(count(server.db, 'SELECT COUNT(*) n FROM lists WHERE deleted_at IS NOT NULL')).toBe(0);
  });

  it('a phone clock that is days behind still orders edits correctly once it has synced', async () => {
    const { a, b, todo } = await shared();
    b.time = T0 - 3 * 86_400_000; // the phone clock is 3 days behind
    a.time += 10_000;
    await a.repo.updateTodo(todo.id, { title: 'Laptop edit' });
    await a.sync();

    await b.sync(); // the phone sees the laptop's edit and its clock catches up
    b.time += 5000; // the phone edits later in real life
    await b.repo.updateTodo(todo.id, { title: 'Phone edit (later)' });
    await b.sync();
    await a.sync();

    expect((await a.db.todos.get(todo.id))!.title).toBe('Phone edit (later)');
    await expectConverged(a, b);
  });

  it('a task completed on one device shows as done on the other', async () => {
    const { a, b, todo, inbox } = await shared('Finish me');
    a.time += 1000;
    await a.repo.setDone(todo.id, true);
    await a.sync();
    await b.sync();
    expect(await b.titles(inbox)).toEqual([]);
    expect(await b.db.todos.get(todo.id)).toMatchObject({ done: true, completedAt: T0 + 1000 });
    await expectConverged(a, b);
  });
});

describe('reordering lists', () => {
  it('shows the same list order on every device', async () => {
    const { a, b } = await twoBrowsers();
    const x = await a.repo.createList('X');
    await a.repo.createList('Y');
    await a.repo.createList('Z');
    await a.sync();
    await b.sync();
    await a.repo.moveList(x.id, 'down');
    await a.sync();
    await b.sync();
    const names = async (br: Browser) => (await getLists(br.db)).map((l) => l.name);
    expect(await names(b)).toEqual(['Inbox', 'Y', 'X', 'Z']);
    expect(await names(a)).toEqual(await names(b));
    await expectConverged(a, b);
  });

  it('two devices creating a list while offline both end up with both lists in the same order', async () => {
    const { a, b } = await twoBrowsers();
    a.online = b.online = false;
    await a.repo.createList('From laptop');
    await b.repo.createList('From phone');
    a.online = b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();
    const names = async (br: Browser) => (await getLists(br.db)).map((l) => l.name);
    expect((await names(a)).sort()).toEqual(['From laptop', 'From phone', 'Inbox']);
    expect(await names(a)).toEqual(await names(b));
    // They can still be reordered although both got the same key.
    const second = (await getLists(a.db))[2]!;
    await a.repo.moveList(second.id, 'up');
    await a.sync();
    await b.sync();
    expect(await names(a)).toEqual(await names(b));
  });
});

describe('authentication during sync (admin reset)', () => {
  it('after an admin reset the browser asks for login, keeps its changes, and sends them after login', async () => {
    const server = startServer();
    const admin = new Browser(server, 'admin');
    await admin.register('admin@corp.test');
    const bob = new Browser(server, 'bob');
    const bobMe = await bob.register('bob@corp.test');
    const inbox = await bob.inboxId();

    // The admin resets bob's password.
    const reset = await admin.fetch(`/api/admin/users/${bobMe.id}/reset-password`, {
      method: 'POST',
    });
    expect(reset.status).toBe(204);

    // Bob keeps working offline-ish; his browser is logged out on the server.
    await bob.repo.createTodo({ listId: inbox, title: 'written while logged out' });
    expect(await bob.sync()).toMatchObject({ ok: false, kind: 'auth' });
    expect(bob.engine.status.state).toBe('auth_required');
    expect(await bob.db.outbox.count()).toBe(1);
    expect(await bob.titles(inbox)).toEqual(['written while logged out']);

    // He types a new password at the login screen.
    await bob.login('bob@corp.test', 'my brand new pass');
    expect(await bob.sync()).toEqual({ ok: true });
    expect(await bob.db.outbox.count()).toBe(0);
    expect(
      count(server.db, "SELECT COUNT(*) n FROM todos WHERE title = 'written while logged out'"),
    ).toBe(1);

    // And the new password is a normal password from now on.
    const again = new Browser(server, 'bob2');
    await again.login('bob@corp.test', 'my brand new pass');
  });
});

describe('users are separate', () => {
  it('two users never see each other’s data', async () => {
    const server = startServer();
    const ann = new Browser(server, 'ann');
    await ann.register('ann@corp.test');
    const bob = new Browser(server, 'bob');
    await bob.register('bob@corp.test');
    await ann.repo.createTodo({ listId: await ann.inboxId(), title: 'Ann private' });
    await ann.sync();
    await bob.sync();
    const bobData = JSON.stringify(await bob.snapshot());
    expect(bobData).not.toContain('Ann private');
    expect(await ann.inboxId()).not.toBe(await bob.inboxId());
  });
});
