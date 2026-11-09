import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { compareHlc } from '@todoness/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { RepoError } from '../../src/data/repo';
import { getOpenTodos } from '../../src/data/queries';
import { TodonessDB } from '../../src/data/db';
import type { Todo } from '@todoness/shared';
import { expectValidOutbox, fakeNow, seedInbox, T0, testRepo } from '../helpers/db';

async function setup(titles: string[]) {
  const now = fakeNow();
  const t = testRepo({ now });
  const inbox = await seedInbox(t.db);
  const todos: Todo[] = [];
  for (const title of titles) {
    todos.push(await t.repo.createTodo({ listId: inbox.id, title }));
    now.advance(10);
  }
  const order = async () => (await getOpenTodos(t.db, inbox.id)).map((x) => x.title);
  const byTitle = (title: string) => todos.find((x) => x.title === title)!;
  return { ...t, now, inbox, order, byTitle };
}

describe('reorderTodo (FR-37, FR-38)', () => {
  it('starts with the newest task on top', async () => {
    const s = await setup(['A', 'B', 'C', 'D']);
    expect(await s.order()).toEqual(['D', 'C', 'B', 'A']);
  });

  it('moves a task to the top', async () => {
    const s = await setup(['A', 'B', 'C', 'D']);
    await s.repo.reorderTodo(s.byTitle('A').id, s.byTitle('D').id);
    expect(await s.order()).toEqual(['A', 'D', 'C', 'B']);
  });

  it('moves a task into the middle', async () => {
    const s = await setup(['A', 'B', 'C', 'D']); // D C B A
    await s.repo.reorderTodo(s.byTitle('D').id, s.byTitle('B').id);
    expect(await s.order()).toEqual(['C', 'D', 'B', 'A']);
  });

  it('moves a task to the end with `null`', async () => {
    const s = await setup(['A', 'B', 'C', 'D']);
    await s.repo.reorderTodo(s.byTitle('D').id, null);
    expect(await s.order()).toEqual(['C', 'B', 'A', 'D']);
  });

  it('queues exactly one valid update that only touches orderKey', async () => {
    const s = await setup(['A', 'B', 'C']);
    const before = (await s.db.outbox.count()) as number;
    const moved = await s.repo.reorderTodo(s.byTitle('A').id, s.byTitle('C').id);
    const ops = await expectValidOutbox(s.db);
    expect(ops).toHaveLength(before + 1);
    expect(ops.at(-1)).toMatchObject({
      entity: 'todo',
      type: 'update',
      entityId: moved.id,
      patch: { orderKey: moved.orderKey },
    });
  });

  it('does nothing when the position does not change', async () => {
    const s = await setup(['A', 'B', 'C']); // C B A
    const before = await s.db.outbox.count();
    const b = s.byTitle('B');
    await s.repo.reorderTodo(b.id, b.id); // before itself
    await s.repo.reorderTodo(b.id, s.byTitle('A').id); // already right before A
    await s.repo.reorderTodo(s.byTitle('A').id, null); // already last
    expect(await s.db.outbox.count()).toBe(before);
    expect(await s.order()).toEqual(['C', 'B', 'A']);
  });

  it('ignores completed tasks when choosing the position', async () => {
    const s = await setup(['A', 'B', 'C', 'D']); // D C B A
    await s.repo.setDone(s.byTitle('C').id, true);
    await s.repo.reorderTodo(s.byTitle('A').id, s.byTitle('B').id);
    expect(await s.order()).toEqual(['D', 'A', 'B']);
  });

  it('survives two tasks with the same key (created on two devices)', async () => {
    const s = await setup(['A', 'B', 'C']);
    const a = s.byTitle('A');
    const b = s.byTitle('B');
    const key = generateKeyBetween(null, null);
    await s.db.todos.update(a.id, { orderKey: key });
    await s.db.todos.update(b.id, { orderKey: key });
    const moved = await s.repo.reorderTodo(s.byTitle('C').id, b.id);
    expect(moved.orderKey >= key).toBe(true);
    expect(await s.order()).toHaveLength(3);
  });

  it('refuses unknown or deleted tasks and unknown targets', async () => {
    const s = await setup(['A', 'B']);
    const a = s.byTitle('A');
    await expect(s.repo.reorderTodo('nope', null)).rejects.toMatchObject({ code: 'not_found' });
    await expect(s.repo.reorderTodo(a.id, 'nope')).rejects.toBeInstanceOf(RepoError);
    await s.repo.deleteTodo(a.id);
    await expect(s.repo.reorderTodo(a.id, null)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('moveTodo to another list by drag (FR-39)', () => {
  it('puts the task on top of the other list', async () => {
    const s = await setup(['A', 'B']);
    const work = await s.repo.createList('Work');
    const old = await s.repo.createTodo({ listId: work.id, title: 'Existing' });
    const moved = await s.repo.moveTodo(s.byTitle('A').id, work.id);
    expect(moved.listId).toBe(work.id);
    const top = await getOpenTodos(s.db, work.id);
    expect(top.map((x) => x.title)).toEqual(['A', old.title]);
  });
});

describe('setListPublic (FR-32)', () => {
  it('switches a list public and back, one update each', async () => {
    const t = testRepo();
    await seedInbox(t.db);
    const list = await t.repo.createList('Recipes');
    expect(list.isPublic).toBe(false);

    const on = await t.repo.setListPublic(list.id, true);
    expect(on.isPublic).toBe(true);
    const off = await t.repo.setListPublic(list.id, false);
    expect(off.isPublic).toBe(false);

    const ops = (await expectValidOutbox(t.db)).sort((a, b) => compareHlc(a.hlc, b.hlc));
    expect(ops.filter((o) => 'isPublic' in o.patch).map((o) => o.patch)).toEqual([
      { isPublic: true },
      { isPublic: false },
    ]);
  });

  it('does nothing when the value is unchanged', async () => {
    const t = testRepo();
    await seedInbox(t.db);
    const list = await t.repo.createList('Recipes');
    const before = await t.db.outbox.count();
    await t.repo.setListPublic(list.id, false);
    expect(await t.db.outbox.count()).toBe(before);
  });

  it('refuses a missing or deleted list', async () => {
    const t = testRepo();
    await seedInbox(t.db);
    await expect(t.repo.setListPublic('nope', true)).rejects.toMatchObject({ code: 'not_found' });
    const list = await t.repo.createList('Gone');
    await t.repo.deleteList(list.id);
    await expect(t.repo.setListPublic(list.id, true)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('reminder field (FR-42)', () => {
  it('a new task has no reminder; updateTodo sets and clears it', async () => {
    const s = await setup(['A']);
    const a = s.byTitle('A');
    expect(a.remindBefore).toBeNull();
    const withDue = await s.repo.updateTodo(a.id, { dueAt: T0 + 86_400_000, remindBefore: 'day' });
    expect(withDue).toMatchObject({ remindBefore: 'day' });
    expect(await s.repo.updateTodo(a.id, { remindBefore: null })).toMatchObject({
      remindBefore: null,
    });
    await expectValidOutbox(s.db);
  });

  it('rejects an unknown reminder value', async () => {
    const s = await setup(['A']);
    await expect(
      s.repo.updateTodo(s.byTitle('A').id, { remindBefore: 'month' as never }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('local database version 2', () => {
  it('upgrades a version-1 database, keeping the data and filling the new fields', async () => {
    const name = `upgrade-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(1).stores({
      lists: 'id, orderKey',
      todos: 'id, listId, [listId+orderKey]',
      outbox: 'opId, hlc, entityId',
      deadLetter: 'opId, failedAt',
      meta: 'key',
    });
    await old.table('lists').put({
      id: 'l1',
      name: 'Inbox',
      isInbox: true,
      orderKey: 'a0',
      fieldHlc: {},
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    await old.table('todos').put({
      id: 't1',
      listId: 'l1',
      title: 'Old',
      notes: '',
      done: false,
      completedAt: null,
      dueAt: null,
      priority: 0,
      orderKey: 'a0',
      fieldHlc: {},
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    old.close();

    const db = new TodonessDB(name);
    expect(await db.lists.get('l1')).toMatchObject({ name: 'Inbox', isPublic: false });
    expect(await db.todos.get('t1')).toMatchObject({ title: 'Old', remindBefore: null });
    expect(await db.notified.count()).toBe(0);
    db.close();
  });

  it('clearAll also empties the reminder memory', async () => {
    const t = testRepo();
    await t.db.notified.put({ key: 'x', at: 1 });
    await t.db.clearAll();
    expect(await t.db.notified.count()).toBe(0);
  });
});
