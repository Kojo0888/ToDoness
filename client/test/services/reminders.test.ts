import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '@todoness/shared';
import { newId } from '@todoness/shared';
import {
  REMIND_MS,
  createReminderScheduler,
  dueReminders,
  notificationSupport,
  reminderKey,
  reminderText,
  timeUntil,
  type Reminder,
} from '../../src/services/reminders';
import { fakeNow, T0, testDb } from '../helpers/db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: newId(T0),
    listId: newId(T0),
    title: 'Call the dentist',
    notes: '',
    done: false,
    completedAt: null,
    dueAt: T0 + 10 * DAY,
    priority: 0,
    remindBefore: ['day'],
    orderKey: 'a0',
    fieldHlc: {},
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...over,
  };
}

const keys = (list: Reminder[]) => list.map((r) => r.todo.id);
const none = new Set<string>();

describe('REMIND_MS', () => {
  it('is one week, one day and one hour', () => {
    expect(REMIND_MS).toEqual({ week: 7 * DAY, day: DAY, hour: HOUR });
  });
});

describe('dueReminders (FR-44 – FR-46)', () => {
  it('several reminders on one task fire one after another, never as a burst (FR-113, FR-114)', () => {
    const due = T0 + 10 * DAY;
    const t = todo({ dueAt: due, remindBefore: ['week', 'day', 'hour'] });
    const k = (now: number, seen = new Set<string>()) =>
      dueReminders([t], now, seen).map((r) => r.key);
    expect(k(due - 7 * DAY)).toEqual([reminderKey(t, 'week')]);
    expect(k(due - DAY)).toEqual([reminderKey(t, 'day')]);
    // week and day have both passed: only the day one
    expect(k(due - 5 * HOUR)).toEqual([reminderKey(t, 'day')]);
    // and once that one fired, the older week one does not come back
    expect(k(due - 4 * HOUR, new Set([reminderKey(t, 'day')]))).toEqual([]);
    expect(k(due - HOUR + 1, new Set([reminderKey(t, 'day')]))).toEqual([reminderKey(t, 'hour')]);
  });

  const due = T0 + 10 * DAY;

  it('is not due before the reminder time', () => {
    for (const [choice, ms] of [
      ['week', 7 * DAY],
      ['day', DAY],
      ['hour', HOUR],
    ] as const) {
      const t = todo({ dueAt: due, remindBefore: [choice] });
      expect(dueReminders([t], due - ms - 1, none), choice).toEqual([]);
    }
  });

  it('is due exactly at the reminder time and afterwards', () => {
    for (const [choice, ms] of [
      ['week', 7 * DAY],
      ['day', DAY],
      ['hour', HOUR],
    ] as const) {
      const t = todo({ dueAt: due, remindBefore: [choice] });
      expect(keys(dueReminders([t], due - ms, none)), choice).toEqual([t.id]);
      expect(keys(dueReminders([t], due - ms + 1000, none)), choice).toEqual([t.id]);
    }
  });

  it('is not due any more once the due moment has come', () => {
    const t = todo({ dueAt: due, remindBefore: ['hour'] });
    expect(keys(dueReminders([t], due - 1, none))).toEqual([t.id]);
    expect(dueReminders([t], due, none)).toEqual([]);
    expect(dueReminders([t], due + DAY, none)).toEqual([]);
  });

  it('catches up after a long gap if the task is not yet due', () => {
    const t = todo({ dueAt: due, remindBefore: ['week'] });
    expect(keys(dueReminders([t], due - 2 * DAY, none))).toEqual([t.id]);
  });

  it('skips completed, deleted, undated and reminder-less tasks', () => {
    const now = due - 30 * 60_000;
    const all = [
      todo({ remindBefore: ['hour'], dueAt: due, done: true }),
      todo({ remindBefore: ['hour'], dueAt: due, deletedAt: T0 }),
      todo({ remindBefore: ['hour'], dueAt: null }),
      todo({ remindBefore: [], dueAt: due }),
    ];
    expect(dueReminders(all, now, none)).toEqual([]);
  });

  it('skips reminders that already fired on this device', () => {
    const t = todo({ dueAt: due, remindBefore: ['day'] });
    const now = due - 2 * HOUR;
    expect(dueReminders([t], now, new Set([reminderKey(t, 'day')]))).toEqual([]);
  });

  it('changing the due date or the choice makes it fire again', () => {
    const t = todo({ dueAt: due, remindBefore: ['day'] });
    const seen = new Set([reminderKey(t, 'day')]);
    const now = due - 30 * 60_000; // inside the last hour: every choice is due
    expect(dueReminders([{ ...t, dueAt: due + HOUR }], now, seen)).toHaveLength(1);
    expect(dueReminders([{ ...t, remindBefore: ['hour'] }], now, seen)).toHaveLength(1);
    expect(dueReminders([t], now, seen)).toHaveLength(0);
  });

  it('returns the soonest due task first', () => {
    const a = todo({ title: 'later', dueAt: due + 5 * HOUR, remindBefore: ['week'] });
    const b = todo({ title: 'sooner', dueAt: due, remindBefore: ['week'] });
    expect(dueReminders([a, b], due - DAY, none).map((r) => r.todo.title)).toEqual([
      'sooner',
      'later',
    ]);
  });
});

