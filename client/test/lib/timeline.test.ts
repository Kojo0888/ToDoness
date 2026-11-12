/** Geometry of the plan timeline (docs/plan/ImplementationPlan.md, "Timeline"). */
import { describe, expect, it } from 'vitest';
import { ACTIVITY_DAYS_MAX } from '@todoness/shared';
import {
  DAY_WIDTH,
  BLOCK_INSET,
  ROW_HEIGHT,
  arrowPath,
  arrowTip,
  blockBox,
  dayAtX,
  dragResult,
  monthSpans,
  nudge,
  timelineRange,
  weekShift,
} from '../../src/lib/timeline';

const TODAY = '2026-03-10';

describe('timelineRange (FR-125)', () => {
  it('an empty plan shows today with spare days around it', () => {
    expect(timelineRange([], TODAY)).toEqual({ first: '2026-03-07', days: 35 });
  });

  it('covers every activity and today: 3 days before the earliest, 14 after the latest', () => {
    const r = timelineRange(
      [
        { start: '2026-02-01', days: 2 },
        { start: '2026-04-20', days: 11 }, // ends 30 April
      ],
      TODAY,
    );
    expect(r.first).toBe('2026-01-29');
    // 29 Jan … 14 May
    expect(r.days).toBe(3 + 31 + 30 + 14 + 28);
  });

  it('includes today when all activities are in the past or the future', () => {
    expect(timelineRange([{ start: '2026-06-01', days: 1 }], TODAY).first).toBe('2026-03-07');
    const past = timelineRange([{ start: '2026-01-01', days: 1 }], TODAY);
    expect(past.first).toBe('2025-12-29');
    expect(past.days).toBe(3 + 31 + 28 + 10 + 14);
  });
});

describe('blockBox and dayAtX', () => {
  const range = { first: '2026-03-01', days: 40 };

  it('a block spans from the left edge of its start day to the right edge of its end day', () => {
    expect(blockBox({ start: '2026-03-01', days: 1 }, range)).toEqual({
      left: 0,
      width: DAY_WIDTH,
    });
    expect(blockBox({ start: '2026-03-04', days: 3 }, range)).toEqual({
      left: 3 * DAY_WIDTH,
      width: 3 * DAY_WIDTH,
    });
  });

  it('finds the day under a position', () => {
    expect(dayAtX(range, 0)).toBe('2026-03-01');
    expect(dayAtX(range, DAY_WIDTH - 1)).toBe('2026-03-01');
    expect(dayAtX(range, DAY_WIDTH)).toBe('2026-03-02');
    expect(dayAtX(range, -1)).toBe('2026-02-28');
  });
});

describe('dragResult (FR-127, FR-128)', () => {
  const a = { start: '2026-03-10', days: 3 };

  it('moving keeps the duration', () => {
    expect(dragResult('move', a, 2)).toEqual({ start: '2026-03-12', days: 3 });
    expect(dragResult('move', a, -10)).toEqual({ start: '2026-02-28', days: 3 });
  });

  it('a move stops at the earliest allowed day', () => {
    expect(dragResult('move', a, -5, '2026-03-08')).toEqual({ start: '2026-03-08', days: 3 });
    expect(dragResult('move', a, 5, '2026-03-08')).toEqual({ start: '2026-03-15', days: 3 });
  });

  it('resizing changes the duration, between one day and the maximum', () => {
    expect(dragResult('resize', a, 4)).toEqual({ start: '2026-03-10', days: 7 });
    expect(dragResult('resize', a, -1)).toEqual({ start: '2026-03-10', days: 2 });
    expect(dragResult('resize', a, -9)).toEqual({ start: '2026-03-10', days: 1 });
    expect(dragResult('resize', a, 99_999).days).toBe(ACTIVITY_DAYS_MAX);
  });
});

