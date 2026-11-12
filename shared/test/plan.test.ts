/** The `plan` and `activity` entities and the planning rules (docs/plan/PRD.md). */
import { describe, expect, it } from 'vitest';
import { formatHlc } from '../src/hlc';
import { newId } from '../src/id';
import { applyOp, type ApplyInput } from '../src/merge';
import {
  addDays,
  brokenLinks,
  dayNumber,
  dayOf,
  earliestStart,
  ignoredLinks,
  daysBetween,
  endDay,
  isDay,
  linkCandidates,
  liveLinks,
  localDay,
  schedulePlan,
  sortedActivityIds,
  wouldLoop,
  type Scheduled,
} from '../src/plan';
import {
  ACTIVITY_DAYS_MAX,
  ACTIVITY_LINKS_MAX,
  activitySchema,
  planSchema,
  pullChangeSchema,
  syncOpSchema,
  type Activity,
  type Plan,
} from '../src/schemas';

const T0 = 1_730_822_400_000;
const hlc = (wall: number, counter = 0, clientId = 'a') => formatHlc({ wall, counter, clientId });
const PLAN_ID = newId(T0);
const ACT_ID = newId(T0);

const op = (overrides: Record<string, unknown>) => ({
  opId: newId(),
  entity: 'activity',
  entityId: ACT_ID,
  type: 'update',
  patch: { name: 'Design' },
  hlc: hlc(T0),
  ...overrides,
});
const ok = (o: unknown) => syncOpSchema.safeParse(o).success;

describe('days', () => {
  it('accepts real calendar days only', () => {
    for (const d of ['2026-01-01', '2024-02-29', '1900-01-01', '2999-12-31']) {
      expect(isDay(d)).toBe(true);
    }
    for (const d of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-1', '26-01-01', '', 5]) {
      expect(isDay(d)).toBe(false);
    }
    expect(isDay('1899-12-31')).toBe(false);
    expect(isDay('3000-01-01')).toBe(false);
  });

  it('counts days across months, years and leap days', () => {
    expect(dayOf(dayNumber('2026-03-01'))).toBe('2026-03-01');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-10', -10)).toBe('2026-02-28');
    expect(daysBetween('2026-03-01', '2026-03-08')).toBe(7);
    expect(daysBetween('2026-03-08', '2026-03-01')).toBe(-7);
  });

  it('the end day is the last day of the duration', () => {
    expect(endDay('2026-03-01', 1)).toBe('2026-03-01');
    expect(endDay('2026-03-01', 3)).toBe('2026-03-03');
  });
});

describe('syncOpSchema – plans', () => {
  const planOp = (o: Record<string, unknown>) => op({ entity: 'plan', entityId: PLAN_ID, ...o });

  it('accepts create, update, delete and restore', () => {
    expect(ok(planOp({ type: 'create', patch: { name: 'Launch', orderKey: 'a0' } }))).toBe(true);
    expect(ok(planOp({ patch: { name: 'Launch 2' } }))).toBe(true);
    expect(ok(planOp({ patch: { orderKey: 'a1' } }))).toBe(true);
    expect(ok(planOp({ type: 'delete', patch: {} }))).toBe(true);
    expect(ok(planOp({ type: 'restore', patch: {} }))).toBe(true);
  });

  it('refuses a create without a name or order key, blank names and unknown fields', () => {
    expect(ok(planOp({ type: 'create', patch: { name: 'x' } }))).toBe(false);
    expect(ok(planOp({ type: 'create', patch: { orderKey: 'a0' } }))).toBe(false);
    for (const patch of [{}, { name: '  ' }, { name: 'x'.repeat(201) }, { isPublic: true }]) {
      expect(ok(planOp({ patch }))).toBe(false);
    }
    expect(ok(planOp({ patch: { userId: newId() } }))).toBe(false);
  });
});

