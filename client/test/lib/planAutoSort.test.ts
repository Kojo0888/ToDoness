/** Auto sort of a plan's rows, a device setting (docs/plan-sort FR-193, FR-194). */
import { describe, expect, it } from 'vitest';
import { readAutoSort, saveAutoSort } from '../../src/lib/planAutoSort';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('auto sort', () => {
  it('is off the first time, for an unknown stored value and with blocked storage', () => {
    expect(readAutoSort(memoryStorage())).toBe(false);
    expect(readAutoSort(memoryStorage({ 'todoness.plan.autoSort': 'maybe' }))).toBe(false);
    expect(readAutoSort(undefined)).toBe(false);
    expect(
      readAutoSort({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {},
      }),
    ).toBe(false);
  });

  it('remembers the choice', () => {
    const s = memoryStorage();
    saveAutoSort(s, true);
    expect(readAutoSort(s)).toBe(true);
    saveAutoSort(s, false);
    expect(readAutoSort(s)).toBe(false);
  });

  it('does not throw when storage is blocked', () => {
    expect(() =>
      saveAutoSort(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('blocked');
          },
        },
        true,
      ),
    ).not.toThrow();
  });
});
