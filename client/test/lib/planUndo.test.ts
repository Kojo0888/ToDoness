/** What a change did to a plan (docs/plan/PRD.md FR-147). */
import { describe, expect, it } from 'vitest';
import { diffActivities } from '../../src/lib/planUndo';

const a = { id: 'a', start: '2026-03-01', days: 2, dependsOn: [] as string[], done: false };
const b = { id: 'b', start: '2026-03-03', days: 3, dependsOn: ['a'], done: false };

describe('diffActivities', () => {
  it('is empty when nothing changed', () => {
    expect(diffActivities([a, b], [a, { ...b, dependsOn: ['a'] }])).toEqual([]);
  });

  it('keeps only the activities and fields that changed, with the value before and after', () => {
    const after = [
      { ...a, days: 5 },
      { ...b, start: '2026-03-06', dependsOn: [] },
    ];
    expect(diffActivities([a, b], after)).toEqual([
      { id: 'a', before: { days: 2 }, after: { days: 5 } },
      {
        id: 'b',
        before: { start: '2026-03-03', dependsOn: ['a'] },
        after: { start: '2026-03-06', dependsOn: [] },
      },
    ]);
  });

  it('ignores activities that were added or went away', () => {
    const c = { id: 'c', start: '2026-03-09', days: 1, dependsOn: [], done: false };
    expect(diffActivities([a, b], [a, c])).toEqual([]);
  });

  it('covers done (a double click, PRD FR-154)', () => {
    expect(diffActivities([a, b], [{ ...a, done: true }, b])).toEqual([
      { id: 'a', before: { done: false }, after: { done: true } },
    ]);
  });
});
