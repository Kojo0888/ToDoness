/** Which groups of a plan are collapsed, a device setting per plan (docs/plan/PRD.md FR-181). */
import { describe, expect, it } from 'vitest';
import { readCollapsed, saveCollapsed } from '../../src/lib/planCollapsed';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('collapsed groups', () => {
  it('none the first time, for a broken stored value and with blocked storage', () => {
    expect(readCollapsed(memoryStorage(), 'p1').size).toBe(0);
    expect(readCollapsed(memoryStorage({ 'todoness.plan.collapsed.p1': '{nope' }), 'p1').size).toBe(
      0,
    );
    expect(readCollapsed(memoryStorage({ 'todoness.plan.collapsed.p1': '[1,2]' }), 'p1').size).toBe(
      0,
    );
    expect(readCollapsed(undefined, 'p1').size).toBe(0);
    expect(
      readCollapsed(
        {
          getItem: () => {
            throw new Error('blocked');
          },
          setItem: () => {},
        },
        'p1',
      ).size,
    ).toBe(0);
  });

  it('remembers the groups per plan', () => {
    const s = memoryStorage();
    saveCollapsed(s, 'p1', new Set(['g1', 'g2']));
    saveCollapsed(s, 'p2', new Set(['g3']));
    expect([...readCollapsed(s, 'p1')].sort()).toEqual(['g1', 'g2']);
    expect([...readCollapsed(s, 'p2')]).toEqual(['g3']);
    saveCollapsed(s, 'p1', new Set());
    expect(readCollapsed(s, 'p1').size).toBe(0);
  });
});
