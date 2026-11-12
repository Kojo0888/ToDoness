/** The timeline's scale, a device setting (docs/plan/PRD.md FR-157). */
import { describe, expect, it } from 'vitest';
import { readScale, saveScale } from '../../src/lib/planScale';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('timeline scale', () => {
  it('is Days the first time, and for an unknown stored value or blocked storage', () => {
    expect(readScale(memoryStorage())).toBe('day');
    expect(readScale(memoryStorage({ 'todoness.plan.scale': 'decade' }))).toBe('day');
    expect(readScale(undefined)).toBe('day');
    expect(
      readScale({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {},
      }),
    ).toBe('day');
  });

  it('remembers the choice', () => {
    const s = memoryStorage();
    saveScale(s, 'month');
    expect(readScale(s)).toBe('month');
    expect(s.data.get('todoness.plan.scale')).toBe('month');
  });
});
