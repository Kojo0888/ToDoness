/**
 * Layout rules of the calendar views (docs/calendar/PRD.md FR-210 – FR-214). Pure functions
 * on `YYYY-MM-DD` days, unit tested.
 */
import {
  addDays,
  dayNumber,
  dayOf,
  eventSpan,
  eventsOnDay,
  type EventTime,
} from '@todoness/shared';

export type CalendarView = 'month' | 'week' | 'agenda';
export const CALENDAR_VIEWS: readonly CalendarView[] = ['month', 'week', 'agenda'];

/** Monday 0 … Sunday 6. 1970-01-01 (day 0) was a Thursday. */
export function weekdayIndex(day: string): number {
  return (((dayNumber(day) + 3) % 7) + 7) % 7;
}

/** The Monday of the week `day` is in. */
export const weekStart = (day: string): string => addDays(day, -weekdayIndex(day));

/** Monday … Sunday of the week `day` is in. */
export function weekDays(day: string): string[] {
  const monday = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export const firstOfMonth = (day: string): string => `${day.slice(0, 7)}-01`;

/** The first day of the month `n` months from the one `day` is in. */
function monthShifted(day: string, n: number): string {
  const total = Number(day.slice(0, 4)) * 12 + (Number(day.slice(5, 7)) - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** The month of `day` in whole weeks, Monday first: as many rows as the month needs. */
export function monthGrid(day: string): string[][] {
  const first = firstOfMonth(day);
  const last = addDays(monthShifted(day, 1), -1);
  const start = weekStart(first);
  const rows = Math.ceil((dayNumber(last) - dayNumber(start) + 1) / 7);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => addDays(start, r * 7 + c)),
  );
}

/** Previous (-1) or next (1) period: a month goes to its first day, the others by a week. */
export function shiftPeriod(view: CalendarView, day: string, direction: 1 | -1): string {
  return view === 'month' ? monthShifted(day, direction) : addDays(day, 7 * direction);
}

/** The days a view needs events for (the month grid, the week, or `AGENDA_DAYS` from `day`). */
export const AGENDA_DAYS = 60;
export function viewRange(view: CalendarView, day: string): { from: string; to: string } {
  if (view === 'month') {
    const grid = monthGrid(day);
    return { from: grid[0]![0]!, to: grid.at(-1)![6]! };
  }
  if (view === 'week') return { from: weekStart(day), to: addDays(weekStart(day), 6) };
  return { from: day, to: addDays(day, AGENDA_DAYS - 1) };
}

export interface TimedBox<T> {
  event: T;
  /** Minutes after midnight. */
  from: number;
  to: number;
  /** Side-by-side position among the events it overlaps with. */
  column: number;
  columns: number;
}

/**
 * The timed events of one day laid out in an hour grid: overlapping events sit side by side,
 * in equal columns. All-day events are left out.
 */
export function layoutTimed<T extends EventTime>(events: readonly T[]): TimedBox<T>[] {
  const boxes = events
    .map((event) => ({ event, span: eventSpan(event) }))
    .filter((b) => b.span.from !== null)
    .map((b) => ({ event: b.event, from: b.span.from!, to: b.span.to! }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const out: TimedBox<T>[] = [];
  let group: TimedBox<T>[] = [];
  let groupEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...group.map((b) => b.column + 1));
    for (const b of group) b.columns = columns;
    out.push(...group);
    group = [];
  };
  for (const b of boxes) {
    if (group.length > 0 && b.from >= groupEnd) close();
    const taken = new Set(group.filter((g) => g.to > b.from).map((g) => g.column));
    let column = 0;
    while (taken.has(column)) column++;
    group.push({ ...b, column, columns: 1 });
    groupEnd = Math.max(groupEnd, b.to);
  }
  close();
  return out;
}

export interface AgendaGroup<T> {
  day: string;
  events: T[];
}

/**
 * The days from `from` to `to` that have something on them, in order; `today` is always
 * there when it is in the range (so an empty agenda still says where "now" is).
 */
export function agendaGroups<T extends EventTime>(
  events: readonly T[],
  from: string,
  to: string,
  today: string,
): AgendaGroup<T>[] {
  const out: AgendaGroup<T>[] = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n++) {
    const day = dayOf(n);
    const list = eventsOnDay(events, day);
    if (list.length > 0 || day === today) out.push({ day, events: list });
  }
  return out;
}
