/**
 * Geometry of a plan's timeline (docs/plan/PRD.md FR-125 – FR-129, FR-135): which days are
 * shown, where a block sits, what a drag means and how an arrow runs. Pure functions; the
 * component only turns them into elements.
 */
import { ACTIVITY_DAYS_MAX, addDays, dayNumber, daysBetween, endDay } from '@todoness/shared';

/** Pixels per day (on the Days scale) and per row. A row is 44 px so that blocks are easy to hit by touch. */
export const DAY_WIDTH = 36;
export const ROW_HEIGHT = 44;

/**
 * How much time a column shows (docs/plan/PRD.md FR-157, decision P15). Each scale is a
 * width of one day in pixels; drags still move by whole days.
 */
export const SCALES = ['day', 'week', 'month', 'year'] as const;
export type Scale = (typeof SCALES)[number];

const DAY_WIDTHS: Record<Scale, number> = { day: DAY_WIDTH, week: 12, month: 4, year: 0.6 };

export const dayWidth = (scale: Scale = 'day'): number => DAY_WIDTHS[scale];

/** A block is never drawn narrower than this, so it stays visible and grabbable. */
export const MIN_BLOCK = 12;

/** The units of the header: one row of groups above one row of columns. */
export type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export function headerUnits(scale: Scale): [Unit, Unit] {
  switch (scale) {
    case 'day':
      return ['month', 'day'];
    case 'week':
      return ['month', 'week'];
    case 'month':
      return ['year', 'month'];
    case 'year':
      return ['year', 'quarter'];
  }
}

