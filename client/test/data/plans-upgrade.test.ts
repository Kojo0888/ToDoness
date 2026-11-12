import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { TodonessDB } from '../../src/data/db';

describe('local database version 6 (Plan module, docs/plan)', () => {
  it('keeps the data, adds empty plan tables and resets the pull cursor (FR-143)', async () => {
    const name = `upgrade6-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(5).stores({
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
    await old.table('todos').put({ id: 't1', listId: 'l', orderKey: 'a0', remindBefore: [] });
    await old.table('notes').put({ id: 'n1', orderKey: 'a0', text: 'x' });
    await old.table('meta').bulkPut([
      { key: 'lastServerSeq', value: 42 },
      { key: 'clientId', value: 'abcd' },
      { key: 'initialSyncDone', value: true },
    ]);
    old.close();

    const db = new TodonessDB(name);
    expect(await db.todos.count()).toBe(1);
    expect(await db.notes.count()).toBe(1);
    expect(await db.plans.count()).toBe(0);
    expect(await db.activities.count()).toBe(0);
    // Plans the old app skipped are read again from the start.
    expect(await db.getMeta('lastServerSeq')).toBeUndefined();
    expect(await db.getMeta('clientId')).toBe('abcd');
    expect(await db.getMeta('initialSyncDone')).toBe(true);
    db.close();
  });
});

describe('local database version 8 (done activities, docs/plan Update 3)', () => {
  it('marks stored activities not done and resets the pull cursor (FR-159)', async () => {
    const name = `upgrade8-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(7).stores({
      lists: 'id, orderKey',
      todos: 'id, listId, [listId+orderKey]',
      notes: 'id, orderKey',
      outbox: 'opId, hlc, entityId',
      deadLetter: 'opId, failedAt',
      meta: 'key',
      notified: 'key',
      publicOutbox: 'opId, hlc, targetId',
      publicCache: 'key',
      plans: 'id, orderKey',
      activities: 'id, planId, [planId+orderKey]',
    });
    await old.table('activities').put({ id: 'a1', planId: 'p1', orderKey: 'a0', name: 'A' });
    await old.table('meta').bulkPut([
      { key: 'lastServerSeq', value: 42 },
      { key: 'clientId', value: 'abcd' },
    ]);
    old.close();

    const db = new TodonessDB(name);
    expect(await db.activities.get('a1')).toMatchObject({ name: 'A', done: false });
    expect(await db.getMeta('lastServerSeq')).toBeUndefined();
    expect(await db.getMeta('clientId')).toBe('abcd');
    db.close();
  });
});
