/** Activity groups: the tree, a group's dates and links to and from groups (docs/plan/PRD.md section 11). */
import { describe, expect, it } from 'vitest';
import { formatHlc } from '../src/hlc';
import { newId } from '../src/id';
import { applyOp } from '../src/merge';
import {
  GROUP_DEPTH_MAX,
  brokenLinks,
  depthOf,
  earliestStart,
  heightOf,
  leavesOf,
  liveLinks,
  planTree,
  schedulePlan,
  spansOf,
  wouldLoop,
  type Scheduled,
} from '../src/plan';
import { syncOpSchema, type Activity } from '../src/schemas';

/** An activity in March 2026, optionally part of `parentId`. */
const act = (
  id: string,
  march: number,
  days: number,
  parentId: string | null = null,
  dependsOn: string[] = [],
): Scheduled => ({
  id,
  planId: 'p',
  start: `2026-03-${String(march).padStart(2, '0')}`,
  days,
  dependsOn,
  parentId,
  deletedAt: null,
});
const starts = (m: Map<string, string>) => Object.fromEntries(m);

describe('parentId on activities (FR-174)', () => {
  const T0 = 1_730_822_400_000;
  const base = {
    opId: newId(),
    entity: 'activity',
    entityId: newId(T0),
    hlc: formatHlc({ wall: T0, counter: 0, clientId: 'a' }),
  };

  it('is accepted on create and update, null clears it', () => {
    const create = {
      ...base,
      type: 'create',
      patch: { planId: newId(), name: 'A', start: '2026-03-01', orderKey: 'a0', parentId: newId() },
    };
    expect(syncOpSchema.safeParse(create).success).toBe(true);
    expect(
      syncOpSchema.safeParse({ ...base, type: 'update', patch: { parentId: null } }).success,
    ).toBe(true);
    expect(
      syncOpSchema.safeParse({ ...base, type: 'update', patch: { parentId: 'not an id' } }).success,
    ).toBe(false);
  });

  it('defaults to null', () => {
    const r = applyOp<Activity>(undefined, {
      ...base,
      type: 'create',
      patch: { planId: newId(), name: 'A', start: '2026-03-01', orderKey: 'a0' },
    } as never);
    expect(r.ok && r.row.parentId).toBe(null);
  });
});

describe('planTree', () => {
  it('gives parents and children in the given order', () => {
    const tree = planTree([act('g', 1, 1), act('b', 2, 1, 'g'), act('a', 1, 1, 'g'), act('c', 1, 1)]);
    expect(tree.parent.get('a')).toBe('g');
    expect(tree.parent.has('c')).toBe(false);
    expect(tree.children.get('g')).toEqual(['b', 'a']);
  });

  it('ignores unknown, deleted, other-plan and own parents', () => {
    const tree = planTree([
      act('a', 1, 1, 'ghost'),
      { ...act('gone', 1, 1), deletedAt: 5 },
      act('b', 1, 1, 'gone'),
      { ...act('far', 1, 1), planId: 'other' },
      act('c', 1, 1, 'far'),
      act('d', 1, 1, 'd'),
    ]);
    expect(tree.parent.size).toBe(0);
  });

  it('breaks a loop made by two devices the same way whatever the order', () => {
    const loop = [act('a', 1, 1, 'b'), act('b', 1, 1, 'a')];
    const one = planTree(loop);
    expect(one.parent.size).toBe(1);
    expect([...planTree([...loop].reverse()).parent]).toEqual([...one.parent]);
  });

  it('gives depth (top level = 1), height (an activity = 1) and leaves', () => {
    const list = [act('g', 1, 1), act('h', 1, 1, 'g'), act('a', 1, 2, 'h'), act('b', 5, 1, 'g')];
    const tree = planTree(list);
    expect(depthOf(tree, 'g')).toBe(1);
    expect(depthOf(tree, 'a')).toBe(3);
    expect(heightOf(tree, 'g')).toBe(3);
    expect(heightOf(tree, 'b')).toBe(1);
    expect(leavesOf(tree, 'g')).toEqual(['a', 'b']);
    expect(leavesOf(tree, 'b')).toEqual(['b']);
    expect(GROUP_DEPTH_MAX).toBe(4);
  });
});