describe('timeUntil and reminderText', () => {
  it('speaks in minutes, hours and days', () => {
    expect(timeUntil(20_000)).toBe('in less than a minute');
    expect(timeUntil(60_000)).toBe('in 1 minute');
    expect(timeUntil(59 * 60_000)).toBe('in 59 minutes');
    expect(timeUntil(HOUR)).toBe('in 1 hour');
    expect(timeUntil(90 * 60_000)).toBe('in 2 hours');
    expect(timeUntil(23 * HOUR)).toBe('in 23 hours');
    expect(timeUntil(DAY)).toBe('in 1 day');
    expect(timeUntil(7 * DAY)).toBe('in 7 days');
  });

  it('builds the notification text from the task', () => {
    const t = todo({ dueAt: T0 + HOUR, title: 'Pay rent' });
    const r = reminderText(
      { key: reminderKey(t, 'day'), todo: t, choice: 'day', remindAt: T0 },
      T0,
    );
    expect(r.title).toBe('Pay rent');
    expect(r.body).toMatch(/^Due in 1 hour/);
  });
});

describe('notificationSupport (FR-47)', () => {
  const N = (permission: string) => ({ permission }) as { permission: NotificationPermission };

  it('needs HTTPS or localhost', () => {
    expect(notificationSupport({ isSecureContext: false, Notification: N('granted') })).toBe(
      'insecure',
    );
  });
  it('needs a browser with notifications', () => {
    expect(notificationSupport({ isSecureContext: true })).toBe('unsupported');
  });
  it('reports the permission otherwise', () => {
    for (const p of ['granted', 'denied', 'default'] as const) {
      expect(notificationSupport({ isSecureContext: true, Notification: N(p) })).toBe(p);
    }
  });
});

describe('createReminderScheduler', () => {
  afterEach(() => vi.useRealTimers());

  async function setup(todos: Partial<Todo>[] = [], now = fakeNow()) {
    const db = testDb();
    const notify = vi.fn();
    for (const t of todos) await db.todos.put(todo(t));
    const scheduler = createReminderScheduler({
      db,
      notify,
      now,
      subscribeVisible: () => () => {},
    });
    return { db, notify, scheduler, now };
  }

  it('notifies once for a due reminder and remembers it', async () => {
    const { db, notify, scheduler, now } = await setup([
      { title: 'Soon', dueAt: T0 + 2 * HOUR, remindBefore: ['day'] },
    ]);
    expect(await scheduler.check()).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatchObject({ todo: { title: 'Soon' } });
    expect(await db.notified.count()).toBe(1);

    now.advance(60_000);
    expect(await scheduler.check()).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('waits until the time has come', async () => {
    const { notify, scheduler, now } = await setup([
      { dueAt: T0 + 3 * HOUR, remindBefore: ['hour'] },
    ]);
    expect(await scheduler.check()).toBe(0);
    now.set(T0 + 2 * HOUR - 1);
    expect(await scheduler.check()).toBe(0);
    now.set(T0 + 2 * HOUR);
    expect(await scheduler.check()).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('fires again after the due date is changed', async () => {
    const { db, notify, scheduler, now } = await setup([
      { id: '0192f0c1-0000-7000-8000-00000000000a', dueAt: T0 + 2 * HOUR, remindBefore: ['day'] },
    ]);
    await scheduler.check();
    await db.todos.update('0192f0c1-0000-7000-8000-00000000000a', { dueAt: T0 + 5 * HOUR });
    now.advance(1000);
    expect(await scheduler.check()).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('ignores completed tasks', async () => {
    const { notify, scheduler } = await setup([
      { dueAt: T0 + 2 * HOUR, remindBefore: ['day'], done: true },
    ]);
    expect(await scheduler.check()).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('forgets reminders older than 60 days', async () => {
    const { db, scheduler, now } = await setup();
    await db.notified.put({ key: 'old', at: T0 - 61 * DAY });
    await db.notified.put({ key: 'recent', at: T0 - DAY });
    await scheduler.check();
    expect((await db.notified.toArray()).map((r) => r.key)).toEqual(['recent']);
    void now;
  });

  it('does not run two checks at once', async () => {
    const { notify, scheduler } = await setup([{ dueAt: T0 + 2 * HOUR, remindBefore: ['day'] }]);
    await Promise.all([scheduler.check(), scheduler.check(), scheduler.check()]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('checks at start, every 30 seconds, and when the tab becomes visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const db = testDb();
    const now = fakeNow();
    const notify = vi.fn();
    let becomeVisible: () => void = () => {};
    const scheduler = createReminderScheduler({
      db,
      notify,
      now,
      subscribeVisible: (handler) => {
        becomeVisible = handler;
        return () => {
          becomeVisible = () => {};
        };
      },
    });
    const spy = vi.spyOn(scheduler, 'check');

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1); // at start
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spy).toHaveBeenCalledTimes(2);
    becomeVisible();
    expect(spy).toHaveBeenCalledTimes(3);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
