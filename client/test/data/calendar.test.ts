/** Calendars and events in the local database (docs/calendar/PRD.md). */
import { describe, expect, it } from 'vitest';
import { addDays, formatHlc, localDay, newId } from '@todoness/shared';
import { applyChanges } from '../../src/sync/apply-changes';
import { RepoError } from '../../src/data/repo';
import { getCalendars, getDueTasks, getEventById, getEventsInRange } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, seedInbox, T0, testRepo } from '../helpers/db';

const TODAY = localDay(T0);

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const work = await t.repo.createCalendar('Work');
  now.advance(10);
  const home = await t.repo.createCalendar('Home', 'green');
  const event = (title: string, start: string, more: object = {}) => {
    now.advance(10);
    return t.repo.createEvent({ calendarId: work.id, title, start, ...more });
  };
  return { ...t, now, work, home, event };
}

describe('calendars – repo', () => {
  it('creates calendars at the end with a colour (blue by default) and queues valid creates', async () => {
    const s = await setup();
    expect(s.work.color).toBe('blue');
    expect(s.home.color).toBe('green');
    expect((await getCalendars(s.db)).map((c) => c.name)).toEqual(['Work', 'Home']);
    const ops = await expectValidOutbox(s.db);
    expect(ops.map((o) => [o.entity, o.type])).toEqual([
      ['calendar', 'create'],
      ['calendar', 'create'],
    ]);
  });

  it('refuses a blank name and trims the rest', async () => {
    const s = await setup();
    await expect(s.repo.createCalendar('   ')).rejects.toBeInstanceOf(RepoError);
    s.now.advance(10);
    expect((await s.repo.createCalendar('  Gym ')).name).toBe('Gym');
  });

  it('renames, recolours and reorders', async () => {
    const s = await setup();
    await s.repo.renameCalendar(s.work.id, 'Job');
    await s.repo.recolorCalendar(s.work.id, 'red');
    await s.repo.reorderCalendar(s.home.id, s.work.id); // Home before Job
    const all = await getCalendars(s.db);
    expect(all.map((c) => [c.name, c.color])).toEqual([
      ['Home', 'green'],
      ['Job', 'red'],
    ]);
    await expectValidOutbox(s.db);
  });

  it('deleting a calendar deletes its events first, then the calendar; other calendars stay', async () => {
    const s = await setup();
    const mine = await s.event('Review', TODAY);
    const other = await s.repo.createEvent({ calendarId: s.home.id, title: 'Yoga', start: TODAY });
    const before = await s.db.outbox.count();
    await s.repo.deleteCalendar(s.work.id);
    // The outbox is sent in clock order (the key of an operation id does not tell it).
    const ops = (await expectValidOutbox(s.db))
      .filter((o) => o.entity !== 'calendar' || o.type === 'delete')
      .sort((a, b) => a.hlc.localeCompare(b.hlc))
      .slice(-2);
    void before;
    expect(ops.map((o) => [o.entity, o.type, o.entityId])).toEqual([
      ['event', 'delete', mine.id],
      ['calendar', 'delete', s.work.id],
    ]);
    expect((await getCalendars(s.db)).map((c) => c.name)).toEqual(['Home']);
    expect(await getEventById(s.db, mine.id)).toBeUndefined();
    expect(await getEventById(s.db, other.id)).toBeDefined();
  });
});

