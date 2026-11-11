import { describe, expect, it } from 'vitest';
import { TIME_PRESETS, normalizeTime, parseTime, timeFromInput } from '../../src/lib/timeField';

describe('time field helpers (due time control)', () => {
  it('splits a stored time and handles "no time"', () => {
    expect(parseTime('09:30')).toEqual({ hour: '09', minute: '30' });
    expect(parseTime('23:05')).toEqual({ hour: '23', minute: '05' });
    for (const v of ['', 'nope', '25:00', '9:30']) expect(parseTime(v), v).toBeNull();
  });

  it('00:00 and invalid input mean "no time"', () => {
    expect(normalizeTime('00:00')).toBe('');
    expect(normalizeTime('')).toBe('');
    expect(normalizeTime('xx')).toBe('');
    expect(normalizeTime('00:05')).toBe('00:05');
    expect(normalizeTime('17:45')).toBe('17:45');
  });

  it('suggests morning, midday, afternoon and evening', () => {
    expect(TIME_PRESETS.map((p) => p.label)).toEqual(['Morning', 'Midday', 'Afternoon', 'Evening']);
    for (const p of TIME_PRESETS) expect(parseTime(p.value), p.label).not.toBeNull();
  });

  it('an unfinished keyboard edit is ignored; only a real clear removes the time', () => {
    // the browser reports '' with badInput while a segment is empty
    expect(timeFromInput('', true)).toBeUndefined();
    expect(timeFromInput('', false)).toBe('');
    expect(timeFromInput('14:30', false)).toBe('14:30');
    expect(timeFromInput('00:00', false)).toBe('');
  });
});
