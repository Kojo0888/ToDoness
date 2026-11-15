/** Calendars and events in the recovery after a server loss (docs/calendar/PRD.md FR-216). */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { takeSnapshot } from '../../src/data/recovery';
import { createRepo } from '../../src/data/repo';
import { getCalendars, getEventById, getEventsInRange } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, seedInbox, testDb, T0 } from '../helpers/db';

async function oldDevice() {
  const db = testDb();
  const now = fakeNow();
  const repo = createRepo(db, { now });
  await seedInbox(db);
  const work = await repo.createCalendar('Work', 'red');
  const kept = await repo.createEvent({
    calendarId: work.id,
    title: 'Review',
    start: '2026-11-17',
    startTime: '14:00',
    endTime: '15:00',
    place: 'Room 4',
  });
  const dropped = await repo.createEvent({
    calendarId: work.id,
    title: 'Dropped',
    start: '2026-11-17',
  });
  await repo.deleteEvent(dropped.id);
  const gone = await repo.createCalendar('Gone');
  await repo.createEvent({ calendarId: gone.id, title: 'Orphan', start: '2026-11-17' });
  await repo.deleteCalendar(gone.id);
  await db.outbox.clear();
  return { db, repo, work, kept };
}

async function freshAccount() {
  const db = testDb();
  const repo = createRepo(db, { now: fakeNow(T0 + 1000) });
  await seedInbox(db, newId(T0 + 5_000));
  return { db, repo };
}

describe('takeSnapshot with calendars', () => {
  it('keeps live calendars and the live events of live calendars; a device with only a calendar has something to restore', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    expect(snap.calendars!.map((c) => c.name)).toEqual(['Work']);
    expect(snap.events!.map((e) => e.title)).toEqual(['Review']);
    expect(snap.todos).toEqual([]);
  });
});

describe('restoreSnapshot with calendars', () => {
  it('append: brings calendars and events back with their ids, colours and times', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    const mine = await fresh.repo.createCalendar('Already here');

    const counts = await fresh.repo.restoreSnapshot(snap, 'append');
    expect(counts).toMatchObject({ calendars: 1 });
    expect((await getCalendars(fresh.db)).map((c) => c.id).sort()).toEqual(
      [mine.id, old.work.id].sort(),
    );
    expect(await getEventById(fresh.db, old.kept.id)).toMatchObject({
      title: 'Review',
      calendarId: old.work.id,
      startTime: '14:00',
      endTime: '15:00',
      place: 'Room 4',
    });
    expect((await getCalendars(fresh.db)).find((c) => c.id === old.work.id)!.color).toBe('red');
    await expectValidOutbox(fresh.db);
  });

  it('doing it twice merges instead of doubling', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    await fresh.repo.restoreSnapshot(snap, 'append');
    await fresh.repo.restoreSnapshot(snap, 'append');
    expect(await getCalendars(fresh.db)).toHaveLength(1);
    expect(await getEventsInRange(fresh.db, '2026-11-17', '2026-11-17')).toHaveLength(1);
  });

  it('overwrite: deletes the live calendars of this account first', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    const mine = await fresh.repo.createCalendar('Already here');
    await fresh.repo.createEvent({ calendarId: mine.id, title: 'Mine', start: '2026-11-17' });

    await fresh.repo.restoreSnapshot(snap, 'overwrite');
    expect((await getCalendars(fresh.db)).map((c) => c.name)).toEqual(['Work']);
    expect(
      (await getEventsInRange(fresh.db, '2026-11-17', '2026-11-17')).map((e) => e.title),
    ).toEqual(['Review']);
  });

  it('a snapshot kept before calendars existed restores without them', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    delete snap.calendars;
    delete snap.events;
    const fresh = await freshAccount();
    await expect(fresh.repo.restoreSnapshot(snap, 'append')).resolves.toMatchObject({
      calendars: 0,
    });
  });
});
