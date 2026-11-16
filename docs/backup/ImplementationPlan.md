# ToDoness Backup – Implementation plan

> Requirements: [PRD.md](./PRD.md).

Status legend: ☐ not started · ◐ in progress · ☑ done

| Step | Content                                                                                      | Status |
| ---- | -------------------------------------------------------------------------------------------- | ------ |
| 1    | Shared: `backupSettingsSchema`, `BackupStatus` (api.ts); server config `BACKUP_DIR`           | ☑      |
| 2    | Server: `backup/zip.ts`, `backup/service.ts` (settings, run, retention, schedule), scheduler    | ☑      |
| 3    | Server: admin routes `GET/PUT /api/admin/backup`, `POST /api/admin/backup/run`; `index.ts`     | ☑      |
| 4    | Client: `adminApi` functions, `AdminBackup` section, texts, styles                            | ☑      |
| 5    | Tests first for each step; e2e; README, `.env`/compose notes, CODEBASE_MAP                    | ☑      |

## Design

- **Config:** `backupDir` = `BACKUP_DIR` or `join(dirname(DATABASE_PATH), 'backups')`.
- **Settings** in `app_settings` (`backup_enabled` `'1'|'0'`, `backup_frequency`
  `day|week|month`, `backup_keep` `'1'…'100'`, `backup_last_at` epoch ms of the last success).
  Defaults: off, week, 3, never.
- **`createBackupService({ db, config, now })`** returns:
  `getStatus()` (settings, folder, writable, last / next time, running, last error, the list of
  backups), `saveSettings(s)` (stores them, prunes, and checks the schedule), `run()` (one backup
  now; refuses when one is running), `check()` (runs one when switched on and due; used by the
  scheduler and after saving), `nextBackupAt(last, frequency)` (pure, exported).
- **A backup (`run`)**: create the folder; `db.backup(tmp)` (online backup); stream a zip
  (`yazl`) to `<name>.part` holding `todoness.db`, `manifest.json` and every file under
  `attachmentsDir` (skipping `.part` files and anything inside `backupDir`); rename to
  `todoness-backup-YYYYMMDD-HHMMSS.zip` (a `-2`, `-3`… suffix if the name is taken); delete the
  temporary database copy; store `backup_last_at`; prune. On failure the temporary files are removed
  and the message is kept for the status (and a 15 minute retry delay).
- **Prune:** list `^todoness-backup-\d{8}-\d{6}(-\d+)?\.zip$`, sort by name, delete all but the
  newest `keep`; delete `*.part` and the temporary database copy.
- **`startBackupScheduler(service, intervalMs = 60_000)`** calls `check()` now and every
  interval; never overlaps; stopped on shutdown (`index.ts`).
- **Routes** (`routes/admin.ts`, already admin-only): `GET /backup` → `BackupStatus`; `PUT /backup`
  with `{ enabled, frequency, keep }` (validated) → status; `POST /backup/run` → `202` with the
  status (the backup runs on in the background), `409` when one is running.
- **Client:** `AdminBackup` (below the users table): switch, frequency chips, number field
  "Backups to keep" (saved on Enter / blur), status lines, Back up now, list of backups; refreshes
  every 5 s with the page. Texts in `t.admin.backup`.

## Changed on the way

- The users table of the Admin screen scrolls inside its own box (`.table-scroll`), so the page does
  not scroll sideways on a phone (found by the phone test of the new section).
- Switch and chips update the screen at once; the answer of the server then confirms them.
