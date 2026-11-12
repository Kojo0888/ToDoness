/** Where activity names are shown (docs/plan/PRD.md FR-140, FR-141). */
import { describe, expect, it } from 'vitest';
import { NAME_MODES, readNameMode, saveNameMode } from '../../src/lib/planNames';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('name position', () => {
  it('offers on the block, after the block and a column', () => {
    expect(NAME_MODES).toEqual(['on', 'after', 'column']);
  });

  it('is "on" the first time, and for an unknown stored value or blocked storage', () => {
    expect(readNameMode(memoryStorage())).toBe('on');
    expect(readNameMode(memoryStorage({ 'todoness.plan.names': 'sideways' }))).toBe('on');
    expect(readNameMode(undefined)).toBe('on');
    expect(
      readNameMode({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {},
      }),
    ).toBe('on');
  });

  it('remembers the choice', () => {
    const s = memoryStorage();
    saveNameMode(s, 'column');
    expect(readNameMode(s)).toBe('column');
    expect(s.data.get('todoness.plan.names')).toBe('column');
  });
});
