import { describe, expect, it } from 'vitest';
import { compareHlc, hlcWall, parseHlc } from '@todoness/shared';
import { createRepo, RepoError } from '../../src/data/repo';
import { getOpenTodos, getLists } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, seedInbox, T0, testDb, testRepo } from '../helpers/db';

const sortedOutbox = async (db: ReturnType<typeof testDb>) =>
  (await db.outbox.toArray()).sort((a, b) => compareHlc(a.hlc, b.hlc));

describe('createTodo', () => {
  it('stores the todo with defaults and queues a create operation', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'Buy milk' });

    expect(todo).toMatchObject({
      listId: inbox.id,
      title: 'Buy milk',
      notes: '',
      done: false,
      completedAt: null,
      dueAt: null,
      priority: 0,
      deletedAt: null,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(await db.todos.get(todo.id)).toEqual(todo);

    const [op, ...rest] = await expectValidOutbox(db);
    expect(rest).toEqual([]);
    expect(op).toMatchObject({
      entity: 'todo',
      type: 'create',
      entityId: todo.id,
      patch: { listId: inbox.id, title: 'Buy milk', orderKey: todo.orderKey },
      attempts: 0,
      createdAt: T0,
    });
    expect(todo.fieldHlc.title).toBe(op!.hlc);
  });

  it('keeps optional fields and trims the title', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const todo = await repo.createTodo({
      listId: inbox.id,
      title: '  Pay rent  ',
      notes: 'before the 10th',
      dueAt: T0 + 86_400_000,
      priority: 3,
    });
    expect(todo).toMatchObject({
      title: 'Pay rent',
      notes: 'before the 10th',
      dueAt: T0 + 86_400_000,
      priority: 3,
    });
  });

  it('puts each new todo above the existing ones (FR-2)', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    await repo.createTodo({ listId: inbox.id, title: 'first' });
    await repo.createTodo({ listId: inbox.id, title: 'second' });
    await repo.createTodo({ listId: inbox.id, title: 'third' });
    const titles = (await getOpenTodos(db, inbox.id)).map((t) => t.title);
    expect(titles).toEqual(['third', 'second', 'first']);
  });

  it('keeps order independent between lists', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const work = await repo.createList('Work');
    await repo.createTodo({ listId: inbox.id, title: 'a' });
    await repo.createTodo({ listId: work.id, title: 'b' });
    expect((await getOpenTodos(db, inbox.id)).map((t) => t.title)).toEqual(['a']);
    expect((await getOpenTodos(db, work.id)).map((t) => t.title)).toEqual(['b']);
  });

  it('rejects an empty or too long title without changing anything', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    for (const title of ['', '   ', 'x'.repeat(501)]) {
      await expect(repo.createTodo({ listId: inbox.id, title })).rejects.toMatchObject({
        name: 'RepoError',
        code: 'invalid',
      });
    }
    expect(await db.todos.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('rejects an unknown list', async () => {
    const { db, repo } = testRepo();
    await expect(
      repo.createTodo({ listId: '0192f0c1-0000-7000-8000-000000000000', title: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('updateTodo / setDone', () => {
  it('changes only the given fields and queues only those fields', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'Old', priority: 1 });
    await db.outbox.clear();

    const updated = await repo.updateTodo(todo.id, { title: 'New', dueAt: T0 + 5 });
    expect(updated).toMatchObject({ title: 'New', dueAt: T0 + 5, priority: 1 });
    const [op] = await expectValidOutbox(db);
    expect(op).toMatchObject({
      type: 'update',
      entityId: todo.id,
      patch: { title: 'New', dueAt: T0 + 5 },
    });
    // Only the changed fields get a new clock; untouched fields keep theirs.
    expect(updated.fieldHlc.priority).toBe(todo.fieldHlc.priority);
    expect(updated.fieldHlc.title).toBe(op!.hlc);
    expect(updated.fieldHlc.title).not.toBe(todo.fieldHlc.title);
  });

  it('refuses an empty change, an unknown id and bad values', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'x' });
    await db.outbox.clear();
    await expect(repo.updateTodo(todo.id, {})).rejects.toMatchObject({ code: 'invalid' });
    await expect(repo.updateTodo(todo.id, { priority: 9 as 3 })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(
      repo.updateTodo('0192f0c1-0000-7000-8000-000000000000', { title: 'x' }),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await db.outbox.count()).toBe(0);
  });

  it('marks done with the completion time and back again', async () => {
    const now = fakeNow();
    const { db, repo } = testRepo({ now });
    const inbox = await seedInbox(db);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'x' });

    now.advance(1000);
    const done = await repo.setDone(todo.id, true);
    expect(done).toMatchObject({ done: true, completedAt: T0 + 1000 });

    now.advance(1000);
    const open = await repo.setDone(todo.id, false);
    expect(open).toMatchObject({ done: false, completedAt: null });

    const ops = await sortedOutbox(db);
    expect(ops.map((o) => o.patch)).toEqual([
      expect.objectContaining({ title: 'x' }),
      { done: true, completedAt: T0 + 1000 },
      { done: false, completedAt: null },
    ]);
  });

  it('does nothing when the todo is already in that state', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'x' });
    const before = await db.outbox.count();
    await repo.setDone(todo.id, false);
    expect(await db.outbox.count()).toBe(before);
  });

  it('moves finished todos out of the open list', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const a = await repo.createTodo({ listId: inbox.id, title: 'a' });
    await repo.createTodo({ listId: inbox.id, title: 'b' });
    await repo.setDone(a.id, true);
    expect((await getOpenTodos(db, inbox.id)).map((t) => t.title)).toEqual(['b']);
  });
});

