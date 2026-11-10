/**
 * The reminder sweep (FR-61 – FR-63): finds reminders whose time has come and pushes them
 * to every device of the task's owner, once. Runs every 30 seconds in the server.
 */
import type Database from 'better-sqlite3';
import { REMIND_MS, reminderKey, timeUntil } from '@todoness/shared';
import type { NtfySend } from './ntfy';

export interface PushPayload {
  title: string;
  body: string;
  /** Same as the app's own notification, so the user sees one, not two (FR-66). */
  tag: string;
  /** Where a click goes. */
  url: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `gone`: the push service says this subscription does not exist any more. */
export type PushSend = (
  target: PushTarget,
  payload: PushPayload,
) => Promise<'ok' | 'gone' | 'failed'>;

const FORGET_AFTER_MS = 60 * 24 * 3_600_000;

/** How many reminders are sent at the same time. */
const PARALLEL_SENDS = 8;

interface Due {
  id: string;
  user_id: string;
  list_id: string;
  title: string;
  due_at: number;
  remind_before: 'week' | 'day' | 'hour';
}

export async function sweepReminders(deps: {
  db: Database.Database;
  send: PushSend;
  sendNtfy?: NtfySend;
  now: number;
}): Promise<{ sent: number }> {
  const { db, send, sendNtfy, now } = deps;

  db.prepare('DELETE FROM sent_reminders WHERE due_at < ?').run(now - FORGET_AFTER_MS);

  // Only users with a device or topic: a reminder is not used up while nobody could receive it.
  const due = db
    .prepare(
      `SELECT t.id, t.user_id, t.list_id, t.title, t.due_at, t.remind_before
         FROM todos t
        WHERE t.deleted_at IS NULL AND t.done = 0
          AND t.due_at IS NOT NULL AND t.remind_before IS NOT NULL
          AND t.due_at > @now
          AND t.due_at - CASE t.remind_before
                WHEN 'week' THEN ${REMIND_MS.week}
                WHEN 'day' THEN ${REMIND_MS.day}
                ELSE ${REMIND_MS.hour} END <= @now
          AND NOT EXISTS (SELECT 1 FROM sent_reminders s
                           WHERE s.todo_id = t.id AND s.due_at = t.due_at
                             AND s.remind_before = t.remind_before)
          AND (EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = t.user_id)${
            sendNtfy ? ' OR EXISTS (SELECT 1 FROM ntfy_topics n WHERE n.user_id = t.user_id)' : ''
          })
        ORDER BY t.due_at`,
    )
    .all({ now }) as Due[];

  const record = db.prepare(
    'INSERT OR IGNORE INTO sent_reminders (todo_id, due_at, remind_before, sent_at) VALUES (?, ?, ?, ?)',
  );
  const unrecord = db.prepare(
    'DELETE FROM sent_reminders WHERE todo_id = ? AND due_at = ? AND remind_before = ?',
  );
  const targets = db.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
  );
  const forget = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const topicOf = db.prepare('SELECT topic FROM ntfy_topics WHERE user_id = ?');

  let sent = 0;
  async function deliver(t: Due) {
    // Remember first, so a slow or crashing send can never cause a second push.
    if (record.run(t.id, t.due_at, t.remind_before, now).changes === 0) return;

    const payload: PushPayload = {
      title: t.title,
      body: `Due ${timeUntil(t.due_at - now)}`,
      tag: reminderKey({ id: t.id, dueAt: t.due_at, remindBefore: t.remind_before }),
      url: `/l/${t.list_id}/t/${t.id}`,
    };

    let delivered = 0;
    let failed = 0;
    for (const target of targets.all(t.user_id) as PushTarget[]) {
      const outcome = await send(target, payload).catch(() => 'failed' as const);
      if (outcome === 'ok') delivered++;
      else if (outcome === 'gone') forget.run(target.endpoint);
      else failed++;
    }

    const row = sendNtfy ? (topicOf.get(t.user_id) as { topic: string } | undefined) : undefined;
    if (sendNtfy && row) {
      const outcome = await sendNtfy(row.topic, payload).catch(() => 'failed' as const);
      if (outcome === 'ok') delivered++;
      else failed++;
    }

    if (delivered > 0) sent++;
    else if (failed > 0) unrecord.run(t.id, t.due_at, t.remind_before); // try again next time
  }

  // A few at a time: one slow or dead push service must not hold up everyone's reminders
  // for minutes, and a burst of due reminders must not flood the services either.
  // A failing reminder (e.g. the database closed at shutdown) does not stop the others, and
  // the sweep only ends once every worker has stopped, so the next sweep never overlaps it.
  let next = 0;
  let firstError: unknown;
  const worker = async () => {
    while (next < due.length) {
      try {
        await deliver(due[next++]!);
      } catch (err) {
        firstError ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_SENDS, due.length) }, worker));
  if (firstError !== undefined) throw firstError;
  return { sent };
}
