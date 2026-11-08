/** Reminder rules shared by the app and the server (docs/v1/PRD.md section 4.4 and 4.7). */
import type { RemindBefore } from './schemas';

export const REMIND_MS: Record<RemindBefore, number> = {
  week: 7 * 24 * 3_600_000,
  day: 24 * 3_600_000,
  hour: 3_600_000,
};

/**
 * Same task + same due date + same choice = same reminder. Changing either makes it a
 * new one. Also used as the notification tag, so a reminder shown by the app and the
 * same one pushed by the server replace each other instead of appearing twice.
 */
export const reminderKey = (t: { id: string; dueAt: number | null; remindBefore: string | null }) =>
  `${t.id}:${t.dueAt}:${t.remindBefore}`;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** `in 5 minutes`, `in 2 hours`, `in 3 days`. */
export function timeUntil(ms: number): string {
  if (ms < 60_000) return 'in less than a minute';
  if (ms < 3_600_000) return `in ${plural(Math.round(ms / 60_000), 'minute')}`;
  if (ms < 24 * 3_600_000) return `in ${plural(Math.round(ms / 3_600_000), 'hour')}`;
  return `in ${plural(Math.round(ms / (24 * 3_600_000)), 'day')}`;
}
