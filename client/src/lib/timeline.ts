/**
 * Geometry of a plan's timeline (docs/plan/PRD.md FR-125 – FR-129, FR-135): which days are
 * shown, where a block sits, what a drag means and how an arrow runs. Pure functions; the
 * component only turns them into elements.
 */
import { ACTIVITY_DAYS_MAX, addDays, dayNumber, daysBetween } from '@todoness/shared';

/** Pixels per day and per row. A row is 44 px so that blocks are easy to hit by touch. */
export const DAY_WIDTH = 36;
export const ROW_HEIGHT = 44;

const DAYS_BEFORE = 3;
const DAYS_AFTER = 14;
const DAYS_MIN = 35;

/** The days on the grid: `days` columns from `first`. */
export interface Range {
  first: string;
  days: number;
}

export interface Span {
  start: string;
  days: number;
}

/**
 * All activities and today, with 3 spare days before and 14 after (room to drag into), and
 * never fewer than 35 days.
 */
export function timelineRange(spans: readonly Span[], today: string): Range {
  const now = dayNumber(today);
  const earliest = Math.min(now, ...spans.map((s) => dayNumber(s.start)));
  const latest = Math.max(now, ...spans.map((s) => dayNumber(s.start) + s.days - 1));
  const first = earliest - DAYS_BEFORE;
  return {
    first: addDays(today, first - now),
    days: Math.max(DAYS_MIN, latest + DAYS_AFTER - first + 1),
  };
}

/** A block reaches from the left edge of its start day to the right edge of its end day. */
export function blockBox(span: Span, range: Range): { left: number; width: number } {
  return {
    left: daysBetween(range.first, span.start) * DAY_WIDTH,
    width: span.days * DAY_WIDTH,
  };
}

/** The day under a horizontal position on the grid. */
export const dayAtX = (range: Range, x: number): string =>
  addDays(range.first, Math.floor(x / DAY_WIDTH));

export type DragKind = 'move' | 'resize';

/**
 * What an activity becomes when it is dragged by `deltaDays`. `move` (the block or its
 * beginning) changes the start and keeps the duration, but not before `earliest`, the first
 * day its predecessors allow. `resize` (its end) changes the duration, at least one day.
 */
export function dragResult(
  kind: DragKind,
  span: Span,
  deltaDays: number,
  earliest: string | null = null,
): Span {
  if (kind === 'resize') {
    return {
      start: span.start,
      days: Math.min(ACTIVITY_DAYS_MAX, Math.max(1, span.days + deltaDays)),
    };
  }
  const start = addDays(span.start, deltaDays);
  return { start: earliest !== null && start < earliest ? earliest : start, days: span.days };
}

/** How far an arrow runs straight out of a block and into one. */
const STUB = 12;

/** A point on the grid's rows: a horizontal position in the middle of a row. */
export interface Anchor {
  x: number;
  row: number;
}

const middle = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

/**
 * The line of a dependency, from the end of one block (`from`) to the start of another
 * (`to`): it leaves to the right and arrives from the left. When the target does not start
 * far enough to the right, it goes around between the rows instead of through the blocks.
 */
export function arrowPath(from: Anchor, to: Anchor): string {
  const y1 = middle(from.row);
  const y2 = middle(to.row);
  const out = from.x + STUB;
  if (to.x - from.x >= 2 * STUB) return `M ${from.x} ${y1} H ${out} V ${y2} H ${to.x}`;
  // The row border next to the source, on the side of the target (below when in one row).
  const between = to.row < from.row ? from.row * ROW_HEIGHT : (from.row + 1) * ROW_HEIGHT;
  return `M ${from.x} ${y1} H ${out} V ${between} H ${to.x - STUB} V ${y2} H ${to.x}`;
}

/** The months of the range, for the header: where each starts and how many days it shows. */
export function monthSpans(range: Range): { month: string; index: number; days: number }[] {
  const spans: { month: string; index: number; days: number }[] = [];
  for (let i = 0; i < range.days; i++) {
    const month = addDays(range.first, i).slice(0, 7);
    const last = spans.at(-1);
    if (last?.month === month) last.days++;
    else spans.push({ month, index: i, days: 1 });
  }
  return spans;
}
