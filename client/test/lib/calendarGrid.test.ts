/** Layout rules of the calendar views (docs/calendar/PRD.md FR-210 – FR-214). */
import { describe, expect, it } from 'vitest';
import {
  agendaGroups,
  firstOfMonth,
  layoutTimed,
  monthGrid,
  shiftPeriod,
  weekDays,
  weekStart,
  weekdayIndex,
} from '../../src/lib/calendarGrid';

type E = {
  start: string;
  days: number;
  startTime: string | null;
  endTime: string | null;
  title: string;
};
const ev = (title: string, o: Partial<E> = {}): E => ({
  title,
  start: '2026-11-18',
  days: 1,
  startTime: null,
  endTime: null,
  ...o,
});

describe('weeks start on Monday', () => {
  it('weekdayIndex: Monday 0 … Sunday 6', () => {
    expect(weekdayIndex('2026-11-09')).toBe(0);
    expect(weekdayIndex('2026-11-15')).toBe(6);
    expect(weekdayIndex('2026-11-01')).toBe(6);
  });

  it('weekStart and weekDays', () => {
    expect(weekStart('2026-11-15')).toBe('2026-11-09');
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(weekDays('2026-11-12')).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
  });
});

describe('monthGrid', () => {
  it('covers the month in whole weeks, Monday first (November 2026 starts on a Sunday: six rows)', () => {
    const g = monthGrid('2026-11-15');
    expect(g).toHaveLength(6);
    expect(g[0]![0]).toBe('2026-10-26');
    expect(g[0]![6]).toBe('2026-11-01');
    expect(g[5]![0]).toBe('2026-11-30');
    expect(g.every((w) => w.length === 7)).toBe(true);
  });

  it('uses only the weeks it needs (February 2027 is four rows)', () => {
    const g = monthGrid('2027-02-10');
    expect(g).toHaveLength(4);
    expect(g[0]![0]).toBe('2027-02-01');
    expect(g[3]![6]).toBe('2027-02-28');
  });
});

describe('shiftPeriod', () => {
  it('month: the first day of the previous / next month, across a year', () => {
    expect(firstOfMonth('2026-11-15')).toBe('2026-11-01');
    expect(shiftPeriod('month', '2026-11-15', 1)).toBe('2026-12-01');
    expect(shiftPeriod('month', '2026-12-20', 1)).toBe('2027-01-01');
    expect(shiftPeriod('month', '2026-01-31', -1)).toBe('2025-12-01');
  });

  it('week and agenda: seven days', () => {
    expect(shiftPeriod('week', '2026-11-15', 1)).toBe('2026-11-22');
    expect(shiftPeriod('week', '2026-11-15', -1)).toBe('2026-11-08');
    expect(shiftPeriod('agenda', '2026-11-15', 1)).toBe('2026-11-22');
  });
});

describe('layoutTimed on a day of a longer event (FR-245)', () => {
  const trip = ev('Trip', { start: '2026-11-10', days: 3, startTime: '22:00', endTime: '08:00' });
  const spans = (day: string) => layoutTimed([trip], day).map((o) => [o.from, o.to]);

  it('fills the rest of the first day, whole middle days and the start of the last day', () => {
    expect(spans('2026-11-10')).toEqual([[1320, 1440]]);
    expect(spans('2026-11-11')).toEqual([[0, 1440]]);
    expect(spans('2026-11-12')).toEqual([[0, 480]]);
  });
});

describe('layoutTimed (week view columns)', () => {
  it('events that do not overlap each take the whole column', () => {
    const out = layoutTimed([
      ev('A', { startTime: '09:00', endTime: '10:00' }),
      ev('B', { startTime: '10:00', endTime: '11:00' }),
    ]);
    expect(out.map((o) => [o.event.title, o.from, o.to, o.column, o.columns])).toEqual([
      ['A', 540, 600, 0, 1],
      ['B', 600, 660, 0, 1],
    ]);
  });

  it('overlapping events sit side by side', () => {
    const out = layoutTimed([
      ev('A', { startTime: '09:00', endTime: '11:00' }),
      ev('B', { startTime: '10:00', endTime: '12:00' }),
      ev('C', { startTime: '13:00', endTime: '14:00' }),
    ]);
    expect(out.map((o) => [o.event.title, o.column, o.columns])).toEqual([
      ['A', 0, 2],
      ['B', 1, 2],
      ['C', 0, 1],
    ]);
  });

  it('a missing end time is one hour; all-day events are not laid out', () => {
    const out = layoutTimed([ev('Day'), ev('Short', { startTime: '08:30' })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: 510, to: 570 });
  });
});

describe('agendaGroups', () => {
  const list = [
    ev('Late', { start: '2026-11-18', startTime: '18:00' }),
    ev('All day', { start: '2026-11-18' }),
    ev('Later', { start: '2026-11-25' }),
    ev('Multi', { start: '2026-11-16', days: 3 }),
    ev('Past', { start: '2026-11-01' }),
  ];

  it('only the days with something on them, in order, all-day first; today even when empty', () => {
    const g = agendaGroups(list, '2026-11-15', '2026-11-30', '2026-11-15');
    expect(g.map((x) => [x.day, x.events.map((e) => e.title)])).toEqual([
      ['2026-11-15', []],
      ['2026-11-16', ['Multi']],
      ['2026-11-17', ['Multi']],
      ['2026-11-18', ['All day', 'Multi', 'Late']],
      ['2026-11-25', ['Later']],
    ]);
  });

  it('leaves today out when it is not in the range', () => {
    const g = agendaGroups(list, '2026-11-20', '2026-11-30', '2026-11-15');
    expect(g.map((x) => x.day)).toEqual(['2026-11-25']);
  });
});
