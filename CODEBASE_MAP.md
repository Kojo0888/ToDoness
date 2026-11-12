# Codebase map (for AI agents and new contributors)

Where things are, so a change can start in the right file without reading the whole repo.
Read [`AGENTS.md`](./AGENTS.md) first (order of work, UI rules). Keep this file up to date
when you add, move or remove a folder or a central file.

## 1. The big picture

ToDoness is an **offline-first** todo / notes / plan app. A pnpm workspace with five packages:

| Package        | What it is                                                                   | Tests                                    |
| -------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| `shared/`      | Zod schemas, types, HLC clock, merge rules, plan rules – used by both sides  | `shared/test/` (vitest)                  |
| `server/`      | Node + Hono HTTP API, SQLite (better-sqlite3), web push, reminder sweeper    | `server/test/` (vitest, in-process app)  |
| `client/`      | React + Vite PWA, IndexedDB via Dexie, sync engine, service worker           | `client/test/` (vitest + fake-indexeddb) |
| `integration/` | The real client sync engine against a real in-process server                 | `integration/test/`                      |
| `e2e/`         | Playwright browser tests against the **built** app (`pnpm e2e` builds first) | `e2e/test/`                              |

**Data flow.** UI → `client/src/data/repo.ts` (the only code that changes data) writes to
Dexie **and** queues a sync operation in the `outbox` → `client/src/sync/engine.ts` pushes it
to `POST /api/sync/push` → `server/src/sync/apply-ops.ts` merges it per field (last write
wins by HLC, `shared/src/merge.ts`) into SQLite and the `change_log` → other devices
`GET /api/sync/pull` → `client/src/sync/apply-changes.ts` merges into Dexie → screens update
through `useLiveQuery`.

**Entities:** `todo`, `list` (task lists and note lists, `module` field), `note`, `plan`,
`activity`. Rows are soft-deleted (`deletedAt`) and carry `fieldHlc` (per-field clocks).

## 2. Where to find what

### `shared/src/`

| File              | Contents                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `schemas.ts`      | **All data shapes**: row schemas, create / update patch schemas, sync op and pull schemas, limits (`*_MAX`) |
| `merge.ts`        | `applyOp`: applies an operation to a row; defaults for new rows; required fields on create                  |
| `plan.ts`         | Calendar days (`YYYY-MM-DD`) and dependency rules: `liveLinks`, `schedulePlan`, `wouldLoop`…                |
| `hlc.ts`, `id.ts` | Hybrid logical clock, ids created on the device                                                             |
| `reminders.ts`    | Reminder times of a task                                                                                    |
| `api.ts`          | Request / response envelopes of the HTTP API                                                                |

### `server/src/`

