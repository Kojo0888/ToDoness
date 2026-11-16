/** Automatic backups (docs/backup/PRD.md). */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackupService, nextBackupAt, type BackupService } from '../src/backup/service';
import { loadConfig } from '../src/config';
import { testDb } from './helpers/app';
import { readZip } from './helpers/zip';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 15, 10, 0, 0);

function setup(env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'todoness-backup-'));
  const config = loadConfig({
    DATABASE_PATH: join(root, 'todoness.db'),
    ATTACHMENTS_DIR: join(root, 'attachments'),
    BACKUP_DIR: join(root, 'backups'),
    ...env,
  });
  const db = testDb();
  db.prepare(
    "INSERT INTO users (id, email, role, created_at, updated_at) VALUES ('u1', 'ann@corp.test', 'admin', 1, 1)",
  ).run();
  let t = T0;
  const clock = {
    now: () => t,
    set: (v: number) => void (t = v),
    advance: (ms: number) => void (t += ms),
  };
  const service = createBackupService({ db, config, now: clock.now });
  const files = () => (existsSync(config.backupDir) ? readdirSync(config.backupDir).sort() : []);
  const zips = () => files().filter((f) => f.endsWith('.zip'));
  const attach = (user: string, id: string, content: string) => {
    mkdirSync(join(config.attachmentsDir, user), { recursive: true });
    writeFileSync(join(config.attachmentsDir, user, id), content);
  };
  return { root, config, db, clock, service, files, zips, attach };
}

let s: ReturnType<typeof setup>;
beforeEach(() => {
  s = setup();
});

describe('nextBackupAt (FR-237, decision B2)', () => {
  it('is nothing before the first backup, then a day, a week or a calendar month later', () => {
    expect(nextBackupAt(null, 'day')).toBeNull();
    expect(nextBackupAt(T0, 'day')).toBe(T0 + DAY);
    expect(nextBackupAt(T0, 'week')).toBe(T0 + 7 * DAY);
    expect(nextBackupAt(T0, 'month')).toBe(Date.UTC(2026, 11, 15, 10, 0, 0));
    // 31 January + one month is the end of February, not March.
    expect(nextBackupAt(Date.UTC(2026, 0, 31, 8, 0, 0), 'month')).toBe(
      Date.UTC(2026, 1, 28, 8, 0, 0),
    );
  });
});

describe('settings (FR-232 – FR-234)', () => {
  it('start off, weekly, keeping 3, with the folder from the environment', async () => {
    const st = await s.service.getStatus();
    expect(st).toMatchObject({
      enabled: false,
      frequency: 'week',
      keep: 3,
      dir: s.config.backupDir,
      running: false,
      lastAt: null,
      nextAt: null,
      lastError: null,
      backups: [],
    });
  });

  it('are stored and read back', async () => {
    await s.service.saveSettings({ enabled: true, frequency: 'month', keep: 7 });
    expect(await s.service.getStatus()).toMatchObject({
      enabled: true,
      frequency: 'month',
      keep: 7,
    });
    const rows = s.db
      .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'backup_%'")
      .all();
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: 'backup_enabled', value: '1' },
        { key: 'backup_frequency', value: 'month' },
        { key: 'backup_keep', value: '7' },
      ]),
    );
  });
});

