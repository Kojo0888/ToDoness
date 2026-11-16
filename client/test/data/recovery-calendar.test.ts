/** Calendars and events in the recovery after a server loss (docs/calendar/PRD.md FR-216). */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { sameData, takeSnapshot } from '../../src/data/recovery';
import { createRecovery, isAccountEmpty } from '../../src/services/recovery';
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
    repeat: 'weekly',
    repeatUntil: '2027-06-30',
    reminders: ['day', 'hour'],
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
      repeat: 'weekly',
      repeatUntil: '2027-06-30',
      reminders: ['day', 'hour'],
      tz: old.kept.tz,
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

describe('the recovery question with calendars', () => {
  async function kept() {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    return { snap, old };
  }
  const withSnapshot = async (db: ReturnType<typeof testDb>, snap: unknown) => {
    await db.setMeta('recoverySnapshot', snap);
  };

  it('counts the kept calendars, and an account with only calendars is not empty', async () => {
    const { snap } = await kept();
    const fresh = await freshAccount();
    await withSnapshot(fresh.db, snap);
    const recovery = createRecovery({ db: fresh.db, repo: fresh.repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ calendars: 1, accountCalendars: 0 });
    expect(isAccountEmpty(recovery.getOffer()!)).toBe(true);

    await fresh.repo.createCalendar('Already here');
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ calendars: 1, accountCalendars: 1 });
    expect(isAccountEmpty(recovery.getOffer()!)).toBe(false);
  });

  it('drops the kept data without asking when the account already holds the same calendars', async () => {
    const { snap } = await kept();
    const fresh = await freshAccount();
    await fresh.repo.restoreSnapshot(snap, 'append');
    await fresh.db.outbox.clear();
    await withSnapshot(fresh.db, snap);
    const recovery = createRecovery({ db: fresh.db, repo: fresh.repo });
    await recovery.load();
    expect(recovery.getOffer()).toBeUndefined();
  });

  it('sameData notices a changed event or colour', async () => {
    const { snap, old } = await kept();
    const other = structuredClone(snap);
    expect(sameData(snap, other)).toBe(true);
    other.events![0]!.place = 'Elsewhere';
    expect(sameData(snap, other)).toBe(false);
    for (const change of [
      (e: NonNullable<typeof snap.events>[number]) => (e.repeat = 'daily'),
      (e: NonNullable<typeof snap.events>[number]) => (e.repeatUntil = null),
      (e: NonNullable<typeof snap.events>[number]) => (e.reminders = ['start']),
    ]) {
      const changed = structuredClone(snap);
      change(changed.events![0]!);
      expect(sameData(snap, changed)).toBe(false);
    }
    const recoloured = structuredClone(snap);
    recoloured.calendars![0]!.color = 'teal';
    expect(sameData(snap, recoloured)).toBe(false);
    void old;
  });
});