/** The first day of the unit that `day` is in. */
export function unitStart(day: string, unit: Unit): string {
  switch (unit) {
    case 'day':
      return day;
    case 'week':
      return addDays(day, -weekShift(day));
    case 'month':
      return `${day.slice(0, 7)}-01`;
    case 'quarter': {
      const month = Number(day.slice(5, 7));
      const first = month - ((month - 1) % 3);
      return `${day.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
    }
    case 'year':
      return `${day.slice(0, 4)}-01-01`;
  }
}

/** The first day of the next unit after the one `day` is in. */
function nextUnit(day: string, unit: Unit): string {
  const start = unitStart(day, unit);
  if (unit === 'day') return addDays(start, 1);
  if (unit === 'week') return addDays(start, 7);
  const months = unit === 'month' ? 1 : unit === 'quarter' ? 3 : 12;
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7)) - 1 + months;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * The columns (or groups) of the range for one unit: where each unit really starts, its
 * first column on the grid (`index`, in days) and how many of its days the range shows.
 */
export function unitSpans(
  range: Range,
  unit: Unit,
): { start: string; index: number; days: number }[] {
  const spans: { start: string; index: number; days: number }[] = [];
  let index = 0;
  let day = range.first;
  while (index < range.days) {
    const next = nextUnit(day, unit);
    const days = Math.min(daysBetween(day, next), range.days - index);
    spans.push({ start: unitStart(day, unit), index, days });
    index += days;
    day = next;
  }
  return spans;
}

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
 * An open activity whose last day is before today: drawn in red (FR-161). One that ends
 * today is not overdue yet, and a done one never is (decision P18).
 */
export const isOverdue = (span: Span, done: boolean, today: string): boolean =>
  !done && endDay(span.start, span.days) < today;

/**
 * All activities and today, with 3 spare days before and 14 after (room to drag into), and
 * never fewer than 35 days.
 */
export function timelineRange(spans: readonly Span[], today: string, scale: Scale = 'day'): Range {
  const now = dayNumber(today);
  const earliest = Math.min(now, ...spans.map((s) => dayNumber(s.start)));
  const latest = Math.max(now, ...spans.map((s) => dayNumber(s.start) + s.days - 1));
  if (scale === 'day') {
    const first = earliest - DAYS_BEFORE;
    return {
      first: addDays(today, first - now),
      days: Math.max(DAYS_MIN, latest + DAYS_AFTER - first + 1),
    };
  }
  // Coarser scales: whole units, spare room that fits the scale, a minimum number of units.
  const pad = COARSE[scale];
  const unit = headerUnits(scale)[1];
  // The Years scale starts on 1 January, the others on the start of a column.
  const first = unitStart(
    addDays(today, earliest - now - pad.before),
    scale === 'year' ? 'year' : unit,
  );
  let end = nextUnit(addDays(today, latest - now + pad.after), unit); // first day after
  for (let i = unitSpans({ first, days: daysBetween(first, end) }, unit).length; i < pad.min; i++) {
    end = nextUnit(end, unit);
  }
  return { first, days: daysBetween(first, end) };
}

/** Spare days before and after, and the fewest columns, of the coarse scales. */
const COARSE: Record<Exclude<Scale, 'day'>, { before: number; after: number; min: number }> = {
  week: { before: 7, after: 28, min: 16 },
  month: { before: 28, after: 61, min: 12 },
  year: { before: 0, after: 90, min: 12 },
};

/** A block reaches from the left edge of its start day to the right edge of its end day. */
export function blockBox(
  span: Span,
  range: Range,
  scale: Scale = 'day',
): { left: number; width: number } {
  const w = dayWidth(scale);
  return {
    left: daysBetween(range.first, span.start) * w,
    width: Math.max(MIN_BLOCK, span.days * w),
  };
}

/** The day under a horizontal position on the grid. */
export const dayAtX = (range: Range, x: number, scale: Scale = 'day'): string =>
  addDays(range.first, Math.floor(x / dayWidth(scale)));

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

/**
 * A press of an arrow key on a block (FR-132): one day earlier or later, or with Shift one
 * day shorter or longer, between one day and the longest allowed activity.
 */
export function nudge(
  span: Span,
  step: -1 | 1,
  resize: boolean,
): { start: string } | { days: number } {
  return resize
    ? { days: Math.min(ACTIVITY_DAYS_MAX, Math.max(1, span.days + step)) }
    : { start: addDays(span.start, step) };
}

/**
 * How many days after a Monday the grid starts (0 = it starts on a Monday). The weekend
 * shading is one repeating background, a week wide, shifted left by this many days.
 */
export function weekShift(first: string): number {
  // 1970-01-01 was a Thursday.
  return (((dayNumber(first) + 3) % 7) + 7) % 7;
}

/** A block leaves this much of its row free above and below (`.plan-block` in styles.css). */
export const BLOCK_INSET = 7;

/**
 * An end of a block on the grid's rows: the horizontal position of the end of the source
 * activity (`from`) or of the start of the target (`to`), and the row.
 */
export interface Anchor {
  x: number;
  row: number;
}

const topOf = (row: number) => row * ROW_HEIGHT + BLOCK_INSET;
const bottomOf = (row: number) => (row + 1) * ROW_HEIGHT - BLOCK_INSET;

/** The two corners an arrow joins: the end of the source and the start of the target. */
function corners(from: Anchor, to: Anchor) {
  const down = to.row >= from.row;
  return {
    x1: from.x,
    y1: down ? bottomOf(from.row) : topOf(from.row),
    x2: to.x,
    y2: down ? topOf(to.row) : bottomOf(to.row),
  };
}

/**
 * Where the arrow head of a dependency sits: on the corner where the target block starts,
 * pointing along the line (`angle` in degrees, 0 = to the right, 90 = down).
 */
export function arrowTip(from: Anchor, to: Anchor): { x: number; y: number; angle: number } {
  const { x1, y1, x2, y2 } = corners(from, to);
  return { x: x2, y: y2, angle: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI };
}

/**
 * The line of a dependency (docs/plan/PRD.md FR-148, decision P12): one straight segment
 * from the corner where the source block ends to the corner where the target block starts
 * (bottom right to top left; top right to bottom left when the target is in a row above).
 * Vertical when the target starts the day after the source ends.
 */
export function arrowPath(from: Anchor, to: Anchor): string {
  const { x1, y1, x2, y2 } = corners(from, to);
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

/** How long the mark of a hidden predecessor is, in pixels, on every scale (FR-173). */
export const HIDDEN_MARK = 30;

/**
 * The shown activities that wait for one that is not shown (done and hidden, FR-162): they
 * get a dotted mark before their block (docs/plan/PRD.md FR-173, decision P20).
 */
export function hiddenPredecessors(
  links: readonly { from: string; to: string }[],
  shown: ReadonlySet<string>,
): Set<string> {
  return new Set(links.filter((l) => shown.has(l.to) && !shown.has(l.from)).map((l) => l.to));
}

/** The mark of a hidden predecessor: a horizontal line ending where the block starts. */
export function hiddenMark(
  box: { left: number; width: number },
  row: number,
): { x1: number; x2: number; y: number } {
  return {
    x1: Math.max(0, box.left - HIDDEN_MARK),
    x2: box.left,
    y: row * ROW_HEIGHT + ROW_HEIGHT / 2,
  };
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
