/**
 * Due dates are stored as epoch milliseconds in local time. Without a time of day
 * the value is local midnight (the start of the day), as in the MVP.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-05` for an <input type="date">, or '' when there is no date. */
export function toDateInput(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of the chosen day, or null for an empty field. */
export function fromDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** `09:30` for an <input type="time">; '' when there is no time (or it is midnight). */
export function toTimeInput(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  if (d.getHours() === 0 && d.getMinutes() === 0) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Date plus optional time of day (local). An empty or invalid time means the start of the day. */
export function fromDateTimeInput(date: string, time: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    t ? Number(t[1]) : 0,
    t ? Number(t[2]) : 0,
  );
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** `5 Nov 2026`, plus the time when there is one: `5 Nov 2026, 09:30`. */
export function formatDue(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (d.getHours() === 0 && d.getMinutes() === 0) return date;
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}
