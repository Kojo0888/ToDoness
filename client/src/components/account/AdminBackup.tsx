import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  BACKUP_FREQUENCIES,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  type BackupFrequency,
  type BackupSettings,
  type BackupStatus,
} from '@todoness/shared';
import { t } from '../../app/strings';
import { fetchBackup, runBackup, saveBackup } from '../../services/adminApi';
import { formatSize } from '../../services/attachments';
import { SettingRow } from '../common/SettingRow';

const REFRESH_MS = 5000;
const when = (ms: number) => new Date(ms).toLocaleString();

/**
 * The "Backup data" section of the Admin screen (docs/backup/PRD.md FR-232 – FR-239): the
 * switch, the frequency, how many backups to keep, the status, Back up now and the list.
 */
export function AdminBackup() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What is typed in "Backups to keep"; `null` = show the saved number.
  const [draft, setDraft] = useState<string | null>(null);

  const apply = useCallback((r: { ok: boolean; status?: BackupStatus }) => {
    if (r.ok && r.status) {
      setStatus(r.status);
      setError(null);
    }
  }, []);

  // Load now, then every few seconds, so a running backup and the list stay current.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void fetchBackup().then((r) => {
        if (!cancelled) apply(r.ok ? r : { ok: false });
      });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apply]);

  async function save(change: Partial<BackupSettings>) {
    if (!status) return;
    const settings: BackupSettings = {
      enabled: status.enabled,
      frequency: status.frequency,
      keep: status.keep,
      ...change,
    };
    setStatus({ ...status, ...settings }); // shown at once; the answer then confirms it
    const r = await saveBackup(settings);
    if (r.ok) apply(r);
    else {
      setError(t.admin.backup.saveFailed);
      apply(await fetchBackup());
    }
  }

  async function commitKeep(e?: FormEvent) {
    e?.preventDefault();
    const n = Number(draft);
    setDraft(null);
    if (draft === null || !Number.isInteger(n) || n < BACKUP_KEEP_MIN || n > BACKUP_KEEP_MAX)
      return;
    if (n !== status?.keep) await save({ keep: n });
  }

  async function backUpNow() {
    const r = await runBackup();
    if (r.ok) apply(r);
    else if (!r.running) setError(t.admin.backup.saveFailed);
    apply(await fetchBackup());
  }

  if (!status) return null;
  const b = t.admin.backup;
  const problem = status.lastError
    ? b.failed(status.lastError)
    : !status.writable
      ? b.notWritable
      : undefined;

  return (
    <SettingRow
      title={b.title}
      info={b.info}
      checked={status.enabled}
      onChange={(enabled) => void save({ enabled })}
      {...(problem ? { status: problem, statusKind: 'error' as const } : {})}
    >
      <div className="backup-body">
        <div className="chip-group" role="group" aria-label={b.frequency}>
          {BACKUP_FREQUENCIES.map((f: BackupFrequency) => (
            <button
              key={f}
              type="button"
              className={`chip${status.frequency === f ? ' is-selected' : ''}`}
              aria-pressed={status.frequency === f}
              onClick={() => void save({ frequency: f })}
            >
              {b.frequencies[f]}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void commitKeep(e)}>
          <label>
            {b.keep}
            <input
              type="number"
              min={BACKUP_KEEP_MIN}
              max={BACKUP_KEEP_MAX}
              value={draft ?? String(status.keep)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitKeep()}
            />
          </label>
        </form>

        <p className="backup-meta">{b.folder(status.dir)}</p>
        <p className="backup-meta" role="status">
          {status.running
            ? b.running
            : status.lastAt === null
              ? b.noBackup
              : b.lastBackup(when(status.lastAt))}
          {status.nextAt !== null && !status.running && ` ${b.nextBackup(when(status.nextAt))}`}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div>
          <button type="button" disabled={status.running} onClick={() => void backUpNow()}>
            {b.now}
          </button>
        </div>

        {status.backups.length > 0 && (
          <ul className="backup-list" aria-label={b.list}>
            {status.backups.map((f) => (
              <li key={f.name}>
                <span>{f.name}</span>
                <span className="hint">
                  {formatSize(f.size)} · {when(f.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingRow>
  );
}
