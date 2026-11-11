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

/** A block leaves this much of its row free above and below (`.plan-block` in styles.css). */
export const BLOCK_INSET = 7;

/** How far an arrow runs out of a block before it turns, when it has to go around. */
const STUB = 12;

/**
 * An end of a block on the grid's rows: the horizontal position of the end of the source
 * activity (`from`) or of the start of the target (`to`), and the row.
 */
export interface Anchor {
  x: number;
  row: number;
}

const middle = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;
const topOf = (row: number) => row * ROW_HEIGHT + BLOCK_INSET;
const bottomOf = (row: number) => (row + 1) * ROW_HEIGHT - BLOCK_INSET;

/**
 * Where the arrow head of a dependency sits: on the top edge of the target block at its
 * start, pointing down; on the bottom edge, pointing up, when the target is in a row above.
 */
export function arrowTip(from: Anchor, to: Anchor): { x: number; y: number; down: boolean } {
  const down = to.row >= from.row;
  return { x: to.x, y: down ? topOf(to.row) : bottomOf(to.row), down };
}

/**
 * The line of a dependency (docs/plan/PRD.md FR-135), from the end of one block to the
 * start of another, which it enters from above (or below):
 *  - the target starts exactly where the source ends: one straight vertical line;
 *  - it starts further right: along the source's row, then down at the target's start
 *    (through the upper right corner, so the line never runs along the target's row);
 *  - it starts further left (a broken link): out of the source, along the row border next
 *    to the target, then into it.
 */
export function arrowPath(from: Anchor, to: Anchor): string {
  const tip = arrowTip(from, to);
  if (to.x === from.x) {
    return `M ${from.x} ${tip.down ? bottomOf(from.row) : topOf(from.row)} V ${tip.y}`;
  }
  const y = middle(from.row);
  if (to.x > from.x) return `M ${from.x} ${y} H ${to.x} V ${tip.y}`;
  const border = tip.down ? to.row * ROW_HEIGHT : (to.row + 1) * ROW_HEIGHT;
  return `M ${from.x} ${y} H ${from.x + STUB} V ${border} H ${to.x} V ${tip.y}`;
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
