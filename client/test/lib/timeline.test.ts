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
  dayWidth,
  headerUnits,
  MIN_BLOCK,
  SCALES,
  unitSpans,
  dragResult,
  HIDDEN_MARK,
  hiddenMark,
  hiddenPredecessors,
  isOverdue,
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

describe('arrowPath and arrowTip (FR-148: straight)', () => {
  const top = (row: number) => row * ROW_HEIGHT + BLOCK_INSET;
  const bottom = (row: number) => (row + 1) * ROW_HEIGHT - BLOCK_INSET;
  /** The points of a path made of M / L commands. */
  const points = (d: string) =>
    [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

  it('is one straight line from the end corner of the source to the start corner of the target', () => {
    const d = arrowPath({ x: 100, row: 0 }, { x: 280, row: 2 });
    expect(d).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/);
    expect(points(d)).toEqual([
      [100, bottom(0)],
      [280, top(2)],
    ]);
  });

  it('is vertical when the next activity starts where this one ends', () => {
    expect(points(arrowPath({ x: 108, row: 0 }, { x: 108, row: 1 }))).toEqual([
      [108, bottom(0)],
      [108, top(1)],
    ]);
  });

  it('goes up from the top corner into the bottom corner of a target in a row above', () => {
    expect(points(arrowPath({ x: 100, row: 3 }, { x: 280, row: 1 }))).toEqual([
      [100, top(3)],
      [280, bottom(1)],
    ]);
  });

  it('a broken link is the same straight line, backwards', () => {
    expect(points(arrowPath({ x: 300, row: 0 }, { x: 100, row: 2 }))).toEqual([
      [300, bottom(0)],
      [100, top(2)],
    ]);
  });

  it('the head sits on the target corner and points along the line', () => {
    expect(arrowTip({ x: 108, row: 0 }, { x: 108, row: 1 })).toEqual({
      x: 108,
      y: top(1),
      angle: 90,
    });
    expect(arrowTip({ x: 108, row: 2 }, { x: 108, row: 0 }).angle).toBe(-90);
    const tip = arrowTip({ x: 100, row: 0 }, { x: 100 + (top(1) - bottom(0)), row: 1 });
    expect(tip.angle).toBeCloseTo(45);
  });
});

