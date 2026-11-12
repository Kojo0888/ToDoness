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
import { createPublicData } from '../services/publicData';
import { createReminderFeed } from '../services/reminderFeed';
import {
  createReminderScheduler,
  reminderText,
  showSystemNotification,
} from '../services/reminders';
import { createRecovery } from '../services/recovery';
import { createSession } from '../services/session';
import { browserStorage } from '../lib/modules';
import { localNotificationsOn } from '../lib/notifyPref';

const request = (url: string, init?: RequestInit) => fetch(url, init);

export const db = new TodonessDB();
export const repo = createRepo(db);
/** Changes to other users' public lists and notes: queued, sent by the sync (FR-107). */
export const publicEditor = createPublicEditor({ db });
export const publicNotes = createPublicNotes({ db });
/** Copies of other users' public lists and notes, readable offline (FR-106). */
export const publicData = createPublicData({ db, fetch: request });
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
    // Switched off on this device (FR-120): the reminder counts as handled, so turning
    // notifications on again does not bring back a burst of old ones.
    if (!localNotificationsOn(browserStorage())) return;
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
db.publicOutbox.hook('creating', () => {
  runner.notifyChange();
});
