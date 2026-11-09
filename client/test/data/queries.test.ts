import { describe, expect, it } from 'vitest';
import {
  countPending,
  getDoneTodos,
  getInbox,
  getLists,
  getOpenTodos,
  getQueuedChanges,
  getTodoById,
} from '../../src/data/queries';
import { createPublicEditor } from '../../src/services/publicEdit';
import { fakeNow, seedInbox, testRepo } from '../helpers/db';

describe('queries', () => {
  it('getLists hides deleted lists and sorts by order', async () => {
    const { db, repo } = testRepo();
    await seedInbox(db);
    const a = await repo.createList('A');
    await repo.createList('B');
    await repo.deleteList(a.id);
    expect((await getLists(db)).map((l) => l.name)).toEqual(['Inbox', 'B']);
  });

  it('getInbox finds the Inbox', async () => {
    const { db } = testRepo();
    expect(await getInbox(db)).toBeUndefined();
    const inbox = await seedInbox(db);
    expect((await getInbox(db))!.id).toBe(inbox.id);
  });

  it('getOpenTodos hides done and deleted todos', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const a = await repo.createTodo({ listId: inbox.id, title: 'a' });
    const b = await repo.createTodo({ listId: inbox.id, title: 'b' });
    await repo.createTodo({ listId: inbox.id, title: 'c' });
    await repo.setDone(a.id, true);
    await repo.deleteTodo(b.id);
    expect((await getOpenTodos(db, inbox.id)).map((t) => t.title)).toEqual(['c']);
  });

  it('getDoneTodos lists finished todos, newest completion first', async () => {
    const now = fakeNow();
    const { db, repo } = testRepo({ now });
    const inbox = await seedInbox(db);
    const a = await repo.createTodo({ listId: inbox.id, title: 'a' });
    const b = await repo.createTodo({ listId: inbox.id, title: 'b' });
    const c = await repo.createTodo({ listId: inbox.id, title: 'c' });
    now.advance(10);
    await repo.setDone(a.id, true);
    now.advance(10);
    await repo.setDone(b.id, true);
    await repo.deleteTodo(c.id);
    expect((await getDoneTodos(db, inbox.id)).map((t) => t.title)).toEqual(['b', 'a']);
  });

  it('getTodoById ignores deleted todos', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const a = await repo.createTodo({ listId: inbox.id, title: 'a' });
    expect((await getTodoById(db, a.id))!.title).toBe('a');
    await repo.deleteTodo(a.id);
    expect(await getTodoById(db, a.id)).toBeUndefined();
  });

  it('countPending counts the outbox', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    expect(await countPending(db)).toBe(0);
    await repo.createTodo({ listId: inbox.id, title: 'a' });
    await repo.createTodo({ listId: inbox.id, title: 'b' });
    expect(await countPending(db)).toBe(2);
  });

  it('getQueuedChanges gives both queues raw, oldest first, for the admin', async () => {
    const now = fakeNow();
    const { db, repo } = testRepo({ now });
    const inbox = await seedInbox(db);
    expect(await getQueuedChanges(db)).toEqual({ outbox: [], publicOutbox: [] });
    await repo.createTodo({ listId: inbox.id, title: 'first' });
    now.advance(1000);
    await repo.createTodo({ listId: inbox.id, title: 'second' });
    const LIST = '0192f0c1-0000-7000-8000-0000000000a1';
    await createPublicEditor({ db, now }).createTodo(LIST, 'shared', 'a5');

    const queued = await getQueuedChanges(db);
    expect(queued.outbox.map((op) => (op.patch as { title?: string }).title)).toEqual([
      'first',
      'second',
    ]);
    // Raw: every field as stored, queue bookkeeping included.
    expect(queued.outbox[0]).toMatchObject({ entity: 'todo', type: 'create', attempts: 0 });
    expect(queued.publicOutbox).toHaveLength(1);
    expect(queued.publicOutbox[0]).toMatchObject({ target: 'list', targetId: LIST });
  });
});
