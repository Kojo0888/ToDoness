import { describe, expect, it } from 'vitest';
import {
  HOURS,
  TIME_PRESETS,
  composeTime,
  defaultMinute,
  minuteChoices,
  parseTime,
} from '../src/app/timeField';

describe('time field helpers (due time control)', () => {
  it('has the 24 hours', () => {
    expect(HOURS).toHaveLength(24);
    expect(HOURS[0]).toBe('00');
    expect(HOURS[23]).toBe('23');
  });

  it('splits a stored time and handles "no time"', () => {
    expect(parseTime('09:30')).toEqual({ hour: '09', minute: '30' });
    expect(parseTime('23:05')).toEqual({ hour: '23', minute: '05' });
    for (const v of ['', 'nope', '25:00', '9:30']) expect(parseTime(v), v).toBeNull();
  });

  it('offers minutes in steps of 5', () => {
    const m = minuteChoices('09');
    expect(m).toHaveLength(12);
    expect(m.slice(0, 3)).toEqual(['00', '05', '10']);
    expect(m.at(-1)).toBe('55');
  });

  it('keeps a minute that is not on the grid, so an existing time is not changed by showing it', () => {
    expect(minuteChoices('09', '07')).toContain('07');
    expect(minuteChoices('09', '07').filter((x) => x === '07')).toHaveLength(1);
    expect(minuteChoices('09', '30').filter((x) => x === '30')).toHaveLength(1);
    expect(minuteChoices('09', '07')).toEqual([...minuteChoices('09', '07')].sort());
  });

  it('00:00 means "no time" in the data, so it is not offered', () => {
    expect(minuteChoices('00')).not.toContain('00');
    expect(minuteChoices('00')[0]).toBe('05');
    expect(defaultMinute('00')).toBe('05');
    expect(defaultMinute('09')).toBe('00');
  });

  it('puts hour and minute together; no hour means no time', () => {
    expect(composeTime('09', '30')).toBe('09:30');
    expect(composeTime('', '30')).toBe('');
    expect(composeTime('00', '00')).toBe('');
    expect(composeTime('00', '05')).toBe('00:05');
  });

  it('has quick choices that are valid times', () => {
    expect(TIME_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const p of TIME_PRESETS) {
      expect(parseTime(p.value), p.label).not.toBeNull();
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});
