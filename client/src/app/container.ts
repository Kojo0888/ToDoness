/** The few long-lived objects of the app, created once. */
import { TodonessDB } from '../data/db';
import { createRepo } from '../data/repo';
import { createConnectivity } from '../sync/connectivity';
import { createSyncDiagnostics } from '../sync/diagnostics';
import { createSyncEngine } from '../sync/engine';
import { browserEnv, createSyncRunner } from '../sync/runner';
import { releasePushForLogout } from '../services/push';
import { createPublicEditor } from '../services/publicEdit';
import { createPublicNotes } from '../services/publicNotes';
import { createReminderFeed } from '../services/reminderFeed';
import {
  createReminderScheduler,
  reminderText,
  showSystemNotification,
} from '../services/reminders';
import { createRecovery } from '../services/recovery';
import { createSession } from '../services/session';

const request = (url: string, init?: RequestInit) => fetch(url, init);

export const db = new TodonessDB();
export const repo = createRepo(db);
export const publicEditor = createPublicEditor({ db, fetch: request });
/** Other users' public notes: read and edited online (docs/notes/PRD.md FR-95 – FR-97). */
export const publicNotes = createPublicNotes({ db, fetch: request });
/**
 * Whether the server can be reached, as the app found out. The UI uses this, not the
 * browser's `navigator.onLine`, which can be wrong (see sync/connectivity.ts).
 */
export const connectivity = createConnectivity(navigator.onLine);

/** What the sync does and how long it takes; shown to admins (see SyncBadge). */
export const syncDiag = createSyncDiagnostics();
export const engine = createSyncEngine({ db, fetch: request, diag: syncDiag });

export const runner = createSyncRunner({
  engine,
  env: browserEnv(),
  diag: syncDiag,
  connectivity,
  onAuthRequired: () => void session.requireLogin(),
});

export const session = createSession({
  db,
  engine,
  fetch: request,
  resumeSync: () => {
    runner.start();
    runner.trigger();
  },
  stopSync: () => runner.stop(),
  confirm: (message) => window.confirm(message),
  beforeLogout: () => releasePushForLogout(),
});

/** Offers to put the data of an old account back after the server lost its database. */
export const recovery = createRecovery({ db, repo });

/** Reminders shown inside the app, and the scheduler that creates them (FR-45, FR-46). */
export const reminderFeed = createReminderFeed();
export const reminders = createReminderScheduler({
  db,
  notify(reminder) {
    const { title, body } = reminderText(reminder, Date.now());
    reminderFeed.push({
      key: reminder.key,
      title,
      body,
      href: `/l/${reminder.todo.listId}/t/${reminder.todo.id}`,
    });
    return showSystemNotification({ title, body, tag: reminder.key });
  },
});

// Every queued change schedules a sync about a second later.
db.outbox.hook('creating', () => {
  runner.notifyChange();
});
