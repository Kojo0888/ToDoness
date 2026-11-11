/** Geometry of the plan timeline (docs/plan/ImplementationPlan.md, "Timeline"). */
import { describe, expect, it } from 'vitest';
import { ACTIVITY_DAYS_MAX } from '@todoness/shared';
import {
  DAY_WIDTH,
  ROW_HEIGHT,
  arrowPath,
  blockBox,
  dayAtX,
  dragResult,
  monthSpans,
  timelineRange,
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

describe('arrowPath (FR-135)', () => {
  const y = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;
  /** The points of a path made of M / H / V / L commands. */
  function points(d: string) {
    const out: [number, number][] = [];
    let x = 0;
    let yy = 0;
    for (const [, cmd, args] of d.matchAll(/([MLHV])\s*([-\d.\s,]+)/g)) {
      const n = args!
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (cmd === 'H') x = n[0]!;
      else if (cmd === 'V') yy = n[0]!;
      else [x, yy] = n as [number, number];
      out.push([x, yy]);
    }
    return out;
  }

  it('goes from the end of one block to the start of a later one', () => {
    const p = points(arrowPath({ x: 100, row: 0 }, { x: 200, row: 2 }));
    expect(p[0]).toEqual([100, y(0)]);
    expect(p.at(-1)).toEqual([200, y(2)]);
    // Leaves to the right and arrives from the left, never going backwards.
    expect(p[1]![0]).toBeGreaterThan(100);
    expect(p.at(-2)![0]).toBeLessThan(200);
    for (let i = 1; i < p.length; i++) expect(p[i]![0]).toBeGreaterThanOrEqual(p[i - 1]![0] - 0);
  });

  it('goes around when the target starts left of the source end', () => {
    const p = points(arrowPath({ x: 300, row: 1 }, { x: 100, row: 0 }));
    expect(p[0]).toEqual([300, y(1)]);
    expect(p.at(-1)).toEqual([100, y(0)]);
    expect(p[1]![0]).toBeGreaterThan(300); // leaves to the right
    expect(p.at(-2)![0]).toBeLessThan(100); // arrives from the left
    // Passes between the two rows, not through the blocks.
    expect(p.some(([, py]) => py === ROW_HEIGHT)).toBe(true);
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
