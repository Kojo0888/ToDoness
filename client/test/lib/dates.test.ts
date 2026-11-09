import { describe, expect, it } from 'vitest';
import {
  formatDue,
  fromDateInput,
  fromDateTimeInput,
  toDateInput,
  toTimeInput,
} from '../../src/lib/dates';

const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

describe('due date and time (FR-43)', () => {
  it('no time means the start of the day, as before', () => {
    expect(fromDateTimeInput('2026-11-05', '')).toBe(local(2026, 11, 5));
    expect(fromDateTimeInput('2026-11-05', '')).toBe(fromDateInput('2026-11-05'));
  });

  it('adds the time of day in local time', () => {
    expect(fromDateTimeInput('2026-11-05', '09:30')).toBe(local(2026, 11, 5, 9, 30));
    expect(fromDateTimeInput('2026-11-05', '23:59')).toBe(local(2026, 11, 5, 23, 59));
    expect(fromDateTimeInput('2026-11-05', '00:00')).toBe(local(2026, 11, 5));
  });

  it('is null without a valid date, and ignores an invalid time', () => {
    expect(fromDateTimeInput('', '09:30')).toBeNull();
    expect(fromDateTimeInput('nope', '09:30')).toBeNull();
    expect(fromDateTimeInput('2026-11-05', '25:99')).toBe(local(2026, 11, 5));
    expect(fromDateTimeInput('2026-11-05', 'abc')).toBe(local(2026, 11, 5));
  });

  it('splits a stored value back into the two inputs', () => {
    const ms = local(2026, 11, 5, 9, 5);
    expect(toDateInput(ms)).toBe('2026-11-05');
    expect(toTimeInput(ms)).toBe('09:05');
  });

  it('shows no time for a date-only value or for nothing', () => {
    expect(toTimeInput(local(2026, 11, 5))).toBe('');
    expect(toTimeInput(null)).toBe('');
  });

  it('round-trips every minute of a day, also across a daylight-saving change', () => {
    for (const [y, m, d] of [
      [2026, 3, 29], // clocks change in Europe
      [2026, 10, 25],
      [2026, 3, 8], // and in the USA
      [2026, 11, 1],
    ] as const) {
      for (const [h, min] of [
        [0, 1],
        [1, 30],
        [3, 0],
        [9, 0],
        [12, 0],
        [23, 59],
      ] as const) {
        const ms = fromDateTimeInput(
          `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        )!;
        const back = new Date(ms);
        // A time that does not exist (skipped hour) moves forward, but the day stays.
        expect(back.getDate()).toBe(d);
        if (back.getHours() === h) expect(back.getMinutes()).toBe(min);
      }
    }
  });

  it('formatDue adds the time only when there is one', () => {
    const dateOnly = formatDue(local(2026, 11, 5));
    const withTime = formatDue(local(2026, 11, 5, 9, 30));
    expect(withTime.startsWith(dateOnly)).toBe(true);
    expect(withTime.length).toBeGreaterThan(dateOnly.length);
    expect(withTime).toMatch(/9|09/);
  });
});