describe('a backup (FR-236, FR-240)', () => {
  it('is one zip with the database, the attachments and a manifest', async () => {
    s.attach('u1', 'file-a', 'hello attachment');
    s.attach('u2', 'file-b', 'x'.repeat(100_000));
    const r = await s.service.run();
    expect(r).toMatchObject({ ok: true });
    expect(s.zips()).toEqual(['todoness-backup-20261115-100000.zip']);
    expect(s.files()).toEqual(s.zips()); // nothing else is left behind

    const zip = readZip(join(s.config.backupDir, s.zips()[0]!));
    expect([...zip.keys()].sort()).toEqual([
      'attachments/u1/file-a',
      'attachments/u2/file-b',
      'manifest.json',
      'todoness.db',
    ]);
    expect(zip.get('attachments/u1/file-a')!.toString()).toBe('hello attachment');
    expect(zip.get('attachments/u2/file-b')!.length).toBe(100_000);
    const manifest = JSON.parse(zip.get('manifest.json')!.toString());
    expect(manifest).toMatchObject({ app: 'todoness', createdAt: T0, attachments: 2 });
    expect(typeof manifest.schemaVersion).toBe('number');
  });

  it('holds a database that opens and has all the data', async () => {
    await s.service.run();
    const zip = readZip(join(s.config.backupDir, s.zips()[0]!));
    const copy = join(s.root, 'restored.db');
    writeFileSync(copy, zip.get('todoness.db')!);
    const restored = new Database(copy, { readonly: true });
    expect(restored.prepare('SELECT email FROM users').all()).toEqual([{ email: 'ann@corp.test' }]);
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    restored.close();
  });

  it('works without any attachments, and without an attachments folder', async () => {
    expect(await s.service.run()).toMatchObject({ ok: true });
    const zip = readZip(join(s.config.backupDir, s.zips()[0]!));
    expect([...zip.keys()].sort()).toEqual(['manifest.json', 'todoness.db']);
  });

  it('leaves out unfinished uploads, and the backup folder itself when it lies inside the attachments', async () => {
    // ATTACHMENTS_DIR=/data and BACKUP_DIR=/data/backups: a backup must not contain the backups.
    const t = setup();
    const cfg = loadConfig({
      DATABASE_PATH: join(t.root, 'todoness.db'),
      ATTACHMENTS_DIR: t.root,
      BACKUP_DIR: join(t.root, 'backups'),
    });
    mkdirSync(join(t.root, 'u1'), { recursive: true });
    writeFileSync(join(t.root, 'u1', 'real'), 'data');
    writeFileSync(join(t.root, 'u1', 'half.part'), 'unfinished');
    const svc = createBackupService({ db: t.db, config: cfg, now: t.clock.now });
    await svc.run();
    t.clock.advance(2000);
    await svc.run(); // the second zip must not contain the first
    const names = readdirSync(cfg.backupDir)
      .filter((f) => f.endsWith('.zip'))
      .sort();
    expect(names).toHaveLength(2);
    const second = readZip(join(cfg.backupDir, names[1]!));
    expect([...second.keys()].filter((k) => k.startsWith('attachments/'))).toEqual([
      'attachments/u1/real',
    ]);
  });

  it('records the time of the last success and a unique name when two share a second', async () => {
    await s.service.run();
    await s.service.run();
    expect(s.zips()).toHaveLength(2);
    expect(s.zips()).toEqual([
      'todoness-backup-20261115-100000-2.zip', // '-' sorts before '.'
      'todoness-backup-20261115-100000.zip',
    ]);
    // ... but the second one is the newer one: it is the last to go.
    await s.service.saveSettings({ enabled: false, frequency: 'week', keep: 1 });
    expect(s.zips()).toEqual(['todoness-backup-20261115-100000-2.zip']);
    expect((await s.service.getStatus()).lastAt).toBe(T0);
  });

  it('refuses to start while one is running', async () => {
    const first = s.service.run();
    const second = await s.service.run();
    expect(second).toEqual({ ok: false, error: 'running' });
    await first;
  });

  it('a failure leaves no file, keeps the message and does not count as a success', async () => {
    // A file where the folder should be: the folder cannot be created.
    writeFileSync(s.config.backupDir, 'not a folder');
    const r = await s.service.run();
    expect(r.ok).toBe(false);
    const st = await s.service.getStatus();
    expect(st.lastAt).toBeNull();
    expect(st.lastError).toBeTruthy();
    expect(st.writable).toBe(false);
  });
});

describe('retention (FR-238)', () => {
  it('keeps the newest 3 by default and deletes the oldest', async () => {
    const names: string[] = [];
    for (let i = 0; i < 5; i++) {
      await s.service.run();
      names.push(...s.zips().filter((n) => !names.includes(n)));
      s.clock.advance(DAY);
    }
    expect(s.zips()).toEqual(names.slice(2));
    expect(s.zips()).toHaveLength(3);
  });

  it('lowering the number deletes at once; the newest is never removed', async () => {
    for (let i = 0; i < 4; i++) {
      await s.service.run();
      s.clock.advance(DAY);
    }
    await s.service.saveSettings({ enabled: false, frequency: 'week', keep: 1 });
    expect(s.zips()).toEqual(['todoness-backup-20261118-100000.zip']);
  });

  it('raising the number keeps more', async () => {
    await s.service.saveSettings({ enabled: false, frequency: 'week', keep: 5 });
    for (let i = 0; i < 6; i++) {
      await s.service.run();
      s.clock.advance(DAY);
    }
    expect(s.zips()).toHaveLength(5);
  });

  it('only touches its own files; stale partial files are removed', async () => {
    mkdirSync(s.config.backupDir, { recursive: true });
    for (const f of ['notes.txt', 'todoness-2026-01-01.db', 'todoness-backup-old.zip']) {
      writeFileSync(join(s.config.backupDir, f), 'mine');
    }
    writeFileSync(join(s.config.backupDir, 'todoness-backup-20260101-000000.zip.part'), 'half');
    writeFileSync(join(s.config.backupDir, '.todoness-20260101-000000.db.tmp'), 'half');
    for (let i = 0; i < 4; i++) {
      await s.service.run();
      s.clock.advance(DAY);
    }
    expect(s.files()).toEqual(
      expect.arrayContaining(['notes.txt', 'todoness-2026-01-01.db', 'todoness-backup-old.zip']),
    );
    expect(s.files().some((f) => f.endsWith('.part') || f.endsWith('.tmp'))).toBe(false);
    expect(s.zips().filter((f) => /^todoness-backup-\d{8}-\d{6}/.test(f))).toHaveLength(3);
  });
});