describe('syncOpSchema – activities', () => {
  const create = { planId: PLAN_ID, name: 'Design', start: '2026-03-02', orderKey: 'a0' };

  it('accepts a create with the required fields, and with every field', () => {
    expect(ok(op({ type: 'create', patch: create }))).toBe(true);
    expect(ok(op({ type: 'create', patch: { ...create, days: 5, dependsOn: [newId()] } }))).toBe(
      true,
    );
  });

  it('refuses a create that misses a required field', () => {
    for (const key of ['planId', 'name', 'start', 'orderKey'] as const) {
      const { [key]: _, ...patch } = create;
      void _;
      expect(ok(op({ type: 'create', patch }))).toBe(false);
    }
  });

  it('accepts updates of each field', () => {
    for (const patch of [
      { name: 'Build' },
      { start: '2026-03-09' },
      { days: 1 },
      { days: ACTIVITY_DAYS_MAX },
      { dependsOn: [] },
      { dependsOn: [newId(), newId()] },
      { orderKey: 'a1' },
      { planId: newId() },
    ]) {
      expect(ok(op({ patch }))).toBe(true);
    }
  });

  it('refuses bad days, durations, links and unknown or protected fields', () => {
    for (const patch of [
      {},
      { start: '2026-02-30' },
      { start: 1_700_000_000_000 },
      { days: 0 },
      { days: 1.5 },
      { days: ACTIVITY_DAYS_MAX + 1 },
      { dependsOn: ['not-an-id'] },
      { dependsOn: Array.from({ length: ACTIVITY_LINKS_MAX + 1 }, () => newId()) },
      { name: '' },
      { name: 'x'.repeat(201) },
      { end: '2026-03-09' },
      { userId: newId() },
      { deletedAt: 1 },
    ]) {
      expect(ok(op({ patch }))).toBe(false);
    }
  });

  it('accepts delete and restore with an empty patch only', () => {
    expect(ok(op({ type: 'delete', patch: {} }))).toBe(true);
    expect(ok(op({ type: 'restore', patch: {} }))).toBe(true);
    expect(ok(op({ type: 'delete', patch: { name: 'x' } }))).toBe(false);
  });
});

describe('pullChangeSchema – plans and activities', () => {
  const change = (o: Record<string, unknown>) => ({
    serverSeq: 1,
    entityId: ACT_ID,
    type: 'update',
    hlc: hlc(T0),
    ...o,
  });

  it('parses pulled plan and activity changes, also deletes', () => {
    expect(
      pullChangeSchema.safeParse(change({ entity: 'plan', patch: { name: 'Launch' } })).success,
    ).toBe(true);
    expect(
      pullChangeSchema.safeParse(
        change({ entity: 'activity', patch: { start: '2026-03-02', days: 2, dependsOn: [] } }),
      ).success,
    ).toBe(true);
    expect(
      pullChangeSchema.safeParse(
        change({ entity: 'activity', type: 'delete', patch: { deletedAt: 5 } }),
      ).success,
    ).toBe(true);
  });
});

describe('applyOp – plans and activities', () => {
  const input = (o: Partial<ApplyInput>): ApplyInput => ({
    entity: 'activity',
    entityId: ACT_ID,
    type: 'create',
    patch: { planId: PLAN_ID, name: 'Design', start: '2026-03-02', orderKey: 'a0' },
    hlc: hlc(T0),
    ...o,
  });

  it('creates a plan', () => {
    const r = applyOp<Plan>(
      undefined,
      input({ entity: 'plan', entityId: PLAN_ID, patch: { name: 'Launch', orderKey: 'a0' } }),
    );
    expect(r.ok && planSchema.parse(r.row)).toMatchObject({ name: 'Launch', deletedAt: null });
  });

  it('creates an activity with one day and no links by default', () => {
    const r = applyOp<Activity>(undefined, input({}));
    expect(r.ok && activitySchema.parse(r.row)).toMatchObject({
      planId: PLAN_ID,
      name: 'Design',
      start: '2026-03-02',
      days: 1,
      dependsOn: [],
      done: false,
      deletedAt: null,
    });
  });

  it('done (Update 3, FR-153): pushed in a create or an update, pulled, a boolean only', () => {
    expect(ok(op({ patch: { done: true } }))).toBe(true);
    expect(ok(op({ patch: { done: 'yes' } }))).toBe(false);
    expect(
      ok(
        op({
          type: 'create',
          patch: { planId: PLAN_ID, name: 'D', start: '2026-03-02', orderKey: 'a0', done: true },
        }),
      ),
    ).toBe(true);
    expect(
      pullChangeSchema.safeParse({
        serverSeq: 1,
        entityId: ACT_ID,
        type: 'update',
        hlc: hlc(T0),
        entity: 'activity',
        patch: { done: false },
      }).success,
    ).toBe(true);
  });

  it('needs plan, name, start and order key to create', () => {
    for (const key of ['planId', 'name', 'start', 'orderKey']) {
      const patch: Record<string, unknown> = { ...input({}).patch };
      delete patch[key];
      expect(applyOp<Activity>(undefined, input({ patch }))).toEqual({
        ok: false,
        reason: 'missing_fields',
      });
    }
  });

  it('merges start and duration changed on two devices; the newer link list wins whole', () => {
    const created = applyOp<Activity>(undefined, input({}));
    if (!created.ok) throw new Error('create failed');
    const [x, y] = [newId(), newId()];
    let row = created.row;
    for (const [patch, at] of [
      [{ start: '2026-03-09', dependsOn: [x] }, 20],
      [{ days: 4, dependsOn: [y] }, 10],
    ] as const) {
      const r = applyOp<Activity>(row, input({ type: 'update', patch, hlc: hlc(T0 + at) }));
      if (!r.ok) throw new Error('update failed');
      row = r.row;
    }
    expect(row).toMatchObject({ start: '2026-03-09', days: 4, dependsOn: [x] });
  });
});

