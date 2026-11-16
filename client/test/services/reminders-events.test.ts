/** Event reminders on the device while the app is open (docs/calendar/PRD.md FR-225 – FR-229). */
import { describe, expect, it } from 'vitest';
import { newId, type Calendar, type CalendarEvent } from '@todoness/shared';
import {
  createReminderScheduler,
  dueEventReminders,
  eventReminderText,
  type EventReminder,
} from '../../src/services/reminders';
import { fakeNow, T0, testDb } from '../helpers/db';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 14:00 UTC on 2026-11-18. */
const START = Date.UTC(2026, 10, 18, 14, 0);

const calendar: Calendar = {
  id: newId(T0),
  name: 'Work',
  color: 'blue',
  orderKey: 'a0',
  isPublic: false,
  fieldHlc: {},
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
};
const event = (o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: newId(T0),
  calendarId: calendar.id,
  title: 'Sprint review',
  start: '2026-11-18',
  days: 1,
  startTime: '14:00',
  endTime: '15:00',
  place: '',
  description: '',
  repeat: 'none',
  repeatUntil: null,
  reminders: ['hour'],
  tz: 'UTC',
  fieldHlc: {},
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...o,
});
const none = new Set<string>();

describe('dueEventReminders', () => {
  it('is due from an hour before; the key and tag say event, day and choice', () => {
    const e = event();
    expect(dueEventReminders([e], [calendar], START - 2 * HOUR, none)).toEqual([]);
    const [r] = dueEventReminders([e], [calendar], START - 30 * MIN, none);
    expect(r).toMatchObject({ choice: 'hour', occurrence: '2026-11-18', startMs: START });
    expect(r!.tag).toBe(`event:${e.id}:2026-11-18:hour`);
    expect(r!.key).toBe(`${r!.tag}:${START}`);
  });

  it('only the latest passed choice, and not later than 10 minutes after the start', () => {
    const e = event({ reminders: ['day', 'hour', 'start'] });
    expect(dueEventReminders([e], [calendar], START - 30 * MIN, none)[0]!.choice).toBe('hour');
    expect(dueEventReminders([e], [calendar], START + 5 * MIN, none)[0]!.choice).toBe('start');
    expect(dueEventReminders([e], [calendar], START + 11 * MIN, none)).toEqual([]);
  });

  it('skips what was shown, deleted events, events of deleted calendars and events without reminders', () => {
    const e = event();
    const [r] = dueEventReminders([e], [calendar], START - 30 * MIN, none);
    expect(dueEventReminders([e], [calendar], START - 30 * MIN, new Set([r!.key]))).toEqual([]);
    expect(dueEventReminders([{ ...e, deletedAt: 1 }], [calendar], START - 30 * MIN, none)).toEqual(
      [],
    );
    expect(dueEventReminders([e], [], START - 30 * MIN, none)).toEqual([]);
    expect(dueEventReminders([e], [{ ...calendar, deletedAt: 1 }], START - 30 * MIN, none)).toEqual(
      [],
    );
    expect(
      dueEventReminders([{ ...e, reminders: [] }], [calendar], START - 30 * MIN, none),
    ).toEqual([]);
  });

  it('every occurrence of a series is a reminder of its own', () => {
    const e = event({ repeat: 'weekly' });
    const next = dueEventReminders([e], [calendar], START + 7 * DAY - 30 * MIN, none);
    expect(next.map((r) => r.occurrence)).toEqual(['2026-11-25']);
  });

  it('a moved event is a new reminder (the key has the start moment)', () => {
    const e = event();
    const [a] = dueEventReminders([e], [calendar], START - 30 * MIN, none);
    const moved = event({ ...e, startTime: '14:30' });
    const [b] = dueEventReminders([moved], [calendar], START - 15 * MIN, new Set([a!.key]));
    expect(b!.key).not.toBe(a!.key);
  });

  it('the text names the time; all-day events say the day', () => {
    const [r] = dueEventReminders([event()], [calendar], START - 30 * MIN, none);
    expect(eventReminderText(r!, START - 30 * MIN)).toEqual({
      title: 'Sprint review',
      body: 'Starts in 30 minutes (14:00)',
    });
    const [d] = dueEventReminders(
      [event({ startTime: null, endTime: null, reminders: ['start'] })],
      [calendar],
      Date.UTC(2026, 10, 18, 9, 1),
      none,
    );
    expect(eventReminderText(d!, Date.UTC(2026, 10, 18, 9, 1)).body).toBe('All day on 2026-11-18');
  });
});

describe('the scheduler and events', () => {
  it('fires an event reminder once, remembers it, and does not fire it again', async () => {
    const db = testDb();
    await db.calendars.put(calendar);
    await db.events.put(event());
    const now = fakeNow(START - 30 * MIN);
    const seen: EventReminder[] = [];
    const scheduler = createReminderScheduler({
      db,
      now,
      notify: () => {},
      notifyEvent: (r) => void seen.push(r),
      subscribeVisible: () => () => {},
    });
    expect(await scheduler.check()).toBe(1);
    expect(await scheduler.check()).toBe(0);
    expect(seen).toHaveLength(1);
    expect(await db.notified.get(seen[0]!.key)).toBeDefined();
    now.advance(20 * MIN);
    expect(await scheduler.check()).toBe(0);
  });
});