describe('scales (FR-157)', () => {
  it('a day is 36, 12, 4 or 0.6 pixels wide', () => {
    expect(SCALES).toEqual(['day', 'week', 'month', 'year']);
    expect(dayWidth('day')).toBe(DAY_WIDTH);
    expect(dayWidth('week')).toBe(12);
    expect(dayWidth('month')).toBe(4);
    expect(dayWidth('year')).toBe(0.6);
  });

  it('the Days range is unchanged', () => {
    expect(timelineRange([], TODAY, 'day')).toEqual(timelineRange([], TODAY));
  });

  it('the Weeks range starts on a Monday and holds whole weeks', () => {
    const r = timelineRange([{ start: '2026-03-10', days: 3 }], TODAY, 'week');
    expect(weekShift(r.first)).toBe(0);
    expect(r.first <= '2026-03-03').toBe(true);
    expect(r.days % 7).toBe(0);
    expect(r.days).toBeGreaterThanOrEqual(16 * 7);
  });

  it('the Months range starts on the 1st and ends at the end of a month', () => {
    const r = timelineRange([{ start: '2026-03-10', days: 3 }], TODAY, 'month');
    expect(r.first).toBe('2026-02-01');
    const last = unitSpans(r, 'month').at(-1)!;
    expect(last.index + last.days).toBe(r.days);
    expect(unitSpans(r, 'month').length).toBeGreaterThanOrEqual(12);
  });

  it('the Years range starts on 1 January and covers whole years', () => {
    const r = timelineRange([{ start: '2027-11-10', days: 100 }], TODAY, 'year');
    expect(r.first).toBe('2026-01-01');
    expect(unitSpans(r, 'year').map((u) => u.start)).toEqual([
      '2026-01-01',
      '2027-01-01',
      '2028-01-01',
    ]);
  });

  it('blocks scale with the day width, but are never narrower than 12 px', () => {
    const range = { first: '2026-01-01', days: 365 };
    expect(blockBox({ start: '2026-01-08', days: 14 }, range, 'week')).toEqual({
      left: 7 * 12,
      width: 14 * 12,
    });
    expect(blockBox({ start: '2026-01-11', days: 3 }, range, 'year')).toEqual({
      left: 10 * 0.6,
      width: MIN_BLOCK,
    });
    expect(MIN_BLOCK).toBe(12);
    expect(dayAtX(range, 12 * 7, 'week')).toBe('2026-01-08');
  });

  it('header cells: two rows of units per scale', () => {
    expect(headerUnits('day')).toEqual(['month', 'day']);
    expect(headerUnits('week')).toEqual(['month', 'week']);
    expect(headerUnits('month')).toEqual(['year', 'month']);
    expect(headerUnits('year')).toEqual(['year', 'quarter']);
  });

  it('unitSpans cuts the range into weeks, months, quarters and years', () => {
    const range = { first: '2026-03-04', days: 14 }; // Wed 4 – Tue 17 March
    expect(unitSpans(range, 'week')).toEqual([
      { start: '2026-03-02', index: 0, days: 5 },
      { start: '2026-03-09', index: 5, days: 7 },
      { start: '2026-03-16', index: 12, days: 2 },
    ]);
    expect(unitSpans({ first: '2026-03-30', days: 3 }, 'day').map((u) => u.start)).toEqual([
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
    ]);
    expect(unitSpans({ first: '2026-01-01', days: 365 }, 'quarter')).toEqual([
      { start: '2026-01-01', index: 0, days: 90 },
      { start: '2026-04-01', index: 90, days: 91 },
      { start: '2026-07-01', index: 181, days: 92 },
      { start: '2026-10-01', index: 273, days: 92 },
    ]);
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

describe('isOverdue (FR-161)', () => {
  it('is true for an open activity whose last day is before today', () => {
    expect(isOverdue({ start: '2026-03-07', days: 3 }, false, TODAY)).toBe(true); // ended 9th
  });

  it('is false while the last day is today or later', () => {
    expect(isOverdue({ start: '2026-03-08', days: 3 }, false, TODAY)).toBe(false); // ends today
    expect(isOverdue({ start: '2026-03-12', days: 1 }, false, TODAY)).toBe(false);
  });

  it('is false for a done activity, however old', () => {
    expect(isOverdue({ start: '2025-01-01', days: 1 }, true, TODAY)).toBe(false);
  });
});

describe('hidden predecessor mark (FR-173)', () => {
  const links = [
    { from: 'a', to: 'b' },
    { from: 'c', to: 'b' },
    { from: 'b', to: 'd' },
    { from: 'x', to: 'y' },
  ];

  it('marks a shown activity whose predecessor is not shown, once', () => {
    expect(hiddenPredecessors(links, new Set(['b', 'd']))).toEqual(new Set(['b']));
  });

  it('marks nothing when every predecessor is shown', () => {
    expect(hiddenPredecessors(links, new Set(['a', 'b', 'c', 'd', 'x', 'y']))).toEqual(new Set());
  });

  it('does not mark hidden activities or successors of hidden ones only', () => {
    expect(hiddenPredecessors(links, new Set(['a', 'c', 'x']))).toEqual(new Set());
  });

  it('is a 30 px line ending at the start of the block, in the middle of its row', () => {
    expect(HIDDEN_MARK).toBe(30);
    expect(hiddenMark({ left: 100, width: 50 }, 2)).toEqual({
      x1: 70,
      x2: 100,
      y: 2 * ROW_HEIGHT + ROW_HEIGHT / 2,
    });
  });

  it('is cut at the left edge of the grid', () => {
    expect(hiddenMark({ left: 10, width: 50 }, 0)).toEqual({ x1: 0, x2: 10, y: ROW_HEIGHT / 2 });
  });
});
