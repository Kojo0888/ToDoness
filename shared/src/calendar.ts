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

// ---------------------------------------------------------------------------
// Repeating events and reminders (docs/calendar/PRD.md section 6)
// ---------------------------------------------------------------------------

export const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];

/** The reminders an event can have, earliest first (decision C7). */
export const EVENT_REMINDS = ['day', 'hour', '10min', 'start'] as const;
export type EventRemind = (typeof EVENT_REMINDS)[number];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const EVENT_REMIND_MS: Record<EventRemind, number> = {
  day: 24 * HOUR_MS,
  hour: HOUR_MS,
  '10min': 10 * MINUTE_MS,
  start: 0,
};

/** An all-day event counts as starting at this time (decision C7). */
export const ALL_DAY_REMIND_TIME = '09:00';
/** A reminder can still fire this long after the start (decision C10). */
export const REMINDER_GRACE_MS = 10 * MINUTE_MS;

/** An IANA time zone name this runtime knows. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** How far `tz` is ahead of UTC at the moment `ms`, in ms. */
function offsetMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms));
  const v = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The moment (epoch ms) of `time` (`HH:MM`) on `day` as the clocks of `tz` show it ('' = UTC). */
export function zonedMs(day: string, time: string, tz: string): number {
  const wall = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5)),
  );
  if (tz === '' || !isTimeZone(tz)) return wall;
  // The offset depends on the moment itself (daylight saving): look it up twice.
  const first = wall - offsetMs(wall, tz);
  return wall - offsetMs(first, tz);
}

/** When the occurrence on `day` starts: its start time, or 09:00 for an all-day event. */
export function eventStartMs(e: { startTime: string | null; tz: string }, day: string): number {
  return zonedMs(day, e.startTime ?? ALL_DAY_REMIND_TIME, e.tz);
}

export interface Repeating {
  start: string;
  days: number;
  startTime: string | null;
  repeat: Repeat;
  repeatUntil: string | null;
}

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The first day of occurrence number `k` (0 = the event's own day). */
function occurrenceStart(e: Pick<Repeating, 'start' | 'repeat'>, k: number): string {
  if (e.repeat === 'daily') return addDays(e.start, k);
  if (e.repeat === 'weekly') return addDays(e.start, 7 * k);
  const y = Number(e.start.slice(0, 4));
  const m = Number(e.start.slice(5, 7));
  const d = Number(e.start.slice(8, 10));
  if (e.repeat === 'monthly') {
    const total = y * 12 + (m - 1) + k;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
  }
  // yearly
  return `${pad(y + k, 4)}-${pad(m)}-${pad(Math.min(d, daysInMonth(y + k, m)))}`;
}

/** Never walk more than this many occurrences for one range (a safety net). */
const OCCURRENCES_MAX = 2000;

/**
 * The first days of the occurrences that touch the days `from` … `to` (both included): they
 * start inside, or start earlier and run into it. A timed event is one day (decision C2).
 */
export function occurrenceDays(e: Repeating, from: string, to: string): string[] {
  const length = e.startTime === null ? Math.max(1, e.days) : 1;
  const touches = (s: string) =>
    dayNumber(s) <= dayNumber(to) && dayNumber(addDays(s, length - 1)) >= dayNumber(from);
  if (e.repeat === 'none') return touches(e.start) ? [e.start] : [];

  // Skip ahead to just before the first occurrence that can reach `from`.
  const earliest = dayNumber(from) - (length - 1);
  const gap = earliest - dayNumber(e.start);
  let k = 0;
  if (gap > 0) {
    if (e.repeat === 'daily') k = gap;
    else if (e.repeat === 'weekly') k = Math.floor(gap / 7);
    else if (e.repeat === 'monthly') k = Math.floor(gap / 31);
    else k = Math.floor(gap / 366);
  }
  const out: string[] = [];
  for (let n = 0; n < OCCURRENCES_MAX; n++, k++) {
    const s = occurrenceStart(e, k);
    if (dayNumber(s) > dayNumber(to)) break;
    if (e.repeatUntil !== null && dayNumber(s) > dayNumber(e.repeatUntil)) break;
    if (touches(s)) out.push(s);
  }
  return out;
}

/**
 * The reminder that should be showing for an occurrence that starts at `startMs`, or null:
 * the latest chosen one whose time has passed (never a burst, FR-226), until 10 minutes
 * after the start.
 */
export function latestDueEventReminder(
  startMs: number,
  chosen: readonly EventRemind[],
  now: number,
): EventRemind | null {
  if (now >= startMs + REMINDER_GRACE_MS) return null;
  for (const choice of [...EVENT_REMINDS].reverse()) {
    if (chosen.includes(choice) && now >= startMs - EVENT_REMIND_MS[choice]) return choice;
  }
  return null;
}

/** Same event + same occurrence + same choice = same reminder; also the notification tag. */
export const eventReminderKey = (eventId: string, occurrenceDay: string, choice: EventRemind) =>
  `event:${eventId}:${occurrenceDay}:${choice}`;

/** Reminders as a unique list in `EVENT_REMINDS` order; unknown values are dropped. */
export const normalizeEventReminds = (v: readonly unknown[]): EventRemind[] =>
  EVENT_REMINDS.filter((r) => v.includes(r));
