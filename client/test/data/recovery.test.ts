import { describe, expect, it } from 'vitest';
import { takeSnapshot, type RecoverySnapshot } from '../../src/data/recovery';
import { createRepo } from '../../src/data/repo';
import { getLists, getOpenTodos, getDoneTodos } from '../../src/data/queries';
import { newId } from '@todoness/shared';
import { expectValidOutbox, fakeNow, seedInbox, testDb, T0 } from '../helpers/db';

/** An old device: an Inbox, a public list and a few tasks, all "already synced". */
async function oldDevice() {
  const db = testDb();
  const now = fakeNow();
  const repo = createRepo(db, { now });
  const inbox = await seedInbox(db);
  const work = await repo.createList('Work');
  await repo.setListPublic(work.id, true);
  const a = await repo.createTodo({ listId: inbox.id, title: 'Inbox task', notes: 'n' });
  const b = await repo.createTodo({
    listId: work.id,
    title: 'Due task',
    dueAt: T0 + 86_400_000,
    priority: 2,
  });
  await repo.updateTodo(b.id, { remindBefore: 'day' });
  const c = await repo.createTodo({ listId: work.id, title: 'Done task' });
  await repo.setDone(c.id, true);
  const gone = await repo.createTodo({ listId: work.id, title: 'Deleted task' });
  await repo.deleteTodo(gone.id);
  const goneList = await repo.createList('Deleted list');
  await repo.createTodo({ listId: goneList.id, title: 'In deleted list' });
  await repo.deleteList(goneList.id);
  await db.outbox.clear(); // as if everything had been sent
  return { db, repo, inbox, work, a, b, c };
}

/** A fresh device of the new account: only the Inbox the server created. */
async function freshAccount() {
  const db = testDb();
  const now = fakeNow(T0 + 1000);
  const repo = createRepo(db, { now });
  const inbox = await seedInbox(db, newId(T0 + 5_000)); // a new account has a new Inbox id
  return { db, repo, inbox };
}

