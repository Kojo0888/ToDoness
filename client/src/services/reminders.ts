/**
 * Reminders (docs/v1/PRD.md section 4.4).
 *
 * A task can have several reminders (docs/ui-refresh). One fires when
 * `dueAt - (1 week | 1 day | 1 hour)` has passed, as long as the
 * task is still open and not yet due. It fires once per device for each due date and
 * choice; the device remembers that in the local `notified` table.
 * Everything runs while the app is open (start, tab focus, every 30 s).
 */
import {
  REMIND_MS,
  addDays,
  eventReminderBody,
  eventReminderKey,
  eventStartMs,
  latestDueChoice,
  latestDueEventReminder,
  occurrenceDays,
  reminderKey,
  timeUntil,
  type Calendar,
  type CalendarEvent,
  type EventRemind,
  type RemindBefore,
  type Todo,
} from '@todoness/shared';
import type { TodonessDB } from '../data/db';
import { formatDue } from '../lib/dates';

export { REMIND_MS, reminderKey, timeUntil };

const CHECK_EVERY_MS = 30_000;
const FORGET_AFTER_MS = 60 * 24 * 3_600_000;

export interface Reminder {
  key: string;
  todo: Todo;
  choice: RemindBefore;
  /** When it became due (epoch ms). */
  remindAt: number;
}

/** The reminders that should fire now, soonest due task first. */
export function dueReminders(
  todos: readonly Todo[],
  now: number,
  notified: ReadonlySet<string>,
): Reminder[] {
  const out: Reminder[] = [];
  for (const todo of todos) {
    if (todo.deletedAt !== null || todo.done) continue;
    // Only the latest reminder whose time has passed: never a burst for one task (FR-114).
    const choice = latestDueChoice(todo, now);
    if (choice === null) continue;
    const key = reminderKey(todo, choice);
    if (!notified.has(key))
      out.push({ key, todo, choice, remindAt: todo.dueAt! - REMIND_MS[choice] });
  }
  return out.sort((a, b) => a.todo.dueAt! - b.todo.dueAt!);
}

/** A reminder of an event occurrence (docs/calendar/PRD.md section 6). */
export interface EventReminder {
  /** Remembers that it was shown: the tag and the start moment (a moved event is a new one). */
  key: string;
  /** The notification tag, the same the server uses for its push. */
  tag: string;
  event: CalendarEvent;
  /** The first day of the occurrence. */
  occurrence: string;
  choice: EventRemind;
  startMs: number;
}

