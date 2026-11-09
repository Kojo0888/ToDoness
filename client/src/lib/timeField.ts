/**
 * Helpers for the due-time control. The data model stores the due time as part of
 * `dueAt`, and "00:00" means "no time" (the start of the day), so it is never offered.
 */

export const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

const GRID = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export function parseTime(value: string): { hour: string; minute: string } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? { hour: m[1]!, minute: m[2]! } : null;
}

/** Minutes in steps of 5, plus the current one if it is not on that grid (so it is not lost). */
export function minuteChoices(hour: string, current?: string): string[] {
  const all = current && !GRID.includes(current) ? [...GRID, current].sort() : GRID;
  return hour === '00' ? all.filter((m) => m !== '00') : all;
}

export const defaultMinute = (hour: string) => (hour === '00' ? '05' : '00');

/** `''` = no time (no hour chosen, or 00:00 which means the same). */
export function composeTime(hour: string, minute: string): string {
  if (hour === '' || (hour === '00' && minute === '00')) return '';
  return `${hour}:${minute}`;
}

export const TIME_PRESETS = [
  { label: 'Morning', value: '09:00' },
  { label: 'Noon', value: '12:00' },
  { label: 'Afternoon', value: '15:00' },
  { label: 'Evening', value: '18:00' },
] as const;