| Path                              | Contents                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`, `app.ts`, `config.ts` | Process entry, Hono app composition, environment configuration                                                                                 |
| `routes/*.ts`                     | One file per API area: `auth`, `admin`, `sync` (push / pull, **compat flags for older apps**), `public`, `attachments`, `push`, `ntfy`, `meta` |
| `sync/apply-ops.ts`               | Applying pushed operations: ownership checks, merge, `change_log`                                                                              |
| `sync/rows.ts`                    | Row ↔ SQLite mapping for every entity (`get*` / `save*`)                                                                                       |
| `db/migrations/NNN_*.sql`         | Numbered SQL migrations (applied by `db/migrate.ts` via `PRAGMA user_version`)                                                                 |
| `auth/`                           | Users, sessions, passwords, rate limits (sign-up: 20 per hour per address), presence                                                           |
| `push/`                           | Web push keys and sending, ntfy, the reminder sweeper                                                                                          |
| `http/`                           | Errors, static files, shutdown, context types                                                                                                  |
| `attachments/storage.ts`          | Uploaded files on disk                                                                                                                         |

### `client/src/`

| Path                  | Contents                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx`            | Entry point                                                                                                                                                                                                                                         |
| `app/App.tsx`         | Root: session, splash, login or shell                                                                                                                                                                                                               |
| `app/container.ts`    | Long-lived singletons: `db`, `repo`, sync runner, services                                                                                                                                                                                          |
| `app/strings.ts`      | **Every UI text** (`t.plan.*`, `t.todo.*`, …) – change copy here                                                                                                                                                                                    |
| `app/hooks.ts`        | React hooks over the container (connectivity, sync status…)                                                                                                                                                                                         |
| `data/db.ts`          | Dexie schema and **versions / upgrades** (add a version for any local data change)                                                                                                                                                                  |
| `data/repo.ts`        | **All writes**: create / update / delete of every entity, queues sync ops                                                                                                                                                                           |
| `data/queries.ts`     | Reads used by the screens                                                                                                                                                                                                                           |
| `data/recovery.ts`    | Snapshot kept aside after a server loss                                                                                                                                                                                                             |
| `sync/engine.ts`      | Push / pull HTTP (the pull URL carries the compat flags), `sync/apply-changes.ts` merges pulled changes, `sync/runner.ts` schedules syncs                                                                                                           |
| `services/`           | Logic without UI: session, push, reminders, public lists / notes, recovery, `planChanges` (undo + serial changes of a plan page)                                                                                                                    |
| `lib/`                | Small pure helpers, unit tested: dates, drag-and-drop, `modules.ts` (module list), `timeline.ts` (plan geometry, scales, arrows), `planNames.ts` / `planScale.ts` / `planHideDone.ts` (device settings), `planUndo.ts`, `doubleTap.ts`, `serial.ts` |
| `components/layout/`  | `Shell.tsx` (**routes**), `Sidebar.tsx`, `ModuleSwitch.tsx`, sync badge / diagnostics                                                                                                                                                               |
| `components/common/`  | Reusable controls: `ConfirmDialog`, `Toast` (Undo messages), `InfoTip`, `SettingRow`, `ManageItems`, drag and drop                                                                                                                                  |
| `components/lists/`   | Tasks module: `ListPage`, `TodoRow`, `TaskDetail`, `QuickAdd`, `ManageLists`, `ListMenu`                                                                                                                                                            |
| `components/notes/`   | Notes module: `NotesPage`, `NoteEditor`, `NoteSearch`, `PublicNotesPage`                                                                                                                                                                            |
| `components/plan/`    | Plan module: `PlansHome`, `PlanPage` (toolbar, undo), `Timeline` (grid, blocks, drag, arrows), `ActivityPage` (details view), `PlanOptions` (gear panel), `ManagePlans`                                                                             |
| `components/public/`  | Other users' public lists                                                                                                                                                                                                                           |
| `components/account/` | Login, settings, admin, reminders, ntfy, recovery dialog                                                                                                                                                                                            |
| `styles.css`          | All styles, one file, sections per area (search `/* ---------- Plan module`); colours only from `:root` variables                                                                                                                                   |
| `sw/`                 | Service worker (`sw.ts`) and its tested logic (`sw-logic.ts`)                                                                                                                                                                                       |

### Tests

Tests mirror the source folders: `client/test/data/` tests `client/src/data/`, and so on.
Helpers: `client/test/helpers/db.ts` (`testRepo`, fake time, `expectValidOutbox`),
`server/test/helpers/` (`testApp`, `registerDevice`, `op`, `hlcAt`), `e2e/test/harness.ts`
(start the built app, sign up, devices). E2E tests sign up one user per test — mind the
sign-up rate limit (≈ 20 per test file).

### Docs

`docs/<feature>/PRD.md` (requirements FR-n, decisions) and `ImplementationPlan.md` (design,
steps, "changed on the way"): `mvp`, `v1` (+ `Decisions.md`, `TechStack.md`), `notes`,
`note-lists`, `ui-refresh`, `plan`. Requirement numbers continue across documents (latest:
`docs/plan/PRD.md`). Older docs may name file paths from before the current layout.

## 3. Recipes: which files a typical change touches

**Add a field to a synced entity** (example: `done` on activities, docs/plan Update 3):

1. `shared/src/schemas.ts` – the field in `<entity>Fields`, optional in the create patch;
   `shared/src/merge.ts` – its default.
2. `server/src/db/migrations/NNN_*.sql` – new column; `server/src/sync/rows.ts` – read / write it.
3. Older apps refuse unknown fields: in `server/src/routes/sync.ts` strip it unless the pull
   carries a new flag; add the flag in `client/src/sync/engine.ts` and `server/test/helpers/sync.ts`.
4. `client/src/data/db.ts` – new Dexie version: default the field, reset `lastServerSeq`.
5. `client/src/data/repo.ts` – write it (and in `restoreSnapshot`).
6. Tests: `shared/test`, `server/test` (+ `migrate.test.ts`), `client/test/data`.

**Add a screen / route:** component in `client/src/components/<area>/`, route in
`components/layout/Shell.tsx` (more specific paths first), texts in `app/strings.ts`, styles
in `styles.css`, e2e test in `e2e/test/<area>.test.ts`.

**Change UI text:** `client/src/app/strings.ts` only (e2e tests find controls by these names).

**Add a device setting** (stored in `localStorage`): a small module like
`client/src/lib/planScale.ts` with a unit test like `client/test/lib/planScale.test.ts`.

**Add a module** (like Plan): `client/src/lib/modules.ts`, `ModuleSwitch.tsx`, `Sidebar.tsx`,
`Shell.tsx`, plus entity steps above.

## 4. Commands

`pnpm typecheck`, `pnpm test` (shared, server, client, integration), `pnpm lint`,
`pnpm format:check` (fix with `pnpm format`), `pnpm e2e` (builds, then browser tests; one
file: `pnpm build && cd e2e && npx vitest run test/plan.test.ts`). Single unit test file:
`cd client && npx vitest run test/lib/timeline.test.ts`.
