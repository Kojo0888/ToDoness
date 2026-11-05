import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/auth/rate-limit';

describe('createRateLimiter', () => {
  const MIN = 60_000;

  it('allows up to max failures, then blocks', () => {
    const t = 0;
    const rl = createRateLimiter({ max: 3, windowMs: 15 * MIN, now: () => t });
    for (let i = 0; i < 3; i++) {
      expect(rl.check('k').allowed).toBe(true);
      rl.fail('k');
    }
    const r = rl.check('k');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(15 * 60);
  });

  it('counts keys separately', () => {
    const rl = createRateLimiter({ max: 1, windowMs: MIN, now: () => 0 });
    rl.fail('a');
    expect(rl.check('a').allowed).toBe(false);
    expect(rl.check('b').allowed).toBe(true);
  });

  it('forgets failures after the window', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 2, windowMs: MIN, now: () => t });
    rl.fail('k');
    t = 30_000;
    rl.fail('k');
    expect(rl.check('k').allowed).toBe(false);
    t = MIN + 1; // the first failure has expired, one remains
    expect(rl.check('k').allowed).toBe(true);
    t = 2 * MIN; // both expired
    rl.fail('k');
    expect(rl.check('k').allowed).toBe(true);
  });

  it('reset clears a key', () => {
    const rl = createRateLimiter({ max: 1, windowMs: MIN, now: () => 0 });
    rl.fail('k');
    rl.reset('k');
    expect(rl.check('k').allowed).toBe(true);
  });

  it('does not grow without limit', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 5, windowMs: MIN, now: () => t, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.fail(`k${i}`);
    expect(rl.size()).toBeLessThanOrEqual(100);
    t = 10 * MIN;
    rl.fail('x');
    expect(rl.size()).toBeLessThanOrEqual(100);
  });
});
