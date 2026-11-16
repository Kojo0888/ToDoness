/** Calendars between simulated browsers and the real server (docs/calendar/PRD.md FR-216, FR-217). */
import { describe, expect, it } from 'vitest';
import { getCalendars, getEventById } from '../../client/src/data/queries';
import { twoBrowsers } from './harness';

describe('calendar sync', () => {
  it('a calendar with events built offline reaches the other device after reconnecting', async () => {
    const { a, b } = await twoBrowsers();
    a.online = false;
    const work = await a.repo.createCalendar('Work', 'green');
    a.time += 10;
    const review = await a.repo.createEvent({
      calendarId: work.id,
      title: 'Review',
      start: '2026-11-17',
      startTime: '14:00',
      endTime: '15:00',
    });
    expect((await a.sync()).ok).toBe(false);

    a.online = true;
    expect(await a.sync()).toEqual({ ok: true });
    expect(await b.sync()).toEqual({ ok: true });
    // Every account also has "My calendar" (docs/calendar FR-244).
    expect((await getCalendars(b.db)).map((c) => [c.name, c.color])).toEqual(
      expect.arrayContaining([['Work', 'green']]),
    );
    expect(await getEventById(b.db, review.id)).toMatchObject({
      title: 'Review',
      startTime: '14:00',
      endTime: '15:00',
    });
  });

  it('edits made on two devices merge per field; a delete reaches the other device', async () => {
    const { a, b } = await twoBrowsers();
    const work = await a.repo.createCalendar('Work');
    a.time += 10;
    const e = await a.repo.createEvent({
      calendarId: work.id,
      title: 'Review',
      start: '2026-11-17',
    });
    await a.sync();
    await b.sync();

    a.online = false;
    b.online = false;
    a.time += 1000;
    b.time += 2000;
    await a.repo.updateEvent(e.id, { title: 'Review!' });
    await b.repo.updateEvent(e.id, { place: 'Room 4' });
    a.online = true;
    b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();
    for (const x of [a, b]) {
      expect(await getEventById(x.db, e.id)).toMatchObject({ title: 'Review!', place: 'Room 4' });
    }

    await b.repo.deleteCalendar(work.id);
    await b.sync();
    await a.sync();
    expect((await getCalendars(a.db)).map((c) => c.name)).toEqual(['My calendar']);
    expect(await getEventById(a.db, e.id)).toBeUndefined();
  });

  it('repeat, end day, reminders and time zone reach the other device and merge per field', async () => {
    const { a, b } = await twoBrowsers();
    const work = await a.repo.createCalendar('Work');
    a.time += 10;
    const e = await a.repo.createEvent({
      calendarId: work.id,
      title: 'Standup',
      start: '2026-11-02',
      startTime: '10:00',
      repeat: 'weekly',
      repeatUntil: '2027-03-31',
      reminders: ['hour', 'start'],
    });
    await a.sync();
    await b.sync();
    expect(await getEventById(b.db, e.id)).toMatchObject({
      repeat: 'weekly',
      repeatUntil: '2027-03-31',
      reminders: ['hour', 'start'],
      tz: e.tz,
    });

    a.online = false;
    b.online = false;
    a.time += 1000;
    b.time += 2000;
    await a.repo.updateEvent(e.id, { reminders: ['day'] });
    await b.repo.updateEvent(e.id, { repeat: 'daily', repeatUntil: null });
    a.online = true;
    b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();
    for (const x of [a, b]) {
      expect(await getEventById(x.db, e.id)).toMatchObject({
        reminders: ['day'],
        repeat: 'daily',
        repeatUntil: null,
      });
    }
  });
});
