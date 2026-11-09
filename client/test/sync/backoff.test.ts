import { describe, expect, it } from 'vitest';
import { nextDelay } from '../../src/sync/backoff';

describe('nextDelay', () => {
  const mid = () => 0.5; // no random variation

  it('doubles from one second', () => {
    expect([0, 1, 2].map((n) => nextDelay(n, mid))).toEqual([1000, 2000, 4000]);
  });

  it('stops growing at five seconds', () => {
    expect(nextDelay(3, mid)).toBe(5000);
    expect(nextDelay(50, mid)).toBe(5000);
  });

  it('never exceeds five seconds, even with the highest random variation', () => {
    expect(nextDelay(3, () => 1)).toBe(5000);
    expect(nextDelay(50, () => 1)).toBe(5000);
  });

  it('varies by up to 20% either way below the cap', () => {
    expect(nextDelay(1, () => 0)).toBe(1600);
    expect(nextDelay(1, () => 1)).toBe(2400);
    for (let i = 0; i < 200; i++) {
      const d = nextDelay(2);
      expect(d).toBeGreaterThanOrEqual(3200);
      expect(d).toBeLessThanOrEqual(4800);
    }
  });

  it('never returns less than 0.8 seconds even for strange input', () => {
    expect(nextDelay(-5, () => 0)).toBeGreaterThanOrEqual(800);
    expect(Number.isFinite(nextDelay(1e9, mid))).toBe(true);
  });
});
