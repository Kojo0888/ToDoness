/** Calendar Update 2 in the local database (docs/calendar/PRD.md section 7). */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { takeSnapshot } from '../../src/data/recovery';
import { getEventById } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, seedInbox, T0, testRepo } from '../helpers/db';

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const cal = await t.repo.createCalendar('Work');
  return { ...t, now, cal };
}

describe('public calendars (FR-241)', () => {
  it('a calendar is private until it is made public, and back', async () => {
    const s = await setup();
    expect(s.cal.isPublic).toBe(false);
    s.now.advance(10);
    expect((await s.repo.setCalendarPublic(s.cal.id, true)).isPublic).toBe(true);
    s.now.advance(10);
    expect((await s.repo.setCalendarPublic(s.cal.id, false)).isPublic).toBe(false);
    const ops = await expectValidOutbox(s.db);
    expect(ops.filter((o) => o.type === 'update').map((o) => o.patch)).toEqual([
      { isPublic: true },
      { isPublic: false },
    ]);
  });
});

describe('events: end date and description (FR-245, FR-246)', () => {
  it('keeps the number of days and the description of a timed event', async () => {
    const s = await setup();
    const e = await s.repo.createEvent({
      calendarId: s.cal.id,
      title: 'Trip',
      start: '2026-11-10',
      startTime: '22:00',
      endTime: '08:00',
      days: 3,
      description: 'Take the charger',
    });
    expect(e).toMatchObject({ days: 3, startTime: '22:00', endTime: '08:00' });
    expect(e.description).toBe('Take the charger');
    s.now.advance(10);
    await s.repo.updateEvent(e.id, { description: '' });
    expect((await getEventById(s.db, e.id))!.description).toBe('');
    await expectValidOutbox(s.db);
  });

  it('description defaults to empty', async () => {
    const s = await setup();
    const e = await s.repo.createEvent({ calendarId: s.cal.id, title: 'A', start: '2026-11-10' });
    expect(e.description).toBe('');
  });
});

describe('the untouched default calendar is no user data (FR-244)', () => {
  it('a device with only "My calendar" has nothing to restore; with an event it has', async () => {
    const s = await setup();
    await seedInbox(s.db);
    const def = await s.repo.createCalendar('My calendar');
    await s.repo.deleteCalendar(s.cal.id);
    expect(await takeSnapshot(s.db, 'ann@corp.test')).toBeUndefined();
    s.now.advance(10);
    await s.repo.createEvent({ calendarId: def.id, title: 'Dentist', start: '2026-11-10' });
    const snap = (await takeSnapshot(s.db, 'ann@corp.test'))!;
    expect(snap.calendars!.map((c) => c.name)).toEqual(['My calendar']);
    void T0;
    void newId;
  });
});
