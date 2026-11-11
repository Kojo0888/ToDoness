/**
 * Helpers for the due-time control. The data model stores the due time as part of
 * `dueAt`, and "00:00" means "no time" (the start of the day), so it is never offered.
 */

export function parseTime(value: string): { hour: string; minute: string } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? { hour: m[1]!, minute: m[2]! } : null;
}

/** `''` = no time (nothing chosen, or 00:00 which means the same). */
export function normalizeTime(value: string): string {
  return parseTime(value) && value !== '00:00' ? value : '';
}

/**
 * What a change of `<input type="time">` means: a time, '' for "no time", or `undefined`
 * while the user is still typing (the browser reports '' with `validity.badInput` while a
 * segment is empty) — that must not be saved as "no time".
 */
export function timeFromInput(raw: string, badInput: boolean): string | undefined {
  if (raw === '' && badInput) return undefined;
  return normalizeTime(raw);
}

export const TIME_PRESETS = [
  { label: 'Morning', value: '09:00' },
  { label: 'Midday', value: '12:00' },
  { label: 'Afternoon', value: '15:00' },
  { label: 'Evening', value: '18:00' },
] as const;
