/** The few long-lived objects of the app, created once. */
import { TodonessDB } from '../data/db';
import { createRepo } from '../data/repo';
import { createSyncEngine } from '../sync/engine';
import { browserEnv, createSyncRunner } from '../sync/runner';
import { createSession } from './session';

const request = (url: string, init?: RequestInit) => fetch(url, init);

export const db = new TodonessDB();
export const repo = createRepo(db);
export const engine = createSyncEngine({ db, fetch: request });

export const runner = createSyncRunner({
  engine,
  env: browserEnv(),
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
});

// Every queued change schedules a sync about a second later.
db.outbox.hook('creating', () => {
  runner.notifyChange();
});