describe('deleteTodo / restoreTodo (undo)', () => {
  it('deletes with a marker, hides it, and queues a delete', async () => {
    const now = fakeNow();
    const { db, repo } = testRepo({ now });
    const inbox = await seedInbox(db);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'x' });
    now.advance(500);
    await repo.deleteTodo(todo.id);

    const row = await db.todos.get(todo.id);
    expect(row!.deletedAt).toBe(T0 + 500);
    expect(await getOpenTodos(db, inbox.id)).toEqual([]);
    const ops = await sortedOutbox(db);
    expect(ops.at(-1)).toMatchObject({ type: 'delete', entityId: todo.id, patch: {} });
  });

  it('restore brings it back in its old position', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const a = await repo.createTodo({ listId: inbox.id, title: 'a' });
    await repo.createTodo({ listId: inbox.id, title: 'b' });
    await repo.deleteTodo(a.id);
    await repo.restoreTodo(a.id);
    expect((await getOpenTodos(db, inbox.id)).map((t) => t.title)).toEqual(['b', 'a']);
    const ops = await sortedOutbox(db);
    expect(ops.at(-1)).toMatchObject({ type: 'restore', entityId: a.id });
    expect((await db.todos.get(a.id))!.deletedAt).toBeNull();
  });

  it('fails clearly for an unknown todo', async () => {
    const { repo } = testRepo();
    await expect(repo.deleteTodo('0192f0c1-0000-7000-8000-000000000000')).rejects.toBeInstanceOf(
      RepoError,
    );
  });
});

