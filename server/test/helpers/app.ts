import { openDatabase } from '../../src/db/connection';
import { migrate, MIGRATIONS_DIR } from '../../src/db/migrate';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config';

/** A fresh in-memory database with all migrations applied. */
export function testDb() {
  const db = openDatabase(':memory:');
  migrate(db, MIGRATIONS_DIR);
  return db;
}

export function testApp(env: Record<string, string> = {}) {
  const db = testDb();
  const config = loadConfig(env);
  return { app: createApp({ db, config }), db, config };
}
