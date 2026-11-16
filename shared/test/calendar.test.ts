/** Calendars and events: schemas, merge defaults and day / time rules (docs/calendar/PRD.md). */
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_COLORS,
  applyOp,
  compareEvents,
  eventSpan,
  eventsOnDay,
  formatHlc,
  isTime,
  newId,
  syncOpSchema,
  timeMinutes,
  type Calendar,
  type CalendarEvent,
} from '../src';

const hlc = (n: number) => formatHlc({ wall: 1_730_822_400_000 + n, counter: 0, clientId: 'aaaa' });
const base = { opId: newId(), entityId: newId(), hlc: hlc(1) };

describe('time of day', () => {
  it('accepts HH:MM in 24 hours only', () => {
    for (const ok of ['00:00', '09:30', '23:59']) expect(isTime(ok)).toBe(true);
    for (const bad of ['24:00', '9:30', '12:60', '12:5', '', 'noon', '12:30:00'])
      expect(isTime(bad)).toBe(false);
  });

  it('counts minutes after midnight', () => {
    expect(timeMinutes('00:00')).toBe(0);
    expect(timeMinutes('09:30')).toBe(570);
    expect(timeMinutes('23:59')).toBe(1439);
  });
});

describe('calendar operations', () => {
  it('creates a calendar with a colour; the colour defaults to blue', () => {
    expect(CALENDAR_COLORS).toEqual(['blue', 'green', 'amber', 'red', 'purple', 'teal']);
    const ok = syncOpSchema.safeParse({
      ...base,
      entity: 'calendar',
      type: 'create',
      patch: { name: 'Work', orderKey: 'a0' },
    });
    expect(ok.success).toBe(true);
    const r = applyOp<Calendar>(undefined, {
      ...base,
      entity: 'calendar',
      type: 'create',
      patch: { name: 'Work', orderKey: 'a0' },
    });
    expect(r.ok && r.row).toMatchObject({ name: 'Work', color: 'blue', deletedAt: null });
  });

  it('refuses an unknown colour, a blank name and an empty update', () => {
    const bad = (type: 'create' | 'update', patch: object) =>
      syncOpSchema.safeParse({ ...base, entity: 'calendar', type, patch }).success;
    expect(bad('create', { name: 'Work', orderKey: 'a0', color: '#ff0000' })).toBe(false);
    expect(bad('create', { name: '   ', orderKey: 'a0' })).toBe(false);
    expect(bad('update', {})).toBe(false);
    expect(bad('update', { color: 'red' })).toBe(true);
  });
});

describe('event operations', () => {
  const create = (patch: object) =>
    syncOpSchema.safeParse({ ...base, entity: 'event', type: 'create', patch });

  it('creates an all-day event with defaults', () => {
    const patch = { calendarId: newId(), title: 'Birthday', start: '2026-11-20' };
    expect(create(patch).success).toBe(true);
    const r = applyOp<CalendarEvent>(undefined, {
      ...base,
      entity: 'event',
      type: 'create',
      patch,
    });
    expect(r.ok && r.row).toMatchObject({
      days: 1,
      startTime: null,
      endTime: null,
      place: '',
      deletedAt: null,
    });
  });

  it('needs a calendar, a title and a day to be created', () => {
    const r = applyOp<CalendarEvent>(undefined, {
      ...base,
      entity: 'event',
      type: 'create',
      patch: { title: 'No calendar', start: '2026-11-20' },
    });
    expect(r).toEqual({ ok: false, reason: 'missing_fields' });
  });

  it('checks day, times, length and place', () => {
    const ok = { calendarId: newId(), title: 'Dentist', start: '2026-11-18' };
    expect(create({ ...ok, startTime: '09:30', endTime: '10:15' }).success).toBe(true);
    expect(create({ ...ok, start: '2026-02-30' }).success).toBe(false);
    expect(create({ ...ok, startTime: '9:30' }).success).toBe(false);
    expect(create({ ...ok, endTime: '25:00' }).success).toBe(false);
    expect(create({ ...ok, days: 0 }).success).toBe(false);
    expect(create({ ...ok, days: 366 }).success).toBe(true);
    expect(create({ ...ok, days: 367 }).success).toBe(false);
    expect(create({ ...ok, place: 'x'.repeat(201) }).success).toBe(false);
    expect(create({ ...ok, startTime: null, endTime: null }).success).toBe(true);
    expect(create({ ...ok, surprise: 1 }).success).toBe(false);
  });

  it('merges per field: the newer write of each field wins', () => {
    const patch = { calendarId: newId(), title: 'Dentist', start: '2026-11-18' };
    const made = applyOp<CalendarEvent>(undefined, {
      ...base,
      entity: 'event',
      type: 'create',
      patch,
    });
    if (!made.ok) throw new Error('create failed');
    const newer = applyOp<CalendarEvent>(made.row, {
      ...base,
      entity: 'event',
      type: 'update',
      patch: { start: '2026-11-19' },
      hlc: hlc(5),
    });
    const older = applyOp<CalendarEvent>(newer.ok ? newer.row : undefined, {
      ...base,
      entity: 'event',
      type: 'update',
      patch: { start: '2026-11-01', title: 'Dentist!' },
      hlc: hlc(3),
    });
    expect(older.ok && older.row).toMatchObject({ start: '2026-11-19', title: 'Dentist!' });
  });
});

