# ToDoness Backup – Product Requirements Document (PRD)

|                  |                                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| **Status**       | v1.0 – built (see [ImplementationPlan.md](./ImplementationPlan.md))        |
| **Builds on**    | v1 ([`../v1/PRD.md`](../v1/PRD.md): admin screen, attachments on disk)           |
| **Related docs** | [ImplementationPlan.md](./ImplementationPlan.md)                                 |

> Everything in the earlier PRDs still applies unless this document says otherwise.
> Requirement numbers continue where the Calendar update stopped (FR-232 and up).
> **[Answered]** = said in the request; **[Decision]** = taken here where the request left
> room (section 4).

## 1. Summary

The administrator can switch on **automatic backups** in the Admin screen. The server then
writes a **zip file** with **all data** (the whole database) and **all attachments** (the files
that are on disk, not in the database) into a **backup folder** that is set by an
**environment variable**. The administrator chooses **how often** (every day, week or month)
and **how many backups are kept** (3 by default); older ones are deleted.

## 2. Goals and non-goals

**Goals** – a backup that needs no tools besides the app: switch on, pick a rhythm, find
the zip in a folder; never filling the disk with old backups; a consistent copy of the database
even while people use the app.

**Non-goals** – restoring from the app (restoring stays a manual step, section 5),
downloading or uploading backups through the browser, encrypting or off-site copies (the folder
can be a mounted network disk), per-user backups, backing up the configuration (environment).

## 3. Requirements

- **FR-232** The Admin screen has a **Backup data** section with a switch. **Off by default
  [Answered].** Only administrators see or use it; the API refuses everybody else.
- **FR-233** **Frequency [Answered]:** Daily, Weekly or Monthly (chips). Default Weekly.
- **FR-234** **Backups to keep [Answered]:** a whole number from 1 to 100, default 3, set in the
  Admin screen. Once there are more, **the oldest are deleted** [Answered].
- **FR-235** The **backup folder** is set by the environment variable `BACKUP_DIR` [Answered]; if it is
  not set, it is the folder `backups` next to the database file (decision B1). The Admin screen
  shows the folder and says so when it cannot be written to.
- **FR-236** One backup is **one zip file** [Answered] named `todoness-backup-YYYYMMDD-HHMMSS.zip`
  (UTC), holding: `todoness.db` (a consistent copy of **all data**), `attachments/<user>/<file>`
  (**all attachments**, which are files on disk) and `manifest.json` (when it was made, database
  version, how many files).
- **FR-237** **Schedule:** while the switch is on, a backup is made **at once** when there is none yet,
  and then whenever the period has passed since the last successful one (decision B2). The
  server checks once a minute while it runs. A failed backup is shown with its reason and tried
  again after 15 minutes.
- **FR-238** **Retention:** after every successful backup, and when "backups to keep" is lowered,
  the oldest backups (by name, which is their time) beyond that number are deleted. Only files
  with the backup naming are ever touched; leftovers of an unfinished backup (`.part`) are removed.
- **FR-239** The section shows the **status** (last backup, next backup, running, error), the
  **list of backups** (name, size, time) and a **Back up now** button (decision B3).
- **FR-240** A backup is written to a temporary name and renamed when complete, so a crash never
  leaves something that looks like a backup but is not one.

## 4. Decisions

- **B1** The default `BACKUP_DIR` is next to the database like `ATTACHMENTS_DIR`. In Docker that is
  inside the same volume; for real protection point `BACKUP_DIR` to another disk (README).
- **B2** Periods: day = 24 hours, week = 7 days, month = one calendar month, counted from the
  **last successful backup** (not from fixed clock times), so a server that was off simply makes
  the backup when it is back.
- **B3** "Back up now" is added to the request: it lets the administrator check the setup at once.
  It does not change the schedule.
- **B4** Settings are stored in the database table `app_settings` (they are the administrator's,
  not the environment's); only the folder comes from the environment.
- **B5** The database copy uses SQLite's online backup, so it is consistent while the app is used.
  Attachments are copied file by file (they never change after upload).
- **B6** A backup contains everything, **including password hashes and sessions**: the folder must be
  protected like the database itself (README).
- **B7** The zip is made with the `yazl` library (streaming, small): large attachments are never
  held in memory.

## 5. Restoring (manual)

Stop the server, unzip the backup, replace the database file with `todoness.db` and the attachments
folder with `attachments/`, start the server (README).