// ---------------------------------------------------------------------------
// Planning rules
// ---------------------------------------------------------------------------

/** `a: 1+3 <- b` style helper: an activity with a start in March 2026. */
const act = (id: string, march: number, days: number, dependsOn: string[] = []): Scheduled => ({
  id,
  planId: 'p',
  start: `2026-03-${String(march).padStart(2, '0')}`,
  days,
  dependsOn,
  deletedAt: null,
});
const starts = (m: Map<string, string>) => Object.fromEntries(m);

describe('liveLinks', () => {
  it('gives the links between live activities of one plan', () => {
    const links = liveLinks([act('a', 1, 2), act('b', 5, 1, ['a']), act('c', 9, 1, ['a', 'b'])]);
    expect(links).toEqual([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'c' },
    ]);
  });

  it('ignores unknown, deleted, other-plan, repeated and self links', () => {
    const links = liveLinks([
      act('a', 1, 2, ['a', 'ghost']),
      { ...act('gone', 1, 1), deletedAt: 5 },
      { ...act('far', 1, 1), planId: 'other' },
      act('b', 5, 1, ['a', 'a', 'gone', 'far']),
    ]);
    expect(links).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('drops the link that closes a loop, the same one on every device', () => {
    const loop = [act('a', 1, 1, ['c']), act('b', 2, 1, ['a']), act('c', 3, 1, ['b'])];
    const links = liveLinks(loop);
    expect(links).toHaveLength(2);
    expect(liveLinks([...loop].reverse())).toEqual(links);
  });
});

describe('wouldLoop', () => {
  const chain = [act('a', 1, 1), act('b', 2, 1, ['a']), act('c', 3, 1, ['b']), act('d', 4, 1)];

  it('is true for a link back up the chain and for a link to itself', () => {
    expect(wouldLoop(chain, 'c', 'a')).toBe(true);
    expect(wouldLoop(chain, 'b', 'a')).toBe(true);
    expect(wouldLoop(chain, 'a', 'a')).toBe(true);
  });

  it('is false for a link that only adds an order', () => {
    expect(wouldLoop(chain, 'a', 'c')).toBe(false);
    expect(wouldLoop(chain, 'd', 'a')).toBe(false);
    expect(wouldLoop(chain, 'c', 'd')).toBe(false);
  });
});

describe('schedulePlan (FR-136)', () => {
  it('changes nothing when every link is kept', () => {
    expect(starts(schedulePlan([act('a', 1, 2), act('b', 3, 1, ['a'])]))).toEqual({});
    expect(starts(schedulePlan([act('a', 1, 2), act('b', 20, 1, ['a'])]))).toEqual({});
  });

  it('pushes a successor to the day after its predecessor ends', () => {
    // a: 1 – 5, b started on the 3rd.
    expect(starts(schedulePlan([act('a', 1, 5), act('b', 3, 2, ['a'])]))).toEqual({
      b: '2026-03-06',
    });
  });

  it('pushes a whole chain, keeping durations', () => {
    const moved = schedulePlan([
      act('c', 4, 2, ['b']),
      act('a', 1, 5),
      act('b', 3, 3, ['a']), // -> 6 – 8
    ]);
    expect(starts(moved)).toEqual({ b: '2026-03-06', c: '2026-03-09' });
  });

  it('waits for the latest of several predecessors', () => {
    const moved = schedulePlan([act('a', 1, 2), act('b', 1, 9), act('c', 2, 1, ['a', 'b'])]);
    expect(starts(moved)).toEqual({ c: '2026-03-10' });
  });

  it('never pulls an activity earlier and ignores deleted predecessors', () => {
    const moved = schedulePlan([
      act('a', 1, 1),
      act('b', 15, 1, ['a']),
      { ...act('x', 1, 20), deletedAt: 9 },
      act('c', 2, 1, ['x']),
    ]);
    expect(starts(moved)).toEqual({});
  });

  it('ends on a loop', () => {
    const moved = schedulePlan([act('a', 1, 3, ['b']), act('b', 1, 3, ['a'])]);
    expect(moved.size).toBe(1);
  });
});

describe('brokenLinks (FR-139)', () => {
  it('lists the links whose successor starts before the predecessor has ended', () => {
    const list = [act('a', 1, 5), act('b', 5, 1, ['a']), act('c', 6, 1, ['a'])];
    expect(brokenLinks(list)).toEqual([{ from: 'a', to: 'b' }]);
  });
});

describe('earliestStart', () => {
  it('is the day after the latest predecessor ends, or nothing without predecessors', () => {
    const list = [act('a', 1, 2), act('b', 1, 9), act('c', 20, 1, ['a', 'b']), act('d', 1, 1)];
    expect(earliestStart(list, 'c')).toBe('2026-03-10');
    expect(earliestStart(list, 'd')).toBeNull();
    expect(earliestStart(list, 'nope')).toBeNull();
  });
});

describe('localDay', () => {
  it('is the calendar day of a moment on this device', () => {
    const d = new Date(2026, 2, 5, 23, 59);
    expect(localDay(d.getTime())).toBe('2026-03-05');
    expect(localDay(new Date(2026, 0, 1, 0, 0).getTime())).toBe('2026-01-01');
  });
});

describe('links computed once (review: performance)', () => {
  const list = [act('a', 1, 5), act('b', 3, 2, ['a']), act('c', 4, 1, ['b'])];

  it('schedulePlan, brokenLinks and earliestStart give the same answer with the links passed in', () => {
    const links = liveLinks(list);
    expect(starts(schedulePlan(list, links))).toEqual(starts(schedulePlan(list)));
    expect(brokenLinks(list, links)).toEqual(brokenLinks(list));
    expect(earliestStart(list, 'b', links)).toBe(earliestStart(list, 'b'));
  });

  it('use the links they are given (they do not depend on the days)', () => {
    expect(starts(schedulePlan(list, []))).toEqual({});
    expect(brokenLinks(list, [])).toEqual([]);
    expect(earliestStart(list, 'b', [])).toBeNull();
  });
});

describe('linkCandidates ("Starts after")', () => {
  it('offers what can still come before an activity: not itself, not linked, no loop', () => {
    const list = [
      act('a', 1, 1),
      act('b', 2, 1, ['a']),
      act('c', 3, 1, ['b']),
      act('d', 4, 1),
      { ...act('gone', 1, 1), deletedAt: 5 },
      { ...act('far', 1, 1), planId: 'other' },
    ];
    expect(linkCandidates(list, 'b')).toEqual(['d']); // a is linked, c would loop
    expect(linkCandidates(list, 'a')).toEqual(['d']); // b and c come after a
    expect(linkCandidates(list, 'd')).toEqual(['a', 'b', 'c']);
    expect(linkCandidates(list, 'nope')).toEqual([]);
  });

  it('goes by the links that count: a stored link that is ignored does not hide a candidate', () => {
    // b names a deleted activity and itself; neither is a link.
    const list = [act('a', 1, 1), act('b', 2, 1, ['b', 'ghost'])];
    expect(linkCandidates(list, 'b')).toEqual(['a']);
  });
});

describe('ignoredLinks', () => {
  it('lists stored links between live activities that are dropped as loop closers or self links', () => {
    const loop = [act('a', 1, 1, ['b', 'a']), act('b', 2, 1, ['a', 'ghost'])];
    // liveLinks keeps b → a (first by id) and drops a → b.
    expect(liveLinks(loop)).toEqual([{ from: 'b', to: 'a' }]);
    expect(ignoredLinks(loop)).toEqual([
      { from: 'a', to: 'a' },
      { from: 'a', to: 'b' },
    ]);
    expect(ignoredLinks([act('a', 1, 1), act('b', 2, 1, ['a'])])).toEqual([]);
  });
});

describe('sortedActivityIds (docs/plan-sort FR-189 – FR-191)', () => {
  const inGroup = (a: Scheduled, parentId: string): Scheduled => ({ ...a, parentId });

  it('sorts by start day; same-day activities keep their row order', () => {
    const rows = [act('c', 9, 1), act('a', 1, 1), act('b', 5, 1), act('d', 5, 2)];
    expect(sortedActivityIds(rows)).toEqual(['a', 'b', 'd', 'c']);
    expect(sortedActivityIds([act('x', 5, 1), act('y', 5, 1), act('z', 1, 1)])).toEqual([
      'z',
      'x',
      'y',
    ]);
  });

  it('ignores deleted activities', () => {
    const rows = [act('b', 5, 1), { ...act('gone', 1, 1), deletedAt: 1 }, act('a', 2, 1)];
    expect(sortedActivityIds(rows)).toEqual(['a', 'b']);
  });

  it('puts a predecessor above its successor even when the dates say otherwise', () => {
    // b is linked after a, but still starts earlier (a broken link).
    const rows = [act('b', 1, 1, ['a']), act('a', 5, 1)];
    expect(sortedActivityIds(rows)).toEqual(['a', 'b']);
    // also through a third activity, and without disturbing the others
    const chain = [act('c', 1, 1, ['b']), act('b', 2, 1, ['a']), act('a', 9, 1), act('x', 3, 1)];
    expect(sortedActivityIds(chain)).toEqual(['x', 'a', 'b', 'c']);
  });

  it('sorts the top level first and then the children inside every group', () => {
    const rows = [
      act('late', 20, 1),
      act('g2', 1, 1),
      inGroup(act('g2b', 12, 1), 'g2'),
      inGroup(act('g2a', 10, 1), 'g2'),
      act('g1', 1, 1),
      inGroup(act('g1b', 6, 1), 'g1'),
      inGroup(act('g1a', 5, 1), 'g1'),
      act('solo', 8, 1),
    ];
    // g1 starts day 5, solo day 8, g2 day 10, late day 20; children stay under their group.
    expect(sortedActivityIds(rows)).toEqual([
      'g1',
      'g1a',
      'g1b',
      'solo',
      'g2',
      'g2a',
      'g2b',
      'late',
    ]);
  });

  it('sorts nested groups at every depth', () => {
    const rows = [
      act('top', 1, 1),
      inGroup(act('mid', 1, 1), 'top'),
      inGroup(act('m2', 9, 1), 'top'),
      inGroup(act('deep2', 7, 1), 'mid'),
      inGroup(act('deep1', 3, 1), 'mid'),
    ];
    expect(sortedActivityIds(rows)).toEqual(['top', 'mid', 'deep1', 'deep2', 'm2']);
  });

  it('treats a link between activities of different groups as a link of their groups', () => {
    // inside g2, y must come after x which is in g1; g2 starts earlier than g1 by dates
    const rows = [
      act('g2', 1, 1),
      inGroup(act('y', 1, 1, ['x']), 'g2'),
      act('g1', 1, 1),
      inGroup(act('x', 4, 1), 'g1'),
    ];
    const order = sortedActivityIds(rows);
    expect(order.indexOf('g1')).toBeLessThan(order.indexOf('g2'));
  });

  it('does not fail on a loop between groups: it falls back to the dates', () => {
    const rows = [
      act('g1', 1, 1),
      inGroup(act('a1', 1, 1, []), 'g1'),
      inGroup(act('a2', 2, 1, ['b1']), 'g1'),
      act('g2', 1, 1),
      inGroup(act('b1', 3, 1, ['a1']), 'g2'),
      inGroup(act('b2', 4, 1), 'g2'),
    ];
    // a1 → b1 and b1 → a2 make g1 → g2 → g1 at group level
    expect(sortedActivityIds(rows).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'g1', 'g2']);
  });

  it('is the same when run again on its own result', () => {
    const rows = [act('c', 9, 1), act('a', 1, 1, ['c']), act('b', 5, 1)];
    const first = sortedActivityIds(rows);
    const again = sortedActivityIds(first.map((id) => rows.find((r) => r.id === id)!));
    expect(again).toEqual(first);
  });
});
