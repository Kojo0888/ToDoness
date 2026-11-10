import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp, ntfySenderFor } from './app';
import { closeServer } from './http/shutdown';
import { deleteExpiredSessions } from './auth/sessions';
import { loadConfig } from './config';
import { openDatabase } from './db/connection';
import { migrate, MIGRATIONS_DIR } from './db/migrate';
import { getVapidKeys } from './push/keys';
import { createWebPushSender } from './push/sender';
import { startReminderSweeper } from './push/sweeper';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const applied = migrate(db, MIGRATIONS_DIR);
if (applied > 0) console.log(`Applied ${applied} database migration(s)`);

deleteExpiredSessions(db, Date.now());

const ntfySend = ntfySenderFor(config);
const app = createApp({ db, config, log: true, ...(ntfySend ? { ntfySend } : {}) });

const stopSweeper = startReminderSweeper({
  db,
  send: createWebPushSender(getVapidKeys(db, config), config.vapidSubject),
  ...(ntfySend ? { sendNtfy: ntfySend } : {}),
});
if (ntfySend) console.log(`Reminders through ntfy are on (${config.ntfyUrl})`);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`ToDoness server listening on http://localhost:${info.port}`);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  stopSweeper();
  // Requests under way get a moment to finish; connections left over are then closed, so a
  // browser's unused pre-connected socket cannot keep the process alive.
  void closeServer(server as Server).then(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