describe('spansOf (FR-175)', () => {
  it("runs a group from its earliest child start to its latest child end, whatever it stores", () => {
    const list = [
      act('g', 20, 1),
      act('h', 25, 9, 'g'),
      act('a', 3, 2, 'h'), // 3 – 4
      act('b', 6, 4, 'g'), // 6 – 9
      act('c', 1, 1),
    ];
    const spans = spansOf(list);
    expect(spans.get('h')).toEqual({ start: '2026-03-03', days: 2 });
    expect(spans.get('g')).toEqual({ start: '2026-03-03', days: 7 });
    expect(spans.get('c')).toEqual({ start: '2026-03-01', days: 1 });
  });

  it('an activity whose children are all deleted is an ordinary one again', () => {
    const list = [act('g', 20, 2), { ...act('a', 3, 2, 'g'), deletedAt: 9 }];
    expect(spansOf(list).get('g')).toEqual({ start: '2026-03-20', days: 2 });
  });
});

describe('links and groups (FR-183)', () => {
  it('A → group pushes every activity in the group after A', () => {
    const list = [
      act('x', 1, 5), // 1 – 5
      act('g', 1, 1, null, ['x']),
      act('a', 2, 2, 'g'),
      act('b', 8, 1, 'g'),
    ];
    expect(starts(schedulePlan(list))).toEqual({ a: '2026-03-06' });
  });

  it('group → B waits for the last activity in the group, and never moves the group itself', () => {
    const list = [
      act('g', 30, 1),
      act('a', 1, 2, 'g'),
      act('b', 3, 5, 'g'), // ends on the 7th
      act('y', 4, 1, null, ['g']),
    ];
    expect(starts(schedulePlan(list))).toEqual({ y: '2026-03-08' });
  });

  it('a link between a group and an activity inside it does not count and would loop', () => {
    const list = [act('g', 1, 1, null, ['a']), act('a', 1, 2, 'g'), act('b', 5, 1, 'g')];
    expect(liveLinks(list)).toEqual([]);
    expect(wouldLoop(list, 'g', 'a')).toBe(true);
    expect(wouldLoop(list, 'a', 'g')).toBe(true);
  });

  it('finds loops through groups', () => {
    // b is in g; b → x; x → g would make x wait for b, which waits for x.
    const list = [act('g', 1, 1), act('b', 1, 1, 'g', []), act('x', 3, 1, null, ['b'])];
    expect(wouldLoop(list, 'x', 'g')).toBe(true);
    expect(wouldLoop(list, 'x', 'b')).toBe(true);
    // A stored loop through a group: one link is dropped, the same on every device.
    const stored = [act('g', 1, 1, null, ['x']), act('b', 1, 1, 'g'), act('x', 3, 1, null, ['b'])];
    expect(liveLinks(stored)).toHaveLength(1);
    expect(liveLinks([...stored].reverse())).toEqual(liveLinks(stored));
  });

  it('a link is broken by the dates of the group', () => {
    const list = [act('g', 9, 1), act('a', 1, 5, 'g'), act('y', 4, 1, null, ['g'])];
    expect(brokenLinks(list)).toEqual([{ from: 'g', to: 'y' }]);
  });
});

describe('earliestStart of a group (FR-182)', () => {
  it('is the first day the whole group may start so that each activity still waits for its predecessors', () => {
    const list = [
      act('x', 1, 4), // free from the 5th
      act('g', 1, 1),
      act('a', 2, 2, 'g'), // starts first
      act('b', 6, 1, 'g', ['x']), // 4 days after the group's start; must start on the 5th or later
    ];
    // b may start on the 5th at the earliest, so the group (starting 4 days before b) on the 1st.
    expect(earliestStart(list, 'g')).toBe('2026-03-01');
    expect(earliestStart(list, 'a')).toBeNull();
  });

  it('counts links to the group and ignores links between its own activities', () => {
    const list = [
      act('x', 1, 9), // free from the 10th
      act('g', 1, 1, null, ['x']),
      act('a', 12, 2, 'g'),
      act('b', 14, 1, 'g', ['a']),
    ];
    expect(earliestStart(list, 'g')).toBe('2026-03-10');
    expect(earliestStart(list, 'a')).toBe('2026-03-10');
    expect(earliestStart(list, 'b')).toBe('2026-03-14');
  });
});
