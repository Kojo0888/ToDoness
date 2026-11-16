/** Repeating events and reminders: rules and fields (docs/calendar/PRD.md section 6). */
import { describe, expect, it } from 'vitest';
import {
  EVENT_REMINDS,
  EVENT_REMIND_MS,
  applyOp,
  eventReminderKey,
  eventStartMs,
  formatHlc,
  isTimeZone,
  latestDueEventReminder,
  newId,
  occurrenceDays,
  syncOpSchema,
  zonedMs,
  type CalendarEvent,
} from '../src';

const MIN = 60_000;
const HOUR = 60 * MIN;
const hlc = (n: number) => formatHlc({ wall: 1_730_822_400_000 + n, counter: 0, clientId: 'aaaa' });

describe('time zones', () => {
  it('knows IANA names', () => {
    expect(isTimeZone('Europe/Warsaw')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('zonedMs: a local day and time in a zone as a moment (winter, summer, behind UTC)', () => {
    expect(zonedMs('2026-11-18', '14:00', 'Europe/Warsaw')).toBe(Date.UTC(2026, 10, 18, 13, 0));
    expect(zonedMs('2026-07-01', '09:00', 'Europe/Warsaw')).toBe(Date.UTC(2026, 6, 1, 7, 0));
    expect(zonedMs('2026-11-18', '14:00', 'America/New_York')).toBe(Date.UTC(2026, 10, 18, 19, 0));
    expect(zonedMs('2026-11-18', '14:00', 'UTC')).toBe(Date.UTC(2026, 10, 18, 14, 0));
  });

  it('zonedMs: an empty zone counts as UTC; the day of a daylight saving change is right', () => {
    expect(zonedMs('2026-11-18', '14:00', '')).toBe(Date.UTC(2026, 10, 18, 14, 0));
    // Warsaw: clocks go forward on 2026-03-29 at 02:00; 12:00 that day is already summer time.
    expect(zonedMs('2026-03-29', '12:00', 'Europe/Warsaw')).toBe(Date.UTC(2026, 2, 29, 10, 0));
    expect(zonedMs('2026-03-28', '12:00', 'Europe/Warsaw')).toBe(Date.UTC(2026, 2, 28, 11, 0));
  });

  it('eventStartMs: the start time, or 09:00 for an all-day event (decision C7)', () => {
    const base = { tz: 'Europe/Warsaw' };
    expect(eventStartMs({ ...base, startTime: '14:00' }, '2026-11-18')).toBe(
      Date.UTC(2026, 10, 18, 13, 0),
    );
    expect(eventStartMs({ ...base, startTime: null }, '2026-11-18')).toBe(
      Date.UTC(2026, 10, 18, 8, 0),
    );
  });
});

type R = {
  start: string;
  days: number;
  startTime: string | null;
  repeat: CalendarEvent['repeat'];
  repeatUntil: string | null;
};
const ev = (o: Partial<R> = {}): R => ({
  start: '2026-11-10',
  days: 1,
  startTime: null,
  repeat: 'none',
  repeatUntil: null,
  ...o,
});

describe('occurrenceDays', () => {
  it('a single event: its day when it touches the range, else nothing', () => {
    expect(occurrenceDays(ev(), '2026-11-01', '2026-11-30')).toEqual(['2026-11-10']);
    expect(occurrenceDays(ev(), '2026-11-11', '2026-11-30')).toEqual([]);
    expect(occurrenceDays(ev(), '2026-11-10', '2026-11-10')).toEqual(['2026-11-10']);
  });

  it('a multi-day event touches a range it only runs into', () => {
    const e = ev({ start: '2026-11-16', days: 3 });
    expect(occurrenceDays(e, '2026-11-18', '2026-11-18')).toEqual(['2026-11-16']);
    expect(occurrenceDays(e, '2026-11-19', '2026-11-19')).toEqual([]);
  });

  it('daily, with and without an end day', () => {
    const e = ev({ repeat: 'daily' });
    expect(occurrenceDays(e, '2026-11-12', '2026-11-14')).toEqual([
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    expect(occurrenceDays({ ...e, repeatUntil: '2026-11-13' }, '2026-11-12', '2026-11-14')).toEqual(
      ['2026-11-12', '2026-11-13'],
    );
    expect(occurrenceDays(e, '2026-11-01', '2026-11-12')).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
  });

  it('weekly keeps the weekday; nothing before the first day', () => {
    const e = ev({ start: '2026-11-02', repeat: 'weekly' });
    expect(occurrenceDays(e, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
    expect(occurrenceDays({ ...e, start: '2026-12-01' }, '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('monthly keeps the day number; short months use their last day (decision C11)', () => {
    const e = ev({ start: '2026-01-31', repeat: 'monthly' });
    expect(occurrenceDays(e, '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
    expect(occurrenceDays(e, '2026-04-01', '2026-04-30')).toEqual(['2026-04-30']);
    expect(occurrenceDays(e, '2026-03-01', '2026-03-31')).toEqual(['2026-03-31']);
    expect(occurrenceDays(e, '2025-12-01', '2025-12-31')).toEqual([]);
  });

  it('yearly keeps the date; 29 February becomes 28 February in other years', () => {
    const e = ev({ start: '2024-02-29', repeat: 'yearly' });
    expect(occurrenceDays(e, '2025-02-01', '2025-03-01')).toEqual(['2025-02-28']);
    expect(occurrenceDays(e, '2028-02-01', '2028-03-01')).toEqual(['2028-02-29']);
    expect(occurrenceDays(e, '2025-03-02', '2026-02-27')).toEqual([]);
  });

  it('a daily event from long ago does not need to be walked through', () => {
    const e = ev({ start: '1950-01-01', repeat: 'daily' });
    expect(occurrenceDays(e, '2026-11-15', '2026-11-16')).toEqual(['2026-11-15', '2026-11-16']);
  });

  it('a repeating multi-day event shows the occurrence that runs into the range', () => {
    const e = ev({ start: '2026-11-02', days: 3, repeat: 'weekly' });
    expect(occurrenceDays(e, '2026-11-11', '2026-11-11')).toEqual(['2026-11-09']);
  });

  it('a timed event is one day, whatever `days` says', () => {
    const e = ev({ start: '2026-11-02', days: 3, startTime: '10:00', repeat: 'weekly' });
    expect(occurrenceDays(e, '2026-11-11', '2026-11-11')).toEqual([]);
    expect(occurrenceDays(e, '2026-11-09', '2026-11-09')).toEqual(['2026-11-09']);
  });
});

describe('reminders: which one counts', () => {
  const start = Date.UTC(2026, 10, 18, 13, 0);

  it('lists the choices earliest first, with their offsets', () => {
    expect(EVENT_REMINDS).toEqual(['day', 'hour', '10min', 'start']);
    expect(EVENT_REMIND_MS).toEqual({ day: 24 * HOUR, hour: HOUR, '10min': 10 * MIN, start: 0 });
  });

  it('only the latest choice that has passed', () => {
    const chosen = ['day', 'hour'] as const;
    expect(latestDueEventReminder(start, chosen, start - 25 * HOUR)).toBeNull();
    expect(latestDueEventReminder(start, chosen, start - 2 * HOUR)).toBe('day');
    expect(latestDueEventReminder(start, chosen, start - 30 * MIN)).toBe('hour');
    expect(latestDueEventReminder(start, [], start - 30 * MIN)).toBeNull();
  });

  it('is valid until 10 minutes after the start, not longer (decision C10)', () => {
    expect(latestDueEventReminder(start, ['start'], start - 1)).toBeNull();
    expect(latestDueEventReminder(start, ['start'], start)).toBe('start');
    expect(latestDueEventReminder(start, ['start'], start + 9 * MIN)).toBe('start');
    expect(latestDueEventReminder(start, ['start'], start + 10 * MIN)).toBeNull();
    expect(latestDueEventReminder(start, ['hour'], start + 5 * MIN)).toBe('hour');
  });

  it('the key says which event, occurrence and choice (also the notification tag)', () => {
    expect(eventReminderKey('e1', '2026-11-18', 'hour')).toBe('event:e1:2026-11-18:hour');
  });
});

describe('the new event fields', () => {
  const calendarId = newId();
  const base = { calendarId, title: 'Dentist', start: '2026-11-18' };
  const create = (patch: object) =>
    syncOpSchema.safeParse({
      opId: newId(),
      entityId: newId(),
      hlc: hlc(1),
      entity: 'event',
      type: 'create',
      patch,
    });

  it('defaults: never repeats, no reminders, no zone', () => {
    const r = applyOp<CalendarEvent>(undefined, {
      entity: 'event',
      entityId: newId(),
      type: 'create',
      patch: base,
      hlc: hlc(1),
    });
    expect(r.ok && r.row).toMatchObject({
      repeat: 'none',
      repeatUntil: null,
      reminders: [],
      tz: '',
    });
  });

  it('checks repeat, end day, reminders and zone', () => {
    expect(create({ ...base, repeat: 'weekly', repeatUntil: '2026-12-31' }).success).toBe(true);
    expect(create({ ...base, repeat: 'hourly' }).success).toBe(false);
    expect(create({ ...base, repeatUntil: '2026-13-01' }).success).toBe(false);
    expect(create({ ...base, repeatUntil: null }).success).toBe(true);
    expect(create({ ...base, reminders: ['hour', 'start'] }).success).toBe(true);
    expect(create({ ...base, reminders: ['week'] }).success).toBe(false);
    expect(create({ ...base, tz: 'Europe/Warsaw' }).success).toBe(true);
    expect(create({ ...base, tz: '' }).success).toBe(true);
    expect(create({ ...base, tz: 'Nowhere/Land' }).success).toBe(false);
  });

  it('reminders are unique and in order, whatever order they were sent in', () => {
    const parsed = create({ ...base, reminders: ['start', 'day', 'start', 'hour'] });
    expect(parsed.success && (parsed.data.patch as { reminders: string[] }).reminders).toEqual([
      'day',
      'hour',
      'start',
    ]);
  });
});
