/** Events become items per occurrence (docs/calendar/PRD.md FR-221). */
import { describe, expect, it } from 'vitest';
import { newId, type Calendar, type CalendarEvent } from '@todoness/shared';
import { eventItems } from '../../src/components/calendar/items';

const calendar: Calendar = {
  id: newId(),
  name: 'Work',
  color: 'green',
  orderKey: 'a0',
  isPublic: false,
  fieldHlc: {},
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};
const event = (o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: newId(),
  calendarId: calendar.id,
  title: 'Standup',
  start: '2026-11-02',
  days: 1,
  startTime: '10:00',
  endTime: null,
  place: '',
  description: '',
  repeat: 'none',
  repeatUntil: null,
  reminders: [],
  tz: 'UTC',
  fieldHlc: {},
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  ...o,
});

describe('eventItems', () => {
  it('a single event is one item at its day', () => {
    const items = eventItems([event()], [calendar], new Set(), '2026-11-01', '2026-11-30');
    expect(items.map((i) => i.start)).toEqual(['2026-11-02']);
  });

  it('a weekly event is one item for every occurrence in the range, all opening the one event', () => {
    const e = event({ repeat: 'weekly' });
    const items = eventItems([e], [calendar], new Set(), '2026-11-01', '2026-11-30');
    expect(items.map((i) => i.start)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(5);
    expect(new Set(items.map((i) => i.href))).toEqual(new Set([`/calendar/e/${e.id}`]));
    expect(items[1]!.label).toContain('2026-11-09');
  });

  it('hidden calendars and events of missing calendars are left out', () => {
    const e = event({ repeat: 'daily' });
    expect(eventItems([e], [calendar], new Set([calendar.id]), '2026-11-01', '2026-11-30')).toEqual(
      [],
    );
    expect(eventItems([e], [], new Set(), '2026-11-01', '2026-11-30')).toEqual([]);
  });
});