describe('moveTodo', () => {
  it('moves to the top of another list in one operation', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const work = await repo.createList('Work');
    await repo.createTodo({ listId: work.id, title: 'already there' });
    const todo = await repo.createTodo({ listId: inbox.id, title: 'moving' });
    await db.outbox.clear();

    const moved = await repo.moveTodo(todo.id, work.id);
    expect(moved.listId).toBe(work.id);
    expect((await getOpenTodos(db, work.id)).map((t) => t.title)).toEqual([
      'moving',
      'already there',
    ]);
    expect(await getOpenTodos(db, inbox.id)).toEqual([]);

    const ops = await expectValidOutbox(db);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: 'update',
      patch: { listId: work.id, orderKey: moved.orderKey },
    });
  });

  it('rejects an unknown or deleted target list', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const gone = await repo.createList('Gone');
    await repo.deleteList(gone.id);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'x' });
    await expect(repo.moveTodo(todo.id, gone.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      repo.moveTodo(todo.id, '0192f0c1-0000-7000-8000-000000000000'),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('lists', () => {
  it('creates lists at the end, trimmed', async () => {
    const { db, repo } = testRepo();
    await seedInbox(db);
    await repo.createList('  Work  ');
    await repo.createList('Home');
    expect((await getLists(db)).map((l) => l.name)).toEqual(['Inbox', 'Work', 'Home']);
    const [create] = (await sortedOutbox(db)).slice(0, 1);
    expect(create).toMatchObject({ entity: 'list', type: 'create', patch: { name: 'Work' } });
  });

  it('renames a list', async () => {
    const { db, repo } = testRepo();
    const work = await repo.createList('Work');
    await db.outbox.clear();
    const renamed = await repo.renameList(work.id, 'Job');
    expect(renamed.name).toBe('Job');
    expect((await expectValidOutbox(db))[0]).toMatchObject({
      type: 'update',
      patch: { name: 'Job' },
    });
  });

  it('rejects empty names', async () => {
    const { repo } = testRepo();
    await expect(repo.createList('  ')).rejects.toMatchObject({ code: 'invalid' });
    const work = await repo.createList('Work');
    await expect(repo.renameList(work.id, '')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('protects the Inbox from rename and delete (FR-8)', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    await expect(repo.renameList(inbox.id, 'Mine')).rejects.toMatchObject({
      code: 'inbox_protected',
    });
    await expect(repo.deleteList(inbox.id)).rejects.toMatchObject({ code: 'inbox_protected' });
    expect(await db.outbox.count()).toBe(0);
    expect((await db.lists.get(inbox.id))!.deletedAt).toBeNull();
  });

  it('deleting a list deletes its todos too (FR-10)', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const work = await repo.createList('Work');
    const a = await repo.createTodo({ listId: work.id, title: 'a' });
    const b = await repo.createTodo({ listId: work.id, title: 'b' });
    const keep = await repo.createTodo({ listId: inbox.id, title: 'keep' });
    await repo.deleteTodo(b.id); // already deleted: must not be deleted twice
    await db.outbox.clear();

    await repo.deleteList(work.id);

    expect((await db.lists.get(work.id))!.deletedAt).not.toBeNull();
    expect((await db.todos.get(a.id))!.deletedAt).not.toBeNull();
    expect((await db.todos.get(keep.id))!.deletedAt).toBeNull();
    const ops = await sortedOutbox(db);
    expect(ops.map((o) => `${o.entity}:${o.type}:${o.entityId}`)).toEqual([
      `todo:delete:${a.id}`,
      `list:delete:${work.id}`,
    ]);
    expect((await getLists(db)).map((l) => l.name)).toEqual(['Inbox']);
  });
});

describe('moveList (reordering lists, FR-9)', () => {
  async function fourLists() {
    const ctx = testRepo();
    await seedInbox(ctx.db);
    const a = await ctx.repo.createList('A');
    const b = await ctx.repo.createList('B');
    const c = await ctx.repo.createList('C');
    await ctx.db.outbox.clear();
    return { ...ctx, a, b, c };
  }
  const names = async (db: ReturnType<typeof testDb>) => (await getLists(db)).map((l) => l.name);

  it('moves a list down and up by one place with a single operation', async () => {
    const { db, repo, a, c } = await fourLists();
    await repo.moveList(a.id, 'down');
    expect(await names(db)).toEqual(['Inbox', 'B', 'A', 'C']);
    const ops = await expectValidOutbox(db);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'list', type: 'update', entityId: a.id });
    expect(Object.keys(ops[0]!.patch)).toEqual(['orderKey']);

    await repo.moveList(c.id, 'up');
    expect(await names(db)).toEqual(['Inbox', 'B', 'C', 'A']);
  });

  it('does nothing at the ends, and never moves above the Inbox', async () => {
    const { db, repo, a, c } = await fourLists();
    await repo.moveList(a.id, 'up'); // A is right below the Inbox
    await repo.moveList(c.id, 'down'); // C is last
    expect(await names(db)).toEqual(['Inbox', 'A', 'B', 'C']);
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps the Inbox in place', async () => {
    const { db, repo } = await fourLists();
    const inbox = (await getLists(db))[0]!;
    await expect(repo.moveList(inbox.id, 'down')).rejects.toMatchObject({
      code: 'inbox_protected',
    });
  });

  it('ignores deleted lists when counting places', async () => {
    const { db, repo, a, b, c } = await fourLists();
    await repo.deleteList(b.id);
    await repo.moveList(a.id, 'down'); // jumps over the deleted B
    expect(await names(db)).toEqual(['Inbox', 'C', 'A']);
    await repo.moveList(c.id, 'down');
    expect(await names(db)).toEqual(['Inbox', 'A', 'C']);
  });

  it('survives many moves with valid, strictly ordered keys', async () => {
    const { db, repo, a } = await fourLists();
    for (let i = 0; i < 30; i++) {
      await repo.moveList(a.id, 'down');
      await repo.moveList(a.id, 'up');
    }
    expect(await names(db)).toEqual(['Inbox', 'A', 'B', 'C']);
    const keys = (await getLists(db)).map((l) => l.orderKey);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(4);
    await expectValidOutbox(db);
  });

  it('copes with two lists that got the same key on different devices', async () => {
    const { db, repo, a, b } = await fourLists();
    await db.lists.update(b.id, { orderKey: a.orderKey }); // simulate the clash
    await expect(repo.moveList(a.id, 'down')).resolves.toBeDefined();
    expect((await getLists(db)).map((l) => l.name).sort()).toEqual(['A', 'B', 'C', 'Inbox']);
  });

  it('rejects an unknown list', async () => {
    const { repo } = await fourLists();
    await expect(repo.moveList('0192f0c1-0000-7000-8000-000000000000', 'up')).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
  });
});

describe('clock and ids', () => {
  it('gives every operation a strictly newer HLC, even in the same millisecond', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    for (let i = 0; i < 20; i++) await repo.createTodo({ listId: inbox.id, title: `t${i}` });
    const hlcs = (await sortedOutbox(db)).map((o) => o.hlc);
    for (let i = 1; i < hlcs.length; i++) expect(compareHlc(hlcs[i - 1]!, hlcs[i]!)).toBe(-1);
    expect(new Set(hlcs).size).toBe(20);
  });

  it('keeps one client id for the browser and puts it in every HLC', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    await repo.createTodo({ listId: inbox.id, title: 'a' });
    await repo.createTodo({ listId: inbox.id, title: 'b' });
    const clientId = (await db.meta.get('clientId'))!.value as string;
    expect(clientId).toMatch(/^[0-9a-f]{16}$/);
    for (const op of await db.outbox.toArray()) expect(parseHlc(op.hlc).clientId).toBe(clientId);
  });

  it('does not go backwards when the device clock does, also after a restart', async () => {
    const now = fakeNow();
    const db = testDb();
    const inbox = await seedInbox(db);
    const repo1 = createRepo(db, { now });
    await repo1.createTodo({ listId: inbox.id, title: 'a' });
    const before = (await db.meta.get('lastHlc'))!.value as string;

    now.set(T0 - 3_600_000); // the clock jumps back an hour
    const repo2 = createRepo(db, { now }); // e.g. after reloading the page
    await repo2.createTodo({ listId: inbox.id, title: 'b' });
    const after = (await db.meta.get('lastHlc'))!.value as string;

    expect(compareHlc(before, after)).toBe(-1);
    expect(hlcWall(after)).toBeGreaterThanOrEqual(hlcWall(before));
  });

  it('uses ids that sort by creation time', async () => {
    const now = fakeNow();
    const { db, repo } = testRepo({ now });
    const inbox = await seedInbox(db);
    const a = await repo.createTodo({ listId: inbox.id, title: 'a' });
    now.advance(10);
    const b = await repo.createTodo({ listId: inbox.id, title: 'b' });
    expect(a.id < b.id).toBe(true);
  });
});

