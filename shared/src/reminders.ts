/** Reminder rules shared by the app and the server (docs/v1/PRD.md section 4.4 and 4.7). */
import { REMIND_ORDER, type RemindBefore } from './schemas';

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
export const reminderKey = (t: { id: string; dueAt: number | null }, choice: RemindBefore) =>
  `${t.id}:${t.dueAt}:${choice}`;

/**
 * The reminder that should be showing now, or null. When several chosen reminders have
 * already passed (e.g. "1 week" and "1 day" for a task due tomorrow), only the latest one
 * counts, so the user never gets a burst of notifications for one task (FR-114).
 */
export function latestDueChoice(
  t: { dueAt: number | null; remindBefore: readonly RemindBefore[] },
  now: number,
): RemindBefore | null {
  if (t.dueAt === null || now >= t.dueAt) return null;
  // REMIND_ORDER is earliest first, so walk it backwards: the shortest offset that passed wins.
  for (const choice of [...REMIND_ORDER].reverse()) {
    if (t.remindBefore.includes(choice) && now >= t.dueAt - REMIND_MS[choice]) return choice;
  }
  return null;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** `in 5 minutes`, `in 2 hours`, `in 3 days`. */
export function timeUntil(ms: number): string {
  if (ms < 60_000) return 'in less than a minute';
  if (ms < 3_600_000) return `in ${plural(Math.round(ms / 60_000), 'minute')}`;
  if (ms < 24 * 3_600_000) return `in ${plural(Math.round(ms / 3_600_000), 'hour')}`;
  return `in ${plural(Math.round(ms / (24 * 3_600_000)), 'day')}`;
}
