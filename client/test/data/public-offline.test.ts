/** Public lists and notes offline: cache, queue, overlay (docs/notes/PRD.md FR-106 – FR-111). */
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import {
  formatHlc,
  newId,
  syncOpSchema,
  type PublicListResponse,
  type PublicNote,
} from '@todoness/shared';
import { TodonessDB, type PublicOp } from '../../src/data/db';
import { overlayListPage, overlayNotes } from '../../src/data/publicOverlay';
import { countPending } from '../../src/data/queries';
import { createPublicEditor } from '../../src/services/publicEdit';
import { createPublicNotes } from '../../src/services/publicNotes';
import { createPublicData } from '../../src/services/publicData';
import { fakeNow, T0, testDb } from '../helpers/db';
import { fakeFetch, json } from '../helpers/fetch';

const LIST = '0192f0c1-0000-7000-8000-0000000000a1';
const NOTE = '0192f0c1-0000-7000-8000-0000000000d1';
const hlc = (n: number) => formatHlc({ wall: T0 + n, counter: 0, clientId: 'bbbb' });

const todo = (id: string, title: string, orderKey: string) => ({
  id,
  title,
  notes: '',
  done: false,
  completedAt: null,
  dueAt: null,
  priority: 0,
  orderKey,
  attachments: [],
});

const page = (): PublicListResponse => ({
  list: { id: LIST, name: 'Shared', ownerEmail: 'ann@corp.test' },
  todos: [todo('0192f0c1-0000-7000-8000-0000000000b1', 'Soup', 'a1')],
});

function op(
  entity: 'todo' | 'note',
  type: PublicOp['type'],
  entityId: string,
  patch: Record<string, unknown>,
  at: number,
  targetId = entity === 'todo' ? LIST : NOTE,
): PublicOp {
  return {
    opId: newId(T0 + at),
    entity,
    type,
    entityId,
    patch,
    hlc: hlc(at),
    attempts: 0,
    createdAt: T0,
    target: entity === 'todo' ? 'list' : 'note',
    targetId,
  } as PublicOp;
}

