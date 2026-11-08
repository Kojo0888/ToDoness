import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/connection';
import { migrate, MIGRATIONS_DIR } from './db/migrate';
import { deleteExpiredSessions } from './auth/sessions';
import { getVapidKeys } from './push/keys';
import { sweepReminders } from './push/reminders';
import { createWebPushSender } from './push/sender';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const applied = migrate(db, MIGRATIONS_DIR);
if (applied > 0) console.log(`Applied ${applied} database migration(s)`);

deleteExpiredSessions(db, Date.now());

const app = createApp({ db, config, log: true });

// Push reminders every 30 seconds, also when nobody has the app open (FR-61).
const send = createWebPushSender(getVapidKeys(db, config), config.vapidSubject);
let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    await sweepReminders({ db, send, now: Date.now() });
  } catch (err) {
    console.error('Reminder sweep failed:', err);
  } finally {
    sweeping = false;
  }
}
const sweepTimer = setInterval(() => void sweep(), 30_000);
void sweep();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`ToDoness server listening on http://localhost:${info.port}`);
});

function shutdown() {
  clearInterval(sweepTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