describe('atomic changes (FR-14)', () => {
  it('rolls back the row if queuing the operation fails', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const todo = await repo.createTodo({ listId: inbox.id, title: 'Before' });
    const outboxBefore = await db.outbox.count();

    db.outbox.add = () => Promise.reject(new Error('disk full')) as never;
    await expect(repo.updateTodo(todo.id, { title: 'After' })).rejects.toThrow('disk full');

    expect((await db.todos.get(todo.id))!.title).toBe('Before');
    expect(await db.outbox.count()).toBe(outboxBefore);
  });

  it('writes every operation the server would accept', async () => {
    const { db, repo } = testRepo();
    const inbox = await seedInbox(db);
    const work = await repo.createList('Work');
    const t = await repo.createTodo({
      listId: inbox.id,
      title: 'x',
      dueAt: T0,
      priority: 2,
      notes: 'n',
    });
    await repo.updateTodo(t.id, { title: 'y', dueAt: null });
    await repo.setDone(t.id, true);
    await repo.moveTodo(t.id, work.id);
    await repo.deleteTodo(t.id);
    await repo.restoreTodo(t.id);
    await repo.renameList(work.id, 'Job');
    await repo.deleteList(work.id);
    const ops = await expectValidOutbox(db);
    expect(ops.length).toBeGreaterThanOrEqual(9);
  });
});
