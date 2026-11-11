/** A value edited here that is not saved yet (review fixes for the task detail). */
import { describe, expect, it } from 'vitest';
import { createPendingValue } from '../../src/lib/pendingValue';

describe('pending value', () => {
  it('shows the value being saved, also against a stale saved value', () => {
    const p = createPendingValue<string>();
    expect(p.current('09:00')).toBe('09:00');
    p.start('12:00');
    expect(p.current('09:00')).toBe('12:00');
    p.saved('09:00'); // an older emit while the save is under way
    expect(p.current('09:00')).toBe('12:00');
  });

  it('a quick pick back to the saved value is a real change', () => {
    const p = createPendingValue<string>();
    p.start('12:00');
    // what the user sees (and what a new pick is compared with) is 12:00, not the saved 09:00
    expect(p.current('09:00')).not.toBe('09:00');
    p.start('09:00');
    p.settle(true, '12:00'); // the first save comes back
    p.saved('12:00');
    expect(p.current('12:00')).toBe('09:00'); // the second one is still on its way
    p.settle(true, '09:00');
    expect(p.pending).toBe(false);
    expect(p.current('09:00')).toBe('09:00');
  });

  it('builds on the newest local value while two saves are under way', () => {
    const p = createPendingValue<number | null>();
    p.start(1); // date
    p.start(2); // then time
    p.saved(1); // the first save's emit must not bring back 1
    expect(p.current(1)).toBe(2);
    p.settle(true, 1);
    expect(p.current(1)).toBe(2);
    p.settle(true, 2);
    expect(p.current(2)).toBe(2);
    expect(p.pending).toBe(false);
  });

  it('never gets stuck: a change from elsewhere after the save wins', () => {
    const p = createPendingValue<string[]>((a, b) => a.join() === b.join());
    p.start(['day']);
    p.settle(true, []); // saved, but its emit has not arrived yet
    expect(p.current([])).toEqual(['day']);
    p.saved(['hour']); // a newer edit from another device
    expect(p.pending).toBe(false);
    expect(p.current(['hour'])).toEqual(['hour']);
  });

  it('a failed save gives the saved value back', () => {
    const p = createPendingValue<string>();
    p.start('12:00');
    p.settle(false, '09:00');
    expect(p.pending).toBe(false);
    expect(p.current('09:00')).toBe('09:00');
  });

  it('tells its listener when what is shown changes', () => {
    let calls = 0;
    const p = createPendingValue<string>(Object.is, () => calls++);
    p.start('a');
    p.settle(false, 'x');
    expect(calls).toBe(2);
  });
});
