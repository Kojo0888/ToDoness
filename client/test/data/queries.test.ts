import { describe, expect, it } from 'vitest';
import {
  countPending,
  getDoneTodos,
  getInbox,
  getLists,
  getOpenTodos,
  getTodoById,
} from '../../src/data/queries';
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
});
