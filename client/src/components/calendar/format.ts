/** Words for days and times, in the language of the device (UI texts are in app/strings.ts). */
import { eventSpan, type EventTime } from '@todoness/shared';
import { t } from '../../app/strings';

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (options: Intl.DateTimeFormatOptions) => (day: string) =>
  new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(utc(day));

export const monthTitle = fmt({ month: 'long', year: 'numeric' });
export const weekdayShort = fmt({ weekday: 'short' });
export const dayNumberOf = (day: string) => String(Number(day.slice(8, 10)));
export const dayMonthShort = fmt({ day: 'numeric', month: 'short' });
export const dayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
export const dayMedium = fmt({ weekday: 'short', day: 'numeric', month: 'short' });

/** "9 – 15 Nov 2026". */
export function weekTitle(days: readonly string[]): string {
  const first = days[0]!;
  const last = days.at(-1)!;
  const year = new Intl.DateTimeFormat(undefined, { year: 'numeric', timeZone: 'UTC' }).format(
    utc(last),
  );
  return `${dayMonthShort(first)} – ${dayMonthShort(last)} ${year}`;
}

/** The time of an event, e.g. "09:30–10:15", "09:30", or "all day". */
export function timeText(e: Pick<EventTime, 'start' | 'days' | 'startTime' | 'endTime'>): string {
  if (e.startTime === null) return t.calendar.allDayRow;
  const span = eventSpan(e);
  const end = span.to === null ? null : minutesText(span.to);
  return e.endTime !== null && end !== null && end !== e.startTime
    ? `${e.startTime}–${e.endTime}`
    : e.startTime;
}

function minutesText(total: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(total / 60) % 24)}:${p(total % 60)}`;
}
