/** Repeating events and reminders in the local database (docs/calendar/PRD.md section 6). */
import { describe, expect, it } from 'vitest';
import { addDays, localDay } from '@todoness/shared';
import { RepoError } from '../../src/data/repo';
import { getEventById, getEventsInRange } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, T0, testRepo } from '../helpers/db';

const TODAY = localDay(T0);
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const work = await t.repo.createCalendar('Work');
  const event = (title: string, start: string, more: object = {}) => {
    now.advance(10);
    return t.repo.createEvent({ calendarId: work.id, title, start, ...more });
  };
  return { ...t, now, work, event };
}

describe('repeat and reminders – repo', () => {
  it('stores repeat, end day and reminders (in order, once each) and the time zone of the device', async () => {
    const s = await setup();
    const e = await s.event('Standup', TODAY, {
      startTime: '10:00',
      repeat: 'weekly',
      repeatUntil: addDays(TODAY, 60),
      reminders: ['start', 'day', 'start'],
    });
    expect(e).toMatchObject({
      repeat: 'weekly',
      repeatUntil: addDays(TODAY, 60),
      reminders: ['day', 'start'],
      tz: ZONE,
    });
    await expectValidOutbox(s.db);
  });

  it('defaults: never repeats, no reminders', async () => {
    const s = await setup();
    const e = await s.event('Once', TODAY);
    expect(e).toMatchObject({ repeat: 'none', repeatUntil: null, reminders: [] });
  });

  it('an end day only makes sense for a repeating event, and not before the start', async () => {
    const s = await setup();
    const none = await s.event('Once', TODAY, { repeatUntil: addDays(TODAY, 5) });
    expect(none.repeatUntil).toBeNull();
    await expect(
      s.event('Bad', TODAY, { repeat: 'daily', repeatUntil: addDays(TODAY, -1) }),
    ).rejects.toBeInstanceOf(RepoError);
    const ok = await s.event('Same day', TODAY, { repeat: 'daily', repeatUntil: TODAY });
    expect(ok.repeatUntil).toBe(TODAY);
  });

  it('updates: switching repeat off forgets the end day; moving the start keeps the end check', async () => {
    const s = await setup();
    const e = await s.event('Gym', TODAY, { repeat: 'weekly', repeatUntil: addDays(TODAY, 30) });
    await s.repo.updateEvent(e.id, { repeat: 'none' });
    expect(await getEventById(s.db, e.id)).toMatchObject({ repeat: 'none', repeatUntil: null });
    const f = await s.event('Run', TODAY, { repeat: 'daily', repeatUntil: addDays(TODAY, 3) });
    await expect(s.repo.updateEvent(f.id, { start: addDays(TODAY, 10) })).rejects.toBeInstanceOf(
      RepoError,
    );
  });

  it('the time zone is written when the time, repeat or reminders change, not for a rename', async () => {
    const s = await setup();
    const e = await s.event('Gym', TODAY, { startTime: '18:00', reminders: ['hour'] });
    const before = await s.db.outbox.count();
    await s.repo.updateEvent(e.id, { title: 'Gym!' });
    expect(await s.db.outbox.count()).toBe(before + 1);
    const renames = (await s.db.outbox.toArray()).filter(
      (o) => o.type === 'update' && 'title' in o.patch,
    );
    expect(renames).toHaveLength(1);
    expect(Object.keys(renames[0]!.patch)).toEqual(['title']);

    await s.db.events.update(e.id, { tz: 'Asia/Tokyo' }); // as if saved on another device
    await s.repo.updateEvent(e.id, { reminders: ['hour', 'start'] });
    expect((await getEventById(s.db, e.id))!.tz).toBe(ZONE);
  });
});

describe('getEventsInRange with series', () => {
  it('returns a repeating event that began long ago when it has an occurrence in the range', async () => {
    const s = await setup();
    const weekly = await s.event('Weekly', addDays(TODAY, -400), { repeat: 'weekly' });
    const ended = await s.event('Ended', addDays(TODAY, -400), {
      repeat: 'weekly',
      repeatUntil: addDays(TODAY, -100),
    });
    const future = await s.event('Future', addDays(TODAY, 100), { repeat: 'daily' });
    const got = await getEventsInRange(s.db, TODAY, addDays(TODAY, 6));
    expect(got.map((e) => e.id)).toEqual([weekly.id]);
    void ended;
    void future;
  });

  it('a monthly event on the 31st has an occurrence in a short month', async () => {
    const s = await setup();
    const e = await s.event('Rent', '2026-01-31', { repeat: 'monthly' });
    expect((await getEventsInRange(s.db, '2026-02-20', '2026-02-28')).map((x) => x.id)).toEqual([
      e.id,
    ]);
    expect(await getEventsInRange(s.db, '2026-02-01', '2026-02-27')).toEqual([]);
  });
});
