import type Database from 'better-sqlite3';
import type { NtfySend } from './ntfy';
import { sweepReminders, type PushSend } from './reminders';

/**
 * Runs the reminder sweep now and then every `intervalMs`, also when nobody has the app
 * open (FR-61). A sweep never overlaps the previous one. Returns a function that stops it.
 */
export function startReminderSweeper({
  db,
  send,
  sendNtfy,
  intervalMs = 30_000,
  now = Date.now,
}: {
  db: Database.Database;
  send: PushSend;
  sendNtfy?: NtfySend;
  intervalMs?: number;
  now?: () => number;
}): () => void {
  let sweeping = false;
  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      await sweepReminders({ db, send, ...(sendNtfy ? { sendNtfy } : {}), now: now() });
    } catch (err) {
      console.error('Reminder sweep failed:', err);
    } finally {
      sweeping = false;
    }
  }
  const timer = setInterval(() => void sweep(), intervalMs);
  void sweep();
  return () => clearInterval(timer);
}
