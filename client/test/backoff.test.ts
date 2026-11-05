import { describe, expect, it } from 'vitest';
import { nextDelay } from '../src/sync/backoff';

describe('nextDelay', () => {
  const mid = () => 0.5; // no random variation

  it('doubles from one second', () => {
    expect([0, 1, 2, 3, 4].map((n) => nextDelay(n, mid))).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it('stops growing at five minutes', () => {
    expect(nextDelay(8, mid)).toBe(256_000);
    expect(nextDelay(9, mid)).toBe(300_000);
    expect(nextDelay(50, mid)).toBe(300_000);
  });

  it('varies by up to 20% either way', () => {
    expect(nextDelay(2, () => 0)).toBe(3200);
    expect(nextDelay(2, () => 1)).toBe(4800);
    for (let i = 0; i < 200; i++) {
      const d = nextDelay(3);
      expect(d).toBeGreaterThanOrEqual(6400);
      expect(d).toBeLessThanOrEqual(9600);
    }
  });

  it('never returns less than one second even for strange input', () => {
    expect(nextDelay(-5, () => 0)).toBeGreaterThanOrEqual(800);
    expect(Number.isFinite(nextDelay(1e9, mid))).toBe(true);
  });
});
