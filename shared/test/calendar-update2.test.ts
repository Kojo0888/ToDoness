/** Calendar Update 2 (docs/calendar/PRD.md section 7): end dates, description, public. */
import { describe, expect, it } from 'vitest';
import {
  applyOp,
  eventSpan,
  eventsOnDay,
  formatHlc,
  newId,
  occurrenceDays,
  syncOpSchema,
  type Calendar,
  type CalendarEvent,
} from '../src';
import { dayClip } from '../src/calendar';

const hlc = (n: number) => formatHlc({ wall: 1_730_822_400_000 + n, counter: 0, clientId: 'aaaa' });
const base = { opId: newId(), entityId: newId(), hlc: hlc(1) };

describe('a timed event with an end date (FR-245)', () => {
  const e = { start: '2026-11-10', days: 3, startTime: '22:00', endTime: '08:00' };

  it('runs from the start day to the end day, ending at the end time', () => {
    expect(eventSpan(e)).toEqual({
      start: '2026-11-10',
      endDay: '2026-11-12',
      from: 1320,
      to: 480,
    });
  });

  it('without an end time it ends with the last day', () => {
    expect(eventSpan({ ...e, endTime: null }).to).toBe(1440);
  });

  it('one day stays as before: an earlier end time makes it one hour', () => {
    expect(eventSpan({ ...e, days: 1 })).toMatchObject({
      endDay: '2026-11-10',
      from: 1320,
      to: 1380,
    });
  });

  it('is on every day it touches', () => {
    const ev = { ...e, title: 'Trip' };
    expect(eventsOnDay([ev], '2026-11-11')).toHaveLength(1);
    expect(eventsOnDay([ev], '2026-11-13')).toHaveLength(0);
  });

  it('is clipped to one day for the hour grid', () => {
    const span = eventSpan(e);
    expect(dayClip(span, '2026-11-10')).toEqual({ from: 1320, to: 1440 });
    expect(dayClip(span, '2026-11-11')).toEqual({ from: 0, to: 1440 });
    expect(dayClip(span, '2026-11-12')).toEqual({ from: 0, to: 480 });
  });

  it('repeats with its length', () => {
    const r = { ...e, repeat: 'weekly' as const, repeatUntil: null };
    expect(occurrenceDays(r, '2026-11-17', '2026-11-17')).toEqual(['2026-11-17']);
    expect(occurrenceDays(r, '2026-11-19', '2026-11-19')).toEqual(['2026-11-17']);
  });
});

describe('new fields', () => {
  it('a calendar can be public; default is private', () => {
    const create = syncOpSchema.safeParse({
      ...base,
      entity: 'calendar',
      type: 'create',
      patch: { name: 'Team', orderKey: 'a0', isPublic: true },
    });
    expect(create.success).toBe(true);
    const r = applyOp<Calendar>(undefined, {
      ...base,
      entity: 'calendar',
      type: 'create',
      patch: { name: 'Team', orderKey: 'a0' },
    });
    expect(r.ok && r.row.isPublic).toBe(false);
  });

  it('an event has a description (≤ 5000), default empty', () => {
    const ok = (description: string) =>
      syncOpSchema.safeParse({
        ...base,
        entity: 'event',
        type: 'update',
        patch: { description },
      }).success;
    expect(ok('Bring the slides')).toBe(true);
    expect(ok('x'.repeat(5000))).toBe(true);
    expect(ok('x'.repeat(5001))).toBe(false);
    const r = applyOp<CalendarEvent>(undefined, {
      ...base,
      entity: 'event',
      type: 'create',
      patch: { calendarId: newId(), title: 'A', start: '2026-11-10' },
    });
    expect(r.ok && r.row.description).toBe('');
  });
});