type E = Pick<CalendarEvent, 'start' | 'days' | 'startTime' | 'endTime' | 'title'>;
const ev = (o: Partial<E> = {}): E => ({
  start: '2026-11-18',
  days: 1,
  startTime: null,
  endTime: null,
  title: 'Event',
  ...o,
});

describe('eventSpan', () => {
  it('an all-day event covers its days', () => {
    expect(eventSpan(ev({ days: 3 }))).toEqual({
      start: '2026-11-18',
      endDay: '2026-11-20',
      from: null,
      to: null,
    });
  });

  it('a timed event lasts one day, whatever `days` says', () => {
    expect(eventSpan(ev({ days: 5, startTime: '09:30', endTime: '10:15' }))).toEqual({
      start: '2026-11-18',
      endDay: '2026-11-18',
      from: 570,
      to: 615,
    });
  });

  it('a missing or not-later end time makes it one hour, but never past midnight', () => {
    expect(eventSpan(ev({ startTime: '09:30' })).to).toBe(630);
    expect(eventSpan(ev({ startTime: '09:30', endTime: '09:30' })).to).toBe(630);
    expect(eventSpan(ev({ startTime: '09:30', endTime: '08:00' })).to).toBe(630);
    expect(eventSpan(ev({ startTime: '23:30' })).to).toBe(1440);
  });

  it('an end time without a start time is ignored (all day)', () => {
    expect(eventSpan(ev({ endTime: '10:00' })).from).toBeNull();
  });
});

describe('eventsOnDay / compareEvents', () => {
  const list = [
    ev({ title: 'B late', startTime: '18:00' }),
    ev({ title: 'A early', startTime: '08:00' }),
    ev({ title: 'Zebra all day' }),
    ev({ title: 'Apple all day' }),
    ev({ title: 'Other day', start: '2026-11-19' }),
    ev({ title: 'Multi', start: '2026-11-16', days: 3 }),
  ];

  it('lists what happens on a day: all-day (and running) events first, then by time', () => {
    expect(eventsOnDay(list, '2026-11-18').map((e) => e.title)).toEqual([
      'Apple all day',
      'Multi',
      'Zebra all day',
      'A early',
      'B late',
    ]);
  });

  it('knows days without events and the days a multi-day event runs over', () => {
    expect(eventsOnDay(list, '2026-11-15')).toEqual([]);
    expect(eventsOnDay(list, '2026-11-16').map((e) => e.title)).toEqual(['Multi']);
    expect(eventsOnDay(list, '2026-11-19').map((e) => e.title)).toEqual(['Other day']);
  });

  it('compareEvents orders by all-day, time, then title', () => {
    expect(compareEvents(ev({ title: 'a' }), ev({ title: 'b', startTime: '01:00' }))).toBeLessThan(
      0,
    );
    expect(compareEvents(ev({ startTime: '10:00' }), ev({ startTime: '09:00' }))).toBeGreaterThan(
      0,
    );
  });
});
