/**
 * Reminders (docs/v1/PRD.md section 4.4).
 *
 * A reminder fires when `dueAt - (1 week | 1 day | 1 hour)` has passed, as long as the
 * task is still open and not yet due. It fires once per device for each due date and
 * choice; the device remembers that in the local `notified` table.
 * Everything runs while the app is open (start, tab focus, every 30 s).
 */
import type { RemindBefore, Todo } from '@todoness/shared';
import type { TodonessDB } from '../data/db';
import { formatDue } from './dates';

export const REMIND_MS: Record<RemindBefore, number> = {
  week: 7 * 24 * 3_600_000,
  day: 24 * 3_600_000,
  hour: 3_600_000,
};

const CHECK_EVERY_MS = 30_000;
const FORGET_AFTER_MS = 60 * 24 * 3_600_000;

export interface Reminder {
  key: string;
  todo: Todo;
  /** When it became due (epoch ms). */
  remindAt: number;
}

/** Same task + same due date + same choice = same reminder. Changing either re-arms it. */
export const reminderKey = (t: Pick<Todo, 'id' | 'dueAt' | 'remindBefore'>) =>
  `${t.id}:${t.dueAt}:${t.remindBefore}`;

/** The reminders that should fire now, soonest due task first. */
export function dueReminders(
  todos: readonly Todo[],
  now: number,
  notified: ReadonlySet<string>,
): Reminder[] {
  const out: Reminder[] = [];
  for (const todo of todos) {
    if (todo.deletedAt !== null || todo.done) continue;
    if (todo.dueAt === null || todo.remindBefore === null) continue;
    const remindAt = todo.dueAt - REMIND_MS[todo.remindBefore];
    if (now < remindAt || now >= todo.dueAt) continue;
    const key = reminderKey(todo);
    if (!notified.has(key)) out.push({ key, todo, remindAt });
  }
  return out.sort((a, b) => a.todo.dueAt! - b.todo.dueAt!);
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** `in 5 minutes`, `in 2 hours`, `in 3 days`. */
export function timeUntil(ms: number): string {
  if (ms < 60_000) return 'in less than a minute';
  if (ms < 3_600_000) return `in ${plural(Math.round(ms / 60_000), 'minute')}`;
  if (ms < 24 * 3_600_000) return `in ${plural(Math.round(ms / 3_600_000), 'hour')}`;
  return `in ${plural(Math.round(ms / (24 * 3_600_000)), 'day')}`;
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
    return reminders.length;
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
