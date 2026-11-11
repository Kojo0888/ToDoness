import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { TodonessDB } from '../../src/data/db';

describe('local database version 5 (several reminders, docs/ui-refresh)', () => {
  it('turns a stored single reminder into a list', async () => {
    const name = `upgrade5-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(4).stores({
      lists: 'id, orderKey',
      todos: 'id, listId, [listId+orderKey]',
      notes: 'id, orderKey',
      outbox: 'opId, hlc, entityId',
      deadLetter: 'opId, failedAt',
      meta: 'key',
      notified: 'key',
      publicOutbox: 'opId, hlc, targetId',
      publicCache: 'key',
    });
    await old.table('todos').bulkPut([
      { id: 't1', listId: 'l', orderKey: 'a0', remindBefore: 'day' },
      { id: 't2', listId: 'l', orderKey: 'a1', remindBefore: null },
    ]);
    old.close();
    const db = new TodonessDB(name);
    expect((await db.todos.get('t1'))?.remindBefore).toEqual(['day']);
    expect((await db.todos.get('t2'))?.remindBefore).toEqual([]);
    db.close();
  });
});