describe('events – repo', () => {
  it('creates an all-day event by default', async () => {
    const s = await setup();
    const e = await s.event('Birthday', TODAY);
    expect(e).toMatchObject({
      days: 1,
      startTime: null,
      endTime: null,
      place: '',
      deletedAt: null,
    });
    expect(await getEventById(s.db, e.id)).toMatchObject({ title: 'Birthday' });
    await expectValidOutbox(s.db);
  });

  it('keeps times, and a timed event is always one day', async () => {
    const s = await setup();
    const e = await s.event('Dentist', TODAY, {
      startTime: '09:30',
      endTime: '10:15',
      days: 4,
      place: ' Clinic ',
    });
    expect(e).toMatchObject({ startTime: '09:30', endTime: '10:15', days: 1, place: 'Clinic' });
  });

  it('an end time without a start time is dropped', async () => {
    const s = await setup();
    const e = await s.event('Odd', TODAY, { endTime: '10:00' });
    expect(e).toMatchObject({ startTime: null, endTime: null });
  });

  it('refuses a blank title, a bad time and an unknown calendar', async () => {
    const s = await setup();
    await expect(s.event('  ', TODAY)).rejects.toBeInstanceOf(RepoError);
    await expect(s.event('X', TODAY, { startTime: '9:30' })).rejects.toBeInstanceOf(RepoError);
    await expect(s.event('X', '2026-02-30')).rejects.toBeInstanceOf(RepoError);
    await expect(
      s.repo.createEvent({ calendarId: newId(), title: 'X', start: TODAY }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await s.repo.deleteCalendar(s.home.id);
    await expect(
      s.repo.createEvent({ calendarId: s.home.id, title: 'X', start: TODAY }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('updates fields; making it all-day clears the times; moving it between calendars works', async () => {
    const s = await setup();
    const e = await s.event('Dentist', TODAY, { startTime: '09:30', endTime: '10:15' });
    await s.repo.updateEvent(e.id, { title: 'Dentist!', start: addDays(TODAY, 1) });
    expect(await getEventById(s.db, e.id)).toMatchObject({
      title: 'Dentist!',
      start: addDays(TODAY, 1),
    });
    await s.repo.updateEvent(e.id, { calendarId: s.home.id });
    expect((await getEventById(s.db, e.id))!.calendarId).toBe(s.home.id);
    await s.repo.updateEvent(e.id, { startTime: null });
    expect(await getEventById(s.db, e.id)).toMatchObject({ startTime: null, endTime: null });
    await s.repo.updateEvent(e.id, { days: 3 });
    expect((await getEventById(s.db, e.id))!.days).toBe(3);
    await expectValidOutbox(s.db);
  });

  it('delete and restore', async () => {
    const s = await setup();
    const e = await s.event('Gym', TODAY);
    await s.repo.deleteEvent(e.id);
    expect(await getEventById(s.db, e.id)).toBeUndefined();
    await s.repo.restoreEvent(e.id);
    expect(await getEventById(s.db, e.id)).toBeDefined();
    await expectValidOutbox(s.db);
  });
});

describe('calendar queries', () => {
  it('getEventsInRange: starts inside, runs into the range, skips deleted events and deleted calendars', async () => {
    const s = await setup();
    const inside = await s.event('Inside', addDays(TODAY, 2));
    const runsIn = await s.event('Runs in', addDays(TODAY, -2), { days: 4 }); // until TODAY+1
    await s.event('Before', addDays(TODAY, -10));
    await s.event('After', addDays(TODAY, 20));
    const gone = await s.event('Deleted', addDays(TODAY, 1));
    await s.repo.deleteEvent(gone.id);
    const orphan = await s.repo.createEvent({
      calendarId: s.home.id,
      title: 'Orphan',
      start: addDays(TODAY, 1),
    });
    await s.repo.deleteCalendar(s.home.id);

    const got = await getEventsInRange(s.db, TODAY, addDays(TODAY, 6));
    expect(got.map((e) => e.id).sort()).toEqual([inside.id, runsIn.id].sort());
    expect(got.some((e) => e.id === orphan.id)).toBe(false);
  });

  it('getEventsInRange needs the calendar of an event to be here and live', async () => {
    const s = await setup();
    const e = await s.event('Lonely', TODAY);
    await s.db.calendars.delete(s.work.id);
    expect((await getEventsInRange(s.db, TODAY, TODAY)).map((x) => x.id)).not.toContain(e.id);
  });

  it('getDueTasks: open tasks with a due date inside the range, with their list and day', async () => {
    const s = await setup();
    const inbox = await seedInbox(s.db);
    const dueAt = (offsetDays: number) => T0 + offsetDays * 86_400_000;
    const a = await s.repo.createTodo({ listId: inbox.id, title: 'Pay rent', dueAt: dueAt(1) });
    const done = await s.repo.createTodo({ listId: inbox.id, title: 'Done', dueAt: dueAt(1) });
    await s.repo.setDone(done.id, true);
    await s.repo.createTodo({ listId: inbox.id, title: 'No date' });
    await s.repo.createTodo({ listId: inbox.id, title: 'Far', dueAt: dueAt(40) });
    const gone = await s.repo.createTodo({ listId: inbox.id, title: 'Gone', dueAt: dueAt(1) });
    await s.repo.deleteTodo(gone.id);

    const got = await getDueTasks(s.db, TODAY, addDays(TODAY, 6));
    expect(got).toEqual([
      { id: a.id, title: 'Pay rent', listId: inbox.id, listName: 'Inbox', day: localDay(dueAt(1)) },
    ]);
  });
});

describe('pulled calendar changes', () => {
  it('are merged into the local rows', async () => {
    const s = await setup();
    const e = await s.event('Dentist', TODAY);
    const hlc = (n: number) => formatHlc({ wall: T0 + n, counter: 0, clientId: 'zzzz' });
    await applyChanges(
      s.db,
      [
        {
          serverSeq: 1,
          entity: 'event',
          entityId: e.id,
          type: 'update',
          hlc: hlc(5_000_000),
          patch: { title: 'From phone', place: 'Clinic' },
        },
        {
          serverSeq: 2,
          entity: 'calendar',
          entityId: s.work.id,
          type: 'update',
          hlc: hlc(5_000_001),
          patch: { color: 'purple' },
        },
      ],
      2,
    );
    expect(await getEventById(s.db, e.id)).toMatchObject({ title: 'From phone', place: 'Clinic' });
    expect((await getCalendars(s.db)).find((c) => c.id === s.work.id)!.color).toBe('purple');
  });

  it('a change for an event that is not here yet does nothing', async () => {
    const s = await setup();
    const id = newId();
    await applyChanges(
      s.db,
      [
        {
          serverSeq: 1,
          entity: 'event',
          entityId: id,
          type: 'update',
          hlc: formatHlc({ wall: T0 + 9, counter: 0, clientId: 'zzzz' }),
          patch: { title: 'x' },
        },
      ],
      1,
    );
    expect(await getEventById(s.db, id)).toBeUndefined();
  });
});
