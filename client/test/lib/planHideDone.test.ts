/** Hiding done activities from the timeline, a device setting (docs/plan/PRD.md FR-162). */
import { describe, expect, it } from 'vitest';
import { readHideDone, saveHideDone } from '../../src/lib/planHideDone';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('hide done activities', () => {
  it('is off the first time, for an unknown stored value and with blocked storage', () => {
    expect(readHideDone(memoryStorage())).toBe(false);
    expect(readHideDone(memoryStorage({ 'todoness.plan.hideDone': 'maybe' }))).toBe(false);
    expect(readHideDone(undefined)).toBe(false);
    expect(
      readHideDone({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {},
      }),
    ).toBe(false);
  });

  it('remembers the choice', () => {
    const s = memoryStorage();
    saveHideDone(s, true);
    expect(readHideDone(s)).toBe(true);
    expect(s.data.get('todoness.plan.hideDone')).toBe('1');
    saveHideDone(s, false);
    expect(readHideDone(s)).toBe(false);
  });
});
