import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection';
import { migrate, MIGRATIONS_DIR } from '../src/db/migrate';

const tables = (db: Database.Database) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  )
    .map((r) => r.name)
    .filter((n) => !n.startsWith('sqlite_'));

function tempMigrations(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'todoness-mig-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe('migrate (real migrations)', () => {
  it('creates the schema (mvp/DBModel.md plus the v1 changes) on an empty database', () => {
    const db = new Database(':memory:');
    const applied = migrate(db, MIGRATIONS_DIR);
    expect(applied).toBeGreaterThanOrEqual(1);
    expect(tables(db)).toEqual(
      ['attachments', 'change_log', 'lists', 'processed_ops', 'sessions', 'todos', 'users'].sort(),
    );
    expect(db.pragma('user_version', { simple: true })).toBe(applied);
  });

  it('applies nothing on the second run', () => {
    const db = new Database(':memory:');
    migrate(db, MIGRATIONS_DIR);
    expect(migrate(db, MIGRATIONS_DIR)).toBe(0);
  });
});

describe('migrate (behaviour)', () => {
  it('applies files in numeric order and records the version', () => {
    const dir = tempMigrations({
      '002_b.sql': 'CREATE TABLE b (id INTEGER); INSERT INTO a VALUES (1);',
      '001_a.sql': 'CREATE TABLE a (id INTEGER);',
      '010_c.sql': 'CREATE TABLE c (id INTEGER);',
    });
    const db = new Database(':memory:');
    expect(migrate(db, dir)).toBe(3);
    expect(tables(db)).toEqual(['a', 'b', 'c']);
    expect(db.pragma('user_version', { simple: true })).toBe(10);
  });

  it('only applies files newer than the stored version', () => {
    const dir = tempMigrations({ '001_a.sql': 'CREATE TABLE a (id INTEGER);' });
    const db = new Database(':memory:');
    migrate(db, dir);
    writeFileSync(join(dir, '002_b.sql'), 'CREATE TABLE b (id INTEGER);');
    expect(migrate(db, dir)).toBe(1);
    expect(tables(db)).toEqual(['a', 'b']);
  });

  it('rolls back a failing migration and keeps earlier ones', () => {
    const dir = tempMigrations({
      '001_a.sql': 'CREATE TABLE a (id INTEGER);',
      '002_bad.sql': 'CREATE TABLE b (id INTEGER); THIS IS NOT SQL;',
    });
    const db = new Database(':memory:');
    expect(() => migrate(db, dir)).toThrow(/002_bad\.sql/);
    expect(tables(db)).toEqual(['a']);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('refuses a database that is newer than the code', () => {
    const dir = tempMigrations({ '001_a.sql': 'CREATE TABLE a (id INTEGER);' });
    const db = new Database(':memory:');
    db.pragma('user_version = 5');
    expect(() => migrate(db, dir)).toThrow(/newer/);
  });

  it('rejects duplicate or misnamed migration files', () => {
    const dup = tempMigrations({ '001_a.sql': 'SELECT 1;', '001_b.sql': 'SELECT 1;' });
    expect(() => migrate(new Database(':memory:'), dup)).toThrow(/duplicate/i);
    const bad = tempMigrations({ 'init.sql': 'SELECT 1;' });
    expect(() => migrate(new Database(':memory:'), bad)).toThrow(/name/i);
  });

  it('fails clearly when the directory does not exist', () => {
    expect(() => migrate(new Database(':memory:'), '/nonexistent/migrations')).toThrow(
      /migrations/i,
    );
  });
});

describe('openDatabase', () => {
  it('sets foreign keys on and WAL mode for files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'todoness-db-'));
    mkdirSync(join(dir, 'nested'));
    const db = openDatabase(join(dir, 'nested', 'x.db'));
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.close();
  });

  it('creates missing parent folders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'todoness-db-'));
    const db = openDatabase(join(dir, 'a', 'b', 'x.db'));
    expect(db.open).toBe(true);
    db.close();
  });

  it('works in memory', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('migration 002 (v1)', () => {
  const upTo = (version: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'todoness-mig-'));
    for (const f of readdirSync(MIGRATIONS_DIR)) {
      if (Number(f.slice(0, 3)) <= version) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    return dir;
  };

  it('upgrades a version-1 database and keeps its data', () => {
    const db = new Database(':memory:');
    migrate(db, upTo(1));
    db.exec(`INSERT INTO users (id, email, role, created_at, updated_at) VALUES ('u1','a@b.co','user',1,1);
      INSERT INTO lists (id, user_id, name, order_key, created_at, updated_at) VALUES ('l1','u1','Inbox','a0',1,1);
      INSERT INTO todos (id, user_id, list_id, title, order_key, created_at, updated_at)
        VALUES ('t1','u1','l1','Old task','a0',1,1);`);

    expect(migrate(db, MIGRATIONS_DIR)).toBeGreaterThanOrEqual(1);
    expect(db.prepare('SELECT is_public FROM lists WHERE id = ?').get('l1')).toEqual({
      is_public: 0,
    });
    expect(db.prepare('SELECT remind_before FROM todos WHERE id = ?').get('t1')).toEqual({
      remind_before: null,
    });
    expect(db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get('u1')).toEqual({
      last_seen_at: null,
    });
  });

  it('checks the new columns', () => {
    const db = new Database(':memory:');
    migrate(db, MIGRATIONS_DIR);
    db.exec(`INSERT INTO users (id, email, role, created_at, updated_at) VALUES ('u1','a@b.co','user',1,1);
      INSERT INTO lists (id, user_id, name, order_key, created_at, updated_at) VALUES ('l1','u1','L','a0',1,1);`);
    expect(() => db.exec("UPDATE lists SET is_public = 2 WHERE id = 'l1'")).toThrow();
    db.exec(`INSERT INTO todos (id, user_id, list_id, title, order_key, created_at, updated_at)
      VALUES ('t1','u1','l1','T','a0',1,1)`);
    expect(() => db.exec("UPDATE todos SET remind_before = 'month' WHERE id = 't1'")).toThrow();
    db.exec("UPDATE todos SET remind_before = 'day' WHERE id = 't1'");
  });

  it('removes attachment rows with their task owner (cascade)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, MIGRATIONS_DIR);
    db.exec(`INSERT INTO users (id, email, role, created_at, updated_at) VALUES ('u1','a@b.co','user',1,1);
      INSERT INTO lists (id, user_id, name, order_key, created_at, updated_at) VALUES ('l1','u1','L','a0',1,1);
      INSERT INTO todos (id, user_id, list_id, title, order_key, created_at, updated_at) VALUES ('t1','u1','l1','T','a0',1,1);
      INSERT INTO attachments (id, user_id, todo_id, name, size, content_type, created_at)
        VALUES ('a1','u1','t1','f.txt',3,'text/plain',1);`);
    db.exec("DELETE FROM users WHERE id = 'u1'");
    expect((db.prepare('SELECT COUNT(*) n FROM attachments').get() as { n: number }).n).toBe(0);
  });
});
