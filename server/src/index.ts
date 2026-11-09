import { serve } from '@hono/node-server';
import { createApp } from './app';
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

const app = createApp({ db, config, log: true });

const stopSweeper = startReminderSweeper({
  db,
  send: createWebPushSender(getVapidKeys(db, config), config.vapidSubject),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`ToDoness server listening on http://localhost:${info.port}`);
});

function shutdown() {
  stopSweeper();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