describe('arrowPath and arrowTip (FR-135)', () => {
  const top = (row: number) => row * ROW_HEIGHT + BLOCK_INSET;
  const bottom = (row: number) => (row + 1) * ROW_HEIGHT - BLOCK_INSET;
  const middle = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;
  /** The points of a path made of M / H / V commands. */
  function points(d: string) {
    const out: [number, number][] = [];
    let x = 0;
    let y = 0;
    for (const [, cmd, args] of d.matchAll(/([MHV])\s*([-\d.\s]+)/g)) {
      const n = args!.trim().split(/\s+/).map(Number);
      if (cmd === 'H') x = n[0]!;
      else if (cmd === 'V') y = n[0]!;
      else [x, y] = n as [number, number];
      out.push([x, y]);
    }
    return out;
  }

  it('is one straight vertical line when the next activity starts where this one ends', () => {
    const down = points(arrowPath({ x: 108, row: 0 }, { x: 108, row: 1 }));
    expect(down).toEqual([
      [108, bottom(0)],
      [108, top(1)],
    ]);
    // Also over several rows, and upwards.
    expect(points(arrowPath({ x: 108, row: 0 }, { x: 108, row: 3 }))).toEqual([
      [108, bottom(0)],
      [108, top(3)],
    ]);
    expect(points(arrowPath({ x: 108, row: 2 }, { x: 108, row: 0 }))).toEqual([
      [108, top(2)],
      [108, bottom(0)],
    ]);
  });

  it('goes along its own row and turns down at the start of a later activity', () => {
    // Through the upper right corner: sideways first, then down into the block.
    expect(points(arrowPath({ x: 100, row: 0 }, { x: 280, row: 2 }))).toEqual([
      [100, middle(0)],
      [280, middle(0)],
      [280, top(2)],
    ]);
    expect(points(arrowPath({ x: 100, row: 3 }, { x: 280, row: 1 }))).toEqual([
      [100, middle(3)],
      [280, middle(3)],
      [280, bottom(1)],
    ]);
  });

  it('goes around when the target starts before the source ends (a broken link)', () => {
    const p = points(arrowPath({ x: 300, row: 0 }, { x: 100, row: 2 }));
    expect(p[0]).toEqual([300, middle(0)]);
    expect(p[1]![0]).toBeGreaterThan(300); // leaves to the right
    expect(p.at(-1)).toEqual([100, top(2)]);
    expect(p.at(-2)).toEqual([100, 2 * ROW_HEIGHT]); // comes in along the row border
  });

  it('the head sits on the edge of the target block and points into it', () => {
    expect(arrowTip({ x: 100, row: 0 }, { x: 280, row: 2 })).toEqual({
      x: 280,
      y: top(2),
      down: true,
    });
    expect(arrowTip({ x: 100, row: 3 }, { x: 280, row: 1 })).toEqual({
      x: 280,
      y: bottom(1),
      down: false,
    });
  });
});

describe('monthSpans', () => {
  it('splits the range into months', () => {
    expect(monthSpans({ first: '2026-01-29', days: 3 + 28 + 5 })).toEqual([
      { month: '2026-01', index: 0, days: 3 },
      { month: '2026-02', index: 3, days: 28 },
      { month: '2026-03', index: 31, days: 5 },
    ]);
  });
});

describe('nudge (keyboard, FR-132)', () => {
  const a = { start: '2026-03-10', days: 3 };

  it('moves by a day, or changes the duration by a day', () => {
    expect(nudge(a, 1, false)).toEqual({ start: '2026-03-11' });
    expect(nudge(a, -1, false)).toEqual({ start: '2026-03-09' });
    expect(nudge(a, 1, true)).toEqual({ days: 4 });
    expect(nudge(a, -1, true)).toEqual({ days: 2 });
  });

  it('keeps the duration between one day and the maximum (review: Shift + ArrowRight)', () => {
    expect(nudge({ ...a, days: 1 }, -1, true)).toEqual({ days: 1 });
    expect(nudge({ ...a, days: ACTIVITY_DAYS_MAX }, 1, true)).toEqual({ days: ACTIVITY_DAYS_MAX });
  });
});

describe('weekShift (weekend shading as one background)', () => {
  it('says how many days after a Monday the grid starts', () => {
    expect(weekShift('2026-03-09')).toBe(0); // a Monday
    expect(weekShift('2026-03-10')).toBe(1);
    expect(weekShift('2026-03-14')).toBe(5); // Saturday
    expect(weekShift('2026-03-15')).toBe(6); // Sunday
    expect(weekShift('1969-12-29')).toBe(0); // before 1970 too
  });
});