describe('queued public edits', () => {
  it('the list editor queues valid operations with their target and sends nothing', async () => {
    const db = testDb();
    const f = fakeFetch(() => json(500, {}));
    const editor = createPublicEditor({ db, now: fakeNow() });
    expect(await editor.createTodo(LIST, 'Bread', 'a1')).toEqual({ ok: true });
    expect(await editor.setDone(LIST, page().todos[0]!.id, true)).toEqual({ ok: true });
    expect(await editor.updateTodo(LIST, page().todos[0]!.id, { title: '  ' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(f.calls).toHaveLength(0);

    const queued = await db.publicOutbox.orderBy('hlc').toArray();
    expect(queued.map((q) => [q.target, q.targetId, q.entity, q.type])).toEqual([
      ['list', LIST, 'todo', 'create'],
      ['list', LIST, 'todo', 'update'],
    ]);
    for (const { attempts, createdAt, target, targetId, ...wire } of queued) {
      void [attempts, createdAt, target, targetId];
      expect(syncOpSchema.safeParse(wire).success).toBe(true);
    }
    expect(await countPending(db)).toBe(2);
    expect(await db.outbox.count()).toBe(0);
  });

  it('the note editor queues a text update for that note', async () => {
    const db = testDb();
    const notes = createPublicNotes({ db, now: fakeNow() });
    expect(await notes.saveText(NOTE, 'Hello')).toEqual({ ok: true });
    expect(await notes.saveText(NOTE, 'x'.repeat(20_001))).toEqual({ ok: false, error: 'invalid' });
    const [q] = await db.publicOutbox.toArray();
    expect(q).toMatchObject({
      target: 'note',
      targetId: NOTE,
      entity: 'note',
      type: 'update',
      entityId: NOTE,
      patch: { text: 'Hello' },
    });
  });
});

describe('overlayListPage', () => {
  const soup = page().todos[0]!.id;

  it('shows a queued new task at its key, and queued updates of a task', () => {
    const id = newId(T0);
    const result = overlayListPage(page(), [
      op('todo', 'create', id, { listId: LIST, title: 'Bread', orderKey: 'a0' }, 1),
      op('todo', 'update', soup, { done: true, completedAt: T0 }, 2),
      op('todo', 'update', id, { title: 'Bread, edited', priority: 2, listId: LIST }, 3),
    ]);
    expect(result.todos.map((x) => [x.title, x.done, x.priority])).toEqual([
      ['Bread, edited', false, 0 + 2],
      ['Soup', true, 0],
    ]);
    expect(result.todos[0]).toMatchObject({ notes: '', attachments: [], dueAt: null });
  });

  it('hides a deleted task and shows it again after a restore; reorders by key', () => {
    expect(overlayListPage(page(), [op('todo', 'delete', soup, {}, 1)]).todos).toEqual([]);
    const back = overlayListPage(page(), [
      op('todo', 'delete', soup, {}, 1),
      op('todo', 'restore', soup, {}, 2),
      op('todo', 'update', soup, { orderKey: 'Zz' }, 3),
    ]);
    expect(back.todos.map((x) => [x.title, x.orderKey])).toEqual([['Soup', 'Zz']]);
  });

  it('applies operations in clock order and ignores other lists', () => {
    const result = overlayListPage(page(), [
      op('todo', 'update', soup, { title: 'Later' }, 5),
      op('todo', 'update', soup, { title: 'Earlier' }, 1),
      op('todo', 'update', soup, { title: 'Other list' }, 9, newId(T0)),
    ]);
    expect(result.todos[0]!.title).toBe('Later');
  });

  it('does not change the input', () => {
    const p = page();
    overlayListPage(p, [op('todo', 'update', soup, { title: 'x' }, 1)]);
    expect(p).toEqual(page());
  });
});

describe('overlayNotes', () => {
  const notes = (): PublicNote[] => [
    { id: NOTE, text: 'Old', ownerEmail: 'ann@corp.test', updatedAt: T0 - 5 },
    { id: newId(T0), text: 'Other', ownerEmail: 'cy@corp.test', updatedAt: T0 - 9 },
  ];
  it('shows the last queued text and keeps the order', () => {
    const result = overlayNotes(notes(), [
      op('note', 'update', NOTE, { text: 'Newest' }, 5),
      op('note', 'update', NOTE, { text: 'Newer' }, 2),
    ]);
    expect(result.map((n) => n.text)).toEqual(['Newest', 'Other']);
    expect(result[0]!.updatedAt).toBe(T0 + 5);
  });
});

describe('public data cache', () => {
  const lists = [{ id: LIST, name: 'Shared', ownerEmail: 'ann@corp.test' }];
  const notesBody = {
    notes: [{ id: NOTE, text: 'Hi', ownerEmail: 'ann@corp.test', updatedAt: 1 }],
  };

  function setup(answer: (url: string) => Response | 'network-error') {
    const db = testDb();
    const now = fakeNow();
    const f = fakeFetch((call) => answer(call.url));
    return { db, now, f, data: createPublicData({ db, fetch: f, now }) };
  }

  it('keeps what the server answered, with the time', async () => {
    const s = setup((url) =>
      url === '/api/public/lists'
        ? json(200, { lists })
        : url === '/api/public/notes'
          ? json(200, notesBody)
          : json(200, page()),
    );
    expect(await s.data.refreshLists()).toBe(true);
    expect(await s.data.refreshList(LIST)).toBe(true);
    expect(await s.data.refreshNotes()).toBe(true);
    expect(await s.db.publicCache.get('lists')).toEqual({ key: 'lists', value: lists, at: T0 });
    expect((await s.db.publicCache.get(`list:${LIST}`))!.value).toEqual(page());
    expect((await s.db.publicCache.get('notes'))!.value).toEqual(notesBody.notes);
  });

  it('remembers a list that is gone, and keeps the old copy when offline', async () => {
    let answer: Response | 'network-error' = json(200, page());
    const s = setup(() => answer);
    await s.data.refreshList(LIST);
    answer = 'network-error';
    expect(await s.data.refreshList(LIST)).toBe(false);
    expect((await s.db.publicCache.get(`list:${LIST}`))!.value).toEqual(page());
    answer = json(500, {});
    expect(await s.data.refreshList(LIST)).toBe(false);
    answer = json(404, {});
    expect(await s.data.refreshList(LIST)).toBe(true);
    expect((await s.db.publicCache.get(`list:${LIST}`))!.value).toBe('gone');
  });

  it('loads the public lists whose copy is older than allowed', async () => {
    const s = setup((url) =>
      url === '/api/public/lists' ? json(200, { lists }) : json(200, page()),
    );
    await s.data.refreshLists();
    await s.data.prefetchLists(60_000);
    expect(s.f.calls.map((c) => c.url)).toEqual(['/api/public/lists', `/api/public/lists/${LIST}`]);
    s.now.advance(30_000);
    await s.data.prefetchLists(60_000);
    expect(s.f.calls).toHaveLength(2); // still fresh
    s.now.advance(31_000);
    await s.data.prefetchLists(60_000);
    expect(s.f.calls).toHaveLength(3);
  });
});

describe('local database version 4', () => {
  it('upgrades version 3 and keeps the data', async () => {
    const name = `upgrade4-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(3).stores({
      lists: 'id, orderKey',
      todos: 'id, listId, [listId+orderKey]',
      notes: 'id, orderKey',
      outbox: 'opId, hlc, entityId',
      deadLetter: 'opId, failedAt',
      meta: 'key',
      notified: 'key',
    });
    await old.table('notes').put({ id: 'n1', text: 'kept', orderKey: 'a0' });
    old.close();
    const db = new TodonessDB(name);
    expect(await db.notes.get('n1')).toMatchObject({ text: 'kept' });
    expect(await db.publicOutbox.count()).toBe(0);
    expect(await db.publicCache.count()).toBe(0);
    db.close();
  });

  it('clearAll empties the public queue and the cache', async () => {
    const db = testDb();
    await createPublicNotes({ db, now: fakeNow() }).saveText(NOTE, 'x');
    await db.publicCache.put({ key: 'notes', value: [], at: 1 });
    await db.clearAll();
    expect(await db.publicOutbox.count()).toBe(0);
    expect(await db.publicCache.count()).toBe(0);
  });
});