describe('takeSnapshot', () => {
  it('returns nothing for an empty device', async () => {
    expect(await takeSnapshot(testDb(), 'ann@corp.test')).toBeUndefined();
  });

  it('returns nothing when only an empty Inbox is there', async () => {
    const db = testDb();
    await seedInbox(db);
    expect(await takeSnapshot(db, 'ann@corp.test')).toBeUndefined();
  });

  it('keeps live lists (not the Inbox) and live tasks, with all their fields', async () => {
    const { db, work, a, b, c } = await oldDevice();
    const snap = (await takeSnapshot(db, 'ann@corp.test'))!;
    expect(snap.fromEmail).toBe('ann@corp.test');
    expect(snap.lists.map((l) => l.id)).toEqual([work.id]);
    expect(snap.todos.map((t) => t.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(snap.todos.find((t) => t.id === b.id)).toMatchObject({
      dueAt: T0 + 86_400_000,
      priority: 2,
      remindBefore: 'day',
    });
  });

  it('a device with only an Inbox task still has something to restore', async () => {
    const db = testDb();
    const inbox = await seedInbox(db);
    await createRepo(db, { now: fakeNow() }).createTodo({ listId: inbox.id, title: 'x' });
    const snap = (await takeSnapshot(db, 'ann@corp.test'))!;
    expect(snap.todos).toHaveLength(1);
    expect(snap.lists).toEqual([]);
  });
});

describe('restoreSnapshot', () => {
  async function restore(
    mode: 'append' | 'overwrite',
    prepare?: (f: Awaited<ReturnType<typeof freshAccount>>) => Promise<void>,
  ) {
    const old = await oldDevice();
    const snapshot = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    await prepare?.(fresh);
    await fresh.db.outbox.clear();
    const counts = await fresh.repo.restoreSnapshot(snapshot, mode);
    return { old, snapshot, fresh, counts };
  }

  it('append: brings back lists and tasks with their fields and order', async () => {
    const { old, fresh, counts } = await restore('append');
    expect(counts).toEqual({ lists: 1, todos: 3, notes: 0 });

    const lists = await getLists(fresh.db);
    expect(lists.map((l) => l.name)).toEqual(['Inbox', 'Work']);
    const work = lists.find((l) => l.name === 'Work')!;
    expect(work.id).toBe(old.work.id); // same id: restoring twice merges
    expect(work.isPublic).toBe(true);

    const open = await getOpenTodos(fresh.db, work.id);
    expect(open.map((t) => t.title)).toEqual(['Due task']);
    expect(open[0]).toMatchObject({
      dueAt: T0 + 86_400_000,
      priority: 2,
      remindBefore: 'day',
      orderKey: old.b.orderKey,
    });
    expect((await getDoneTodos(fresh.db, work.id)).map((t) => t.title)).toEqual(['Done task']);
  });

  it('append: tasks of the old Inbox go to the new Inbox', async () => {
    const { old, fresh } = await restore('append');
    expect(old.inbox.id).not.toBe(fresh.inbox.id);
    expect((await getOpenTodos(fresh.db, fresh.inbox.id)).map((t) => t.title)).toEqual([
      'Inbox task',
    ]);
    expect(await fresh.db.lists.get(old.inbox.id)).toBeUndefined(); // old Inbox not recreated
  });

  it('keeps what the account already has when appending', async () => {
    const { fresh } = await restore('append', async (f) => {
      await f.repo.createTodo({ listId: f.inbox.id, title: 'Already on server' });
    });
    expect((await getOpenTodos(fresh.db, fresh.inbox.id)).map((t) => t.title).sort()).toEqual([
      'Already on server',
      'Inbox task',
    ]);
  });

  it('queues every change as a valid operation, lists before their tasks', async () => {
    const { fresh } = await restore('append');
    await expectValidOutbox(fresh.db);
    const ops = await fresh.db.outbox.orderBy('hlc').toArray(); // the order they are sent in
    expect(ops.length).toBeGreaterThan(0);
    const firstTodo = ops.findIndex((o) => o.entity === 'todo');
    const lastList = ops.map((o) => o.entity).lastIndexOf('list');
    expect(lastList).toBeLessThan(firstTodo);
    expect(ops.every((o) => o.type === 'create')).toBe(true);
  });

  it("overwrite: deletes the account's tasks and lists first, but never the Inbox", async () => {
    const { fresh } = await restore('overwrite', async (f) => {
      await f.repo.createTodo({ listId: f.inbox.id, title: 'Already on server' });
      await f.repo.createList('Server list');
    });
    const lists = await getLists(fresh.db);
    expect(lists.map((l) => l.name)).toEqual(['Inbox', 'Work']);
    expect((await getOpenTodos(fresh.db, fresh.inbox.id)).map((t) => t.title)).toEqual([
      'Inbox task',
    ]);
    const ops = await fresh.db.outbox.orderBy('hlc').toArray();
    const firstCreate = ops.findIndex((o) => o.type === 'create' && o.entityId !== undefined);
    expect(ops.some((o) => o.type === 'delete')).toBe(true);
    expect(ops[0]!.type).toBe('delete');
    expect(firstCreate).toBeGreaterThanOrEqual(0);
  });

  it('restoring the same snapshot twice does not duplicate anything', async () => {
    const { snapshot, fresh } = await restore('append');
    await fresh.repo.restoreSnapshot(snapshot, 'append');
    expect((await getLists(fresh.db)).map((l) => l.name)).toEqual(['Inbox', 'Work']);
    const all = (await fresh.db.todos.toArray()).filter((t) => t.deletedAt === null);
    expect(all).toHaveLength(3);
  });
});

describe('clearAll(keep)', () => {
  it('clears everything except the rows to keep', async () => {
    const db = testDb();
    await seedInbox(db);
    await db.setMeta('user', { id: 'x' });
    await db.clearAll([{ key: 'recoverySnapshot', value: { hello: 1 } }]);
    expect(await db.lists.count()).toBe(0);
    expect(await db.getMeta('user')).toBeUndefined();
    expect(await db.getMeta('recoverySnapshot')).toEqual({ hello: 1 });
  });
});

export type { RecoverySnapshot };
