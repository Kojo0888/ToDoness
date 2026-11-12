/** Double click or double tap on a block (docs/plan/PRD.md FR-154). */
import { describe, expect, it } from 'vitest';
import { createDoubleTap } from '../../src/lib/doubleTap';

describe('createDoubleTap', () => {
  it('is true for the second click on the same thing within the time', () => {
    const tap = createDoubleTap(400);
    expect(tap('a', 1000)).toBe(false);
    expect(tap('a', 1300)).toBe(true);
  });

  it('a third click starts again: two double clicks need four clicks', () => {
    const tap = createDoubleTap(400);
    expect([1000, 1100, 1200, 1300].map((t) => tap('a', t))).toEqual([false, true, false, true]);
  });

  it('is false when too slow or on something else', () => {
    const tap = createDoubleTap(400);
    expect(tap('a', 1000)).toBe(false);
    expect(tap('a', 1500)).toBe(false);
    expect(tap('b', 1600)).toBe(false);
    expect(tap('a', 1700)).toBe(false);
  });

  it('can be reset (a drag in between)', () => {
    const tap = createDoubleTap(400);
    tap('a', 1000);
    tap.reset();
    expect(tap('a', 1100)).toBe(false);
  });
});
