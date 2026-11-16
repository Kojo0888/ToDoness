/**
 * Automatic backups (docs/backup/PRD.md): the settings, one backup (a zip with the database and
 * the attachments), keeping only the newest ones and the schedule.
 */
import type Database from 'better-sqlite3';
import { access, constants, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BACKUP_KEEP_DEFAULT,
  backupFrequencySchema,
  type BackupFrequency,
  type BackupSettings,
  type BackupStatus,
} from '@todoness/shared';
import type { Config } from '../config';
import { listFiles, writeZip, type ZipSource } from './zip';

export type RunResult = { ok: true; name: string } | { ok: false; error: string };

export interface BackupService {
  getStatus(): Promise<BackupStatus>;
  /** Stores the settings, deletes what is beyond "keep", and checks the schedule. */
  saveSettings(settings: BackupSettings): Promise<BackupStatus>;
  /** One backup now. `{ error: 'running' }` when one is already under way. */
  run(): Promise<RunResult>;
  /** Makes a backup when it is switched on and due. Resolves to whether one was made. */
  check(): Promise<boolean>;
}

const DAY_MS = 24 * 3_600_000;
/** After a failed backup the next try comes after this long (FR-237). */
export const RETRY_AFTER_MS = 15 * 60_000;

/** When the next backup is due: a day, a week or a calendar month after `last`. */
export function nextBackupAt(last: number | null, frequency: BackupFrequency): number | null {
  if (last === null) return null;
  if (frequency === 'day') return last + DAY_MS;
  if (frequency === 'week') return last + 7 * DAY_MS;
  const d = new Date(last);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

const NAME = /^todoness-backup-(\d{8})-(\d{6})(?:-(\d+))?\.zip$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** `todoness-backup-YYYYMMDD-HHMMSS` in UTC. */
function stamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/** The time a backup name says, in ms. */
function timeOfName(name: string): number | undefined {
  const m = NAME.exec(name);
  if (!m) return undefined;
  const [, day, time] = m;
  return Date.UTC(
    Number(day!.slice(0, 4)),
    Number(day!.slice(4, 6)) - 1,
    Number(day!.slice(6, 8)),
    Number(time!.slice(0, 2)),
    Number(time!.slice(2, 4)),
    Number(time!.slice(4, 6)),
  );
}

/** Newest last: by time, then by the suffix of the name (`-2` is after the plain name). */
const byAge = (a: string, b: string) => {
  const ta = timeOfName(a)!;
  const tb = timeOfName(b)!;
  return ta - tb || Number(NAME.exec(a)![3] ?? 1) - Number(NAME.exec(b)![3] ?? 1);
};

function getSetting(db: Database.Database, key: string): string | undefined {
  return (
    db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      { value: string } | undefined
  )?.value;
}

function putSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createBackupService({
  db,
  config,
  now = Date.now,
}: {
  db: Database.Database;
  config: Config;
  now?: () => number;
}): BackupService {
  const dir = config.backupDir;
  let running = false;
  let lastError: string | null = null;
  /** When the last attempt failed (in memory: a restart tries again at once). */
  let failedAt: number | null = null;

  function settings(): BackupSettings {
    const frequency = backupFrequencySchema.safeParse(getSetting(db, 'backup_frequency'));
    const keep = Number(getSetting(db, 'backup_keep'));
    return {
      enabled: getSetting(db, 'backup_enabled') === '1',
      frequency: frequency.success ? frequency.data : 'week',
      keep: Number.isInteger(keep) && keep >= 1 ? keep : BACKUP_KEEP_DEFAULT,
    };
  }

  const lastAt = (): number | null => {
    const v = getSetting(db, 'backup_last_at');
    return v === undefined ? null : Number(v);
  };

  async function backupNames(): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((n) => NAME.test(n)).sort(byAge);
    } catch {
      return [];
    }
  }

  /** Deletes the oldest backups beyond `keep`, and leftovers of unfinished ones (FR-238). */
  async function prune(keep: number): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return; // no folder, nothing to do
    }
    for (const n of entries) {
      if (/^todoness-backup-.*\.zip\.part$/.test(n) || /^\.todoness-.*\.db\.tmp$/.test(n)) {
        await rm(join(dir, n), { force: true });
      }
    }
    const names = entries.filter((n) => NAME.test(n)).sort(byAge);
    for (const n of names.slice(0, Math.max(0, names.length - keep))) {
      await rm(join(dir, n), { force: true });
    }
  }

  /** Can the folder be written to? A folder that does not exist yet counts if it can be made. */
  async function writable(): Promise<boolean> {
    let p = dir;
    for (;;) {
      try {
        const s = await stat(p);
        if (!s.isDirectory()) return false;
        await access(p, constants.W_OK);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false;
        const parent = dirname(p);
        if (parent === p) return false;
        p = parent;
      }
    }
  }

  async function getStatus(): Promise<BackupStatus> {
    const s = settings();
    const names = await backupNames();
    const backups = await Promise.all(
      names.map(async (name) => ({
        name,
        size: (await stat(join(dir, name)).catch(() => undefined))?.size ?? 0,
        createdAt: timeOfName(name)!,
      })),
    );
    const last = lastAt();
    return {
      ...s,
      dir,
      writable: await writable(),
      running,
      lastAt: last,
      nextAt: s.enabled ? nextBackupAt(last, s.frequency) : null,
      lastError,
      backups: backups.reverse(),
    };
  }

  async function run(): Promise<RunResult> {
    if (running) return { ok: false, error: 'running' };
    running = true;
    const startedAt = now();
    let part: string | undefined;
    let copy: string | undefined;
    try {
      await mkdir(dir, { recursive: true });
      const base = `todoness-backup-${stamp(startedAt)}`;
      const taken = new Set(await readdir(dir));
      let name = `${base}.zip`;
      for (let n = 2; taken.has(name); n++) name = `${base}-${n}.zip`;
      part = join(dir, `${name}.part`);
      copy = join(dir, `.todoness-${stamp(startedAt)}-${process.pid}.db.tmp`);

      // The online backup of SQLite: a consistent copy while the app is used (decision B5).
      await db.backup(copy);
      const files: ZipSource[] = await listFiles(config.attachmentsDir, 'attachments', dir);
      const manifest = {
        app: 'todoness',
        createdAt: startedAt,
        schemaVersion: db.pragma('user_version', { simple: true }) as number,
        attachments: files.length,
      };
      await writeZip(part, [
        { name: 'manifest.json', text: JSON.stringify(manifest, null, 2) },
        { name: 'todoness.db', file: copy },
        ...files,
      ]);
      await rename(part, join(dir, name));
      part = undefined;

      putSetting(db, 'backup_last_at', String(startedAt));
      lastError = null;
      failedAt = null;
      await prune(settings().keep);
      return { ok: true, name };
    } catch (err) {
      lastError = messageOf(err);
      failedAt = now();
      return { ok: false, error: lastError };
    } finally {
      if (part) await rm(part, { force: true });
      if (copy) await rm(copy, { force: true });
      running = false;
    }
  }

  async function check(): Promise<boolean> {
    const s = settings();
    if (!s.enabled || running) return false;
    if (failedAt !== null && now() < failedAt + RETRY_AFTER_MS) return false;
    const next = nextBackupAt(lastAt(), s.frequency);
    if (next !== null && now() < next) return false;
    return (await run()).ok;
  }

  return {
    getStatus,
    run,
    check,
    async saveSettings(s) {
      putSetting(db, 'backup_enabled', s.enabled ? '1' : '0');
      putSetting(db, 'backup_frequency', s.frequency);
      putSetting(db, 'backup_keep', String(s.keep));
      await prune(s.keep);
      if (s.enabled) void check(); // switched on: the first backup does not wait for the timer
      return getStatus();
    },
  };
}
