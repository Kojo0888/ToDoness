/**
 * Days and times of calendar events (docs/calendar/PRD.md FR-207, decisions C1, C2).
 * Pure functions, shared by the schemas and the screens.
 */
import { addDays, dayNumber } from './plan';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `HH:MM`, 24 hours. */
export function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME.test(value);
}

/** Minutes after midnight. */
export function timeMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** The part of an event the views need. */
export interface EventTime {
  start: string;
  days: number;
  startTime: string | null;
  endTime: string | null;
  title: string;
}

/** What an event covers, with the stored oddities smoothed out. */
export interface EventSpan {
  start: string;
  endDay: string;
  /** Minutes after midnight, or `null` for an all-day event. */
  from: number | null;
  to: number | null;
}

/** One hour: a timed event without a (later) end time. */
const DEFAULT_MINUTES = 60;
const DAY_MINUTES = 1440;

/**
 * A timed event lasts one day whatever `days` says; a missing, equal or earlier end time
 * makes it one hour (never past midnight); an end time without a start time is ignored.
 * After concurrent edits any combination can be stored, so readers do this, not the merge.
 */
export function eventSpan(
  e: Pick<EventTime, 'start' | 'days' | 'startTime' | 'endTime'>,
): EventSpan {
  if (e.startTime === null) {
    return {
      start: e.start,
      endDay: addDays(e.start, Math.max(1, e.days) - 1),
      from: null,
      to: null,
    };
  }
  const from = timeMinutes(e.startTime);
  const end = e.endTime === null ? undefined : timeMinutes(e.endTime);
  const to = end !== undefined && end > from ? end : Math.min(from + DEFAULT_MINUTES, DAY_MINUTES);
  return { start: e.start, endDay: e.start, from, to };
}

/** All-day (and running over several days) first, then by start time, then by title. */
export function compareEvents(a: EventTime, b: EventTime): number {
  const fa = a.startTime === null ? -1 : timeMinutes(a.startTime);
  const fb = b.startTime === null ? -1 : timeMinutes(b.startTime);
  return fa - fb || a.title.localeCompare(b.title);
}

/** The events that happen on `day`, in the order they are shown. */
export function eventsOnDay<T extends EventTime>(events: readonly T[], day: string): T[] {
  const n = dayNumber(day);
  return events
    .filter((e) => {
      const s = eventSpan(e);
      return dayNumber(s.start) <= n && n <= dayNumber(s.endDay);
    })
    .sort(compareEvents);
}