describe('the schedule (FR-237)', () => {
  const enable = (frequency: 'day' | 'week' | 'month', keep = 3) =>
    s.service.saveSettings({ enabled: true, frequency, keep });
  const settle = async (svc: BackupService = s.service) => {
    // `saveSettings` may start a backup in the background: wait until none is running.
    for (let i = 0; i < 200 && (await svc.getStatus()).running; i++)
      await new Promise((r) => setTimeout(r, 10));
  };

  it('does nothing while it is off', async () => {
    expect(await s.service.check()).toBe(false);
    expect(s.zips()).toEqual([]);
  });

  it('makes the first backup at once when it is switched on', async () => {
    await enable('week');
    await settle();
    expect(s.zips()).toHaveLength(1);
    expect((await s.service.getStatus()).nextAt).toBe(T0 + 7 * DAY);
  });

  it.each([
    ['day', DAY],
    ['week', 7 * DAY],
  ] as const)('%s: waits for the period, then makes the next one', async (frequency, period) => {
    await enable(frequency);
    await settle();
    s.clock.advance(period - MIN);
    expect(await s.service.check()).toBe(false);
    s.clock.advance(MIN);
    expect(await s.service.check()).toBe(true);
    expect(s.zips()).toHaveLength(2);
  });

  it('month: a calendar month after the last one', async () => {
    await enable('month');
    await settle();
    s.clock.set(Date.UTC(2026, 11, 15, 9, 59, 0));
    expect(await s.service.check()).toBe(false);
    s.clock.set(Date.UTC(2026, 11, 15, 10, 0, 0));
    expect(await s.service.check()).toBe(true);
  });

  it('a server that was off makes one backup when it is back, not one per missed period', async () => {
    await enable('day');
    await settle();
    s.clock.advance(10 * DAY);
    expect(await s.service.check()).toBe(true);
    expect(await s.service.check()).toBe(false);
    expect(s.zips()).toHaveLength(2);
  });

  it('after a failure it tries again after 15 minutes, and shows the reason meanwhile', async () => {
    writeFileSync(s.config.backupDir, 'not a folder');
    await enable('day');
    await settle();
    expect((await s.service.getStatus()).lastError).toBeTruthy();
    s.clock.advance(14 * MIN);
    expect(await s.service.check()).toBe(false);
    // The problem is fixed: the folder can be made.
    (await import('node:fs')).rmSync(s.config.backupDir);
    s.clock.advance(MIN);
    expect(await s.service.check()).toBe(true);
    expect((await s.service.getStatus()).lastError).toBeNull();
  });

  it('turning it off stops the schedule', async () => {
    await enable('day');
    await settle();
    await s.service.saveSettings({ enabled: false, frequency: 'day', keep: 3 });
    s.clock.advance(5 * DAY);
    expect(await s.service.check()).toBe(false);
  });
});

describe('the list (FR-239)', () => {
  it('shows each backup with its size and time, newest first', async () => {
    await s.service.run();
    s.clock.advance(DAY);
    await s.service.run();
    const { backups } = await s.service.getStatus();
    expect(backups.map((b) => b.name)).toEqual([
      'todoness-backup-20261116-100000.zip',
      'todoness-backup-20261115-100000.zip',
    ]);
    expect(backups[0]!.size).toBeGreaterThan(0);
    expect(backups[0]!.createdAt).toBe(Date.UTC(2026, 10, 16, 10, 0, 0));
  });
});