/** Occurrences are looked for this many days around "now" (time zones reach a day either way). */
const EVENT_WINDOW_DAYS = 2;
const dayOfMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The event reminders that should fire now, earliest start first (FR-225, FR-226). */
export function dueEventReminders(
  events: readonly CalendarEvent[],
  calendars: readonly Calendar[],
  now: number,
  notified: ReadonlySet<string>,
): EventReminder[] {
  const live = new Set(calendars.filter((c) => c.deletedAt === null).map((c) => c.id));
  const from = addDays(dayOfMs(now), -EVENT_WINDOW_DAYS);
  const to = addDays(dayOfMs(now), EVENT_WINDOW_DAYS);
  const out: EventReminder[] = [];
  for (const event of events) {
    if (event.deletedAt !== null || !live.has(event.calendarId) || event.reminders.length === 0) {
      continue;
    }
    for (const occurrence of occurrenceDays(event, from, to)) {
      const startMs = eventStartMs(event, occurrence);
      const choice = latestDueEventReminder(startMs, event.reminders, now);
      if (choice === null) continue;
      const tag = eventReminderKey(event.id, occurrence, choice);
      const key = `${tag}:${startMs}`;
      if (!notified.has(key)) out.push({ key, tag, event, occurrence, choice, startMs });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export function eventReminderText(r: EventReminder, now: number): { title: string; body: string } {
  return {
    title: r.event.title,
    body: eventReminderBody(
      { startTime: r.event.startTime, startMs: r.startMs, occurrence: r.occurrence },
      now,
    ),
  };
}

export function reminderText(r: Reminder, now: number): { title: string; body: string } {
  const due = r.todo.dueAt!;
  return { title: r.todo.title, body: `Due ${timeUntil(due - now)} (${formatDue(due)})` };
}

// ---------------------------------------------------------------------------
// Browser notifications (FR-47)
// ---------------------------------------------------------------------------

export type NotificationSupport = NotificationPermission | 'insecure' | 'unsupported';

interface NotificationEnv {
  isSecureContext: boolean;
  Notification?: { permission: NotificationPermission };
}

/** Can the browser show notifications here, and may it? Needs HTTPS (or localhost). */
export function notificationSupport(
  env: NotificationEnv = {
    isSecureContext: globalThis.isSecureContext ?? false,
    Notification: (globalThis as { Notification?: NotificationEnv['Notification'] }).Notification,
  },
): NotificationSupport {
  if (!env.isSecureContext) return 'insecure';
  if (!env.Notification) return 'unsupported';
  return env.Notification.permission;
}

/** Must be called from a click or key press, or the browser ignores it. */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (notificationSupport() === 'default') await Notification.requestPermission();
  return notificationSupport();
}

/**
 * Shows a system notification. Browsers on phones only allow it through the service
 * worker; elsewhere `new Notification` is the fallback. Never throws.
 */
export async function showSystemNotification(opts: {
  title: string;
  body: string;
  tag: string;
}): Promise<void> {
  if (notificationSupport() !== 'granted') return;
  const options: NotificationOptions = {
    body: opts.body,
    tag: opts.tag,
    icon: '/icon-192.png',
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) return await registration.showNotification(opts.title, options);
  } catch {
    /* fall back below */
  }
  try {
    new Notification(opts.title, options);
  } catch {
    /* nothing more we can do */
  }
}

// ---------------------------------------------------------------------------
// The scheduler
// ---------------------------------------------------------------------------

export interface ReminderSchedulerOptions {
  db: TodonessDB;
  notify: (reminder: Reminder) => void | Promise<void>;
  /** Shows a reminder of an event; left out, events are not reminded of. */
  notifyEvent?: (reminder: EventReminder) => void | Promise<void>;
  now?: () => number;
  intervalMs?: number;
  /** Calls the handler when the tab becomes visible; returns a function that stops it. */
  subscribeVisible?: (handler: () => void) => () => void;
}

export interface ReminderScheduler {
  /** Fires every reminder that is due. Returns how many fired. */
  check(): Promise<number>;
  start(): void;
  stop(): void;
}

const browserVisible = (handler: () => void) => {
  const onChange = () => document.visibilityState === 'visible' && handler();
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

export function createReminderScheduler(opts: ReminderSchedulerOptions): ReminderScheduler {
  const {
    db,
    notify,
    notifyEvent,
    now = Date.now,
    intervalMs = CHECK_EVERY_MS,
    subscribeVisible = browserVisible,
  } = opts;

  let inFlight: Promise<number> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  async function run(): Promise<number> {
    const t = now();

    // Forget old entries, so the table does not grow forever.
    const rows = await db.notified.toArray();
    const stale = rows.filter((r) => r.at < t - FORGET_AFTER_MS).map((r) => r.key);
    if (stale.length > 0) await db.notified.bulkDelete(stale);
    const seen = new Set(rows.filter((r) => r.at >= t - FORGET_AFTER_MS).map((r) => r.key));

    const reminders = dueReminders(await db.todos.toArray(), t, seen);
    for (const r of reminders) {
      await db.notified.put({ key: r.key, at: t }); // remember first: never fire twice
      await notify(r);
    }
    let count = reminders.length;
    if (notifyEvent) {
      const due = dueEventReminders(
        await db.events.toArray(),
        await db.calendars.toArray(),
        t,
        seen,
      );
      for (const r of due) {
        await db.notified.put({ key: r.key, at: t });
        await notifyEvent(r);
      }
      count += due.length;
    }
    return count;
  }

  const scheduler: ReminderScheduler = {
    check() {
      inFlight ??= run().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    start() {
      if (timer !== undefined) return;
      void scheduler.check();
      timer = setInterval(() => void scheduler.check(), intervalMs);
      unsubscribe = subscribeVisible(() => void scheduler.check());
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
  return scheduler;
}
