import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { TodonessDB } from '../../src/data/db';

describe('local database version 10 (Calendar module, docs/calendar)', () => {
  it('keeps the data, adds empty calendar tables and resets the pull cursor (FR-217)', async () => {
    const name = `upgrade10-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(9).stores({
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
    await old.table('plans').put({ id: 'p1', name: 'Launch', orderKey: 'a0' });
    await old.table('meta').bulkPut([
      { key: 'lastServerSeq', value: 42 },
      { key: 'clientId', value: 'abcd' },
      { key: 'initialSyncDone', value: true },
    ]);
    old.close();

    const db = new TodonessDB(name);
    expect(await db.plans.count()).toBe(1);
    expect(await db.calendars.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
    // Calendars the old app skipped are read again from the start.
    expect(await db.getMeta('lastServerSeq')).toBeUndefined();
    expect(await db.getMeta('clientId')).toBe('abcd');
    expect(await db.getMeta('initialSyncDone')).toBe(true);
    db.close();
  });

  it('clearAll (logout, another user) removes calendars and events too', async () => {
    const db = new TodonessDB(`clear-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await db.calendars.put({ id: 'c1' } as never);
    await db.events.put({ id: 'e1', calendarId: 'c1', start: '2026-11-17' } as never);
    await db.clearAll();
    expect(await db.calendars.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
    db.close();
  });
});

describe('local database version 11 (repeats and reminders)', () => {
  it('resets the pull cursor so the new event fields skipped by the server arrive (FR-231)', async () => {
    const name = `upgrade11-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(10).stores({
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
      calendars: 'id, orderKey',
      events: 'id, calendarId, start',
    });
    await old.table('events').put({ id: 'e1', calendarId: 'c1', start: '2026-11-17', title: 'x' });
    await old.table('meta').bulkPut([
      { key: 'lastServerSeq', value: 42 },
      { key: 'clientId', value: 'abcd' },
    ]);
    old.close();

    const db = new TodonessDB(name);
    // Events of before: they never repeat and have no reminders.
    expect(await db.events.get('e1')).toMatchObject({
      repeat: 'none',
      repeatUntil: null,
      reminders: [],
      tz: '',
    });
    expect(await db.getMeta('lastServerSeq')).toBeUndefined();
    expect(await db.getMeta('clientId')).toBe('abcd');
    db.close();
  });
});
