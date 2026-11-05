import type Database from 'better-sqlite3';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Next to this file in development, next to `index.js` in the built server. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

const FILE_NAME = /^(\d{3,})_[a-z0-9_]+\.sql$/;

/**
 * Applies the numbered `.sql` files that are newer than `PRAGMA user_version`,
 * each in its own transaction. Returns how many were applied.
 */
export function migrate(db: Database.Database, dir: string): number {
  if (!existsSync(dir)) throw new Error(`Cannot find the migrations folder: ${dir}`);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((file) => {
      const m = FILE_NAME.exec(file);
      if (!m) {
        throw new Error(`Migration file name must look like 001_name.sql (got ${file})`);
      }
      return { file, version: Number(m[1]) };
    })
    .sort((a, b) => a.version - b.version);

  for (let i = 1; i < files.length; i++) {
    if (files[i]!.version === files[i - 1]!.version) {
      throw new Error(`Duplicate migration number: ${files[i]!.file} and ${files[i - 1]!.file}`);
    }
  }

  const current = db.pragma('user_version', { simple: true }) as number;
  const latest = files.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new Error(
      `The database (version ${current}) is newer than this server (version ${latest}). Update the server.`,
    );
  }

  let applied = 0;
  for (const { file, version } of files) {
    if (version <= current) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    try {
      db.exec('BEGIN');
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
    applied++;
  }
  return applied;
}
