import { describe, expect, it } from 'vitest';
import { publicListResponseSchema, publicListsResponseSchema } from '@todoness/shared';
import { Browser, startServer, twoBrowsers, T0 } from './harness';

async function expectConverged(a: Browser, b: Browser) {
  expect(await a.snapshot()).toEqual(await b.snapshot());
}

describe('v1: public lists across users', () => {
  it('a list switched public while offline is visible to another user after syncing', async () => {
    const server = startServer();
    const ann = new Browser(server, 'ann');
    await ann.register('ann@corp.test');
    const bob = new Browser(server, 'bob');
    await bob.register('bob@corp.test');
    const inbox = await ann.inboxId();

    ann.online = false;
    const list = await ann.repo.createList('Recipes');
    await ann.repo.createTodo({ listId: list.id, title: 'Soup' });
    await ann.repo.setListPublic(list.id, true);
    expect(await ann.sync()).toMatchObject({ ok: false, kind: 'offline' });

    // Not on the server yet: bob sees nothing.
    let lists = publicListsResponseSchema.parse(
      await (await bob.fetch('/api/public/lists')).json(),
    ).lists;
    expect(lists).toEqual([]);

    ann.online = true;
    expect(await ann.sync()).toEqual({ ok: true });
    lists = publicListsResponseSchema.parse(
      await (await bob.fetch('/api/public/lists')).json(),
    ).lists;
    expect(lists).toEqual([{ id: list.id, name: 'Recipes', ownerEmail: 'ann@corp.test' }]);

    const page = publicListResponseSchema.parse(
      await (await bob.fetch(`/api/public/lists/${list.id}`)).json(),
    );
    expect(page.todos.map((t) => t.title)).toEqual(['Soup']);

    // Bob's own sync never contains Ann's list.
    await bob.sync();
    expect((await bob.db.lists.toArray()).map((l) => l.name)).toEqual(['Inbox']);
    expect(inbox).not.toBe(await bob.inboxId());

    await ann.repo.setListPublic(list.id, false);
    await ann.sync();
    lists = publicListsResponseSchema.parse(
      await (await bob.fetch('/api/public/lists')).json(),
    ).lists;
    expect(lists).toEqual([]);
  });
});

describe('v1: reordering and moving converge between devices', () => {
  it('a reorder done offline reaches the other device', async () => {
    const { a, b, inbox } = await twoBrowsers();
    for (const title of ['A', 'B', 'C']) await a.repo.createTodo({ listId: inbox, title });
    await a.sync();
    await b.sync();
    expect(await b.titles(inbox)).toEqual(['C', 'B', 'A']);

    a.online = false;
    const [c] = await a.db.todos
      .where('listId')
      .equals(inbox)
      .filter((t) => t.title === 'C')
      .toArray();
    await a.repo.reorderTodo(c!.id, null); // C to the end
    expect(await a.titles(inbox)).toEqual(['B', 'A', 'C']);
    a.online = true;
    await a.sync();
    await b.sync();
    expect(await b.titles(inbox)).toEqual(['B', 'A', 'C']);
    await expectConverged(a, b);
  });

  it('two devices reordering different tasks at once both win', async () => {
    const { a, b, inbox } = await twoBrowsers();
    for (const title of ['A', 'B', 'C', 'D']) await a.repo.createTodo({ listId: inbox, title });
    await a.sync();
    await b.sync(); // D C B A
    const id = async (br: Browser, title: string) =>
      (await br.db.todos.filter((t) => t.title === title).first())!.id;

    a.online = b.online = false;
    await a.repo.reorderTodo(await id(a, 'A'), await id(a, 'D')); // A to the top
    await b.repo.reorderTodo(await id(b, 'D'), null); // D to the end
    a.online = b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();
    expect(await a.titles(inbox)).toEqual(await b.titles(inbox));
    expect((await a.titles(inbox))[0]).toBe('A');
    expect((await a.titles(inbox)).at(-1)).toBe('D');
    await expectConverged(a, b);
  });

  it('a task moved to another list on one device moves on the other', async () => {
    const { a, b, inbox } = await twoBrowsers();
    const work = await a.repo.createList('Work');
    const todo = await a.repo.createTodo({ listId: inbox, title: 'Report' });
    await a.sync();
    await b.sync();
    await a.repo.moveTodo(todo.id, work.id);
    await a.sync();
    await b.sync();
    expect(await b.titles(inbox)).toEqual([]);
    expect(await b.titles(work.id)).toEqual(['Report']);
    await expectConverged(a, b);
  });
});

describe('v1: reminder field merges between devices', () => {
  it('different fields set on two devices are both kept', async () => {
    const { a, b, inbox } = await twoBrowsers();
    const todo = await a.repo.createTodo({ listId: inbox, title: 'Call' });
    await a.sync();
    await b.sync();

    a.online = b.online = false;
    await a.repo.updateTodo(todo.id, { dueAt: T0 + 10 * 86_400_000 });
    await b.repo.updateTodo(todo.id, { remindBefore: 'day' });
    a.online = b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();
    for (const br of [a, b]) {
      expect(await br.db.todos.get(todo.id)).toMatchObject({
        dueAt: T0 + 10 * 86_400_000,
        remindBefore: 'day',
      });
    }
    await expectConverged(a, b);
  });
});
