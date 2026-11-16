/**
 * The event part of the reminder sweep (docs/calendar/PRD.md FR-225 – FR-228): finds the
 * occurrences of events whose reminder time has come. Delivery is shared with the tasks
 * (`push/reminders.ts`).
 */
import type Database from 'better-sqlite3';
import {
  addDays,
  eventReminderBody,
  eventReminderKey,
  eventStartMs,
  latestDueEventReminder,
  normalizeEventReminds,
  occurrenceDays,
  type EventRemind,
  type Repeat,
} from '@todoness/shared';

/** Occurrences are looked for this many days around "now" (time zones reach a day either way). */
const WINDOW_DAYS = 2;

export interface DueEvent {
  id: string;
  userId: string;
  title: string;
  /** The first day of the occurrence. */
  occurrence: string;
  remind: EventRemind;
  startMs: number;
  startTime: string | null;
}

interface Row {
  id: string;
  user_id: string;
  title: string;
  start_day: string;
  days: number;
  start_time: string | null;
  repeat: Repeat;
  repeat_until: string | null;
  reminders: string;
  tz: string;
}

const dayOfMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The event reminders that should be sent now, not yet sent, earliest start first. */
export function dueEventReminders(db: Database.Database, now: number): DueEvent[] {
  const today = dayOfMs(now);
  const from = addDays(today, -WINDOW_DAYS);
  const to = addDays(today, WINDOW_DAYS);
  const rows = db
    .prepare(
      `SELECT e.id, e.user_id, e.title, e.start_day, e.days, e.start_time, e.repeat,
              e.repeat_until, e.reminders, e.tz
         FROM events e
         JOIN calendars c ON c.id = e.calendar_id AND c.deleted_at IS NULL
        WHERE e.deleted_at IS NULL AND e.reminders <> ''
          AND e.start_day <= @to
          AND (e.repeat_until IS NULL OR e.repeat_until >= @from)
          AND (e.repeat <> 'none' OR e.start_day >= @from)`,
    )
    .all({ from, to }) as Row[];

  const sent = db.prepare(
    `SELECT 1 FROM sent_event_reminders
      WHERE event_id = ? AND occurrence = ? AND remind = ? AND start_ms = ?`,
  );
  const out: DueEvent[] = [];
  for (const r of rows) {
    const choices = normalizeEventReminds(r.reminders.split(','));
    const e = {
      start: r.start_day,
      days: r.days,
      startTime: r.start_time,
      repeat: r.repeat,
      repeatUntil: r.repeat_until,
    };
    for (const occurrence of occurrenceDays(e, from, to)) {
      const startMs = eventStartMs({ startTime: r.start_time, tz: r.tz }, occurrence);
      const remind = latestDueEventReminder(startMs, choices, now);
      if (remind === null) continue;
      if (sent.get(r.id, occurrence, remind, startMs)) continue;
      out.push({
        id: r.id,
        userId: r.user_id,
        title: r.title,
        occurrence,
        remind,
        startMs,
        startTime: r.start_time,
      });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export { eventReminderBody };
export const eventReminderTag = (e: DueEvent) => eventReminderKey(e.id, e.occurrence, e.remind);
