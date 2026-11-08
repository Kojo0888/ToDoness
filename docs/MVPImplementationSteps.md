# ToDoness – MVP Implementation Steps

> Step-by-step plan to build the first working version. It follows
> [PRD.md](./PRD.md), [TechStack.md](./TechStack.md) and
> [DBModel.md](./DBModel.md). Each step says **what to build**, and **done when**
> (how you know it works).

---

## Implementation status

*Last updated after the first full implementation.*

How it was built: the logic (shared package, server, client data layer, sync
engine and session handling) was written test-first, meaning the tests were
written and run failing before the code. Two exceptions: the small shared API
schemas were written together with their tests, and the screens were built
before their browser tests (the e2e suite was written afterwards and found real
problems, listed under FR-25 and the phone menu below).

### Steps

| Step | Status | Where / how it is tested |
|------|--------|--------------------------|
| 0 Project setup | Done | `pnpm dev`, lint, typecheck, build |
| 1 Shared package | Done | `shared/test` (83 tests); three deliberate bugs were injected to check the tests catch them |
| 2 Local-only app | Done | `client/test` repository and queries (34 tests), screens covered by the e2e suite |
| 3 Server base | Done | `server/test` (config, migrations, static files, health) |
| 4 Accounts and admin | Done | `server/test/auth.test.ts`, `rate-limit.test.ts` |
| 5 Sync on the server | Done | `server/test/sync.test.ts` (39 tests, incl. isolation between users, rollback) |
| 6 Sync on the client | Done | `client/test` engine, runner, backoff, session; `integration/` |
| 7 Conflicts and edge cases | Done | `integration/test` (23 tests: every row of the table in Step 7 plus list reordering) |
| 8 Login and admin screens | Done | session module (23 tests) and e2e scenarios 7 and 8 |
| 9 Offline app (PWA) | Done | e2e scenarios 1, 2 and 6 (offline reload and cold start) |
| 10 Deployment | Files written, **not run end to end** | see "Not verified" below |
| 11 End-to-end tests | Done | `e2e/` (13 browser tests); run with `pnpm e2e` |
| 12 Acceptance check | Done, see below | |

### Acceptance check against the PRD "Must" requirements

| Requirement | Result | Evidence |
|-------------|--------|----------|
| FR-1 task fields and limits | Met | shared schemas, repository tests, e2e |
| FR-2 new tasks on top | Met | repository test, e2e |
| FR-3 completion time, completed area | Met | repository test, e2e |
| FR-4 delete with undo | Met | repository, integration (undo before/after sync), e2e. The 5-second timeout itself is not timed in a test |
| FR-8 Inbox, cannot be deleted | Met | server, repository, integration, e2e |
| FR-9 create, rename, **reorder**, delete lists | Met | reorder added during the acceptance check (it had been missed); repository, integration, e2e |
| FR-10 confirm before deleting a list | Met | e2e |
| FR-13 app loads offline | Met in Chromium | e2e scenarios 1 and 6 |
| FR-14 all changes work offline | Met | integration, e2e scenario 1 |
| FR-15 queue and automatic resend, no duplicates | Met | integration (lost answer), e2e scenario 3 |
| FR-16 receive changes from other devices | Met | integration, e2e scenarios 2, 4, 5 |
| FR-17 automatic conflict rules | Met | shared (all 5,040 orders converge), integration, e2e scenarios 4 and 5 |
| FR-18 status indicator | Met | e2e (Offline, N changes pending, All changes saved) |
| FR-22 sign up, log in, log out | Met | server, session module, e2e |
| FR-23 session valid offline; expired session | Met, with a difference | works offline with no check; when the server says the login is no longer valid, the app asks for the password again and keeps all data (there are no refresh tokens) |
| FR-24 own data only | Met | server tests for every endpoint |
| FR-25 logout clears data, warns first | Met | session module, e2e scenario 7. A flaw found by the e2e test and fixed: logging out offline used to leave the server session alive, so the user was silently logged back in. |
| FR-26 admin password reset | Met | server, integration, e2e scenario 8 |
| FR-27 first user is admin, user list | Met | server, e2e |

PRD scenarios 1 to 8 pass as automated browser tests. The success goal (5 users
with 2 tasks each) was not run as a separate test; the e2e suite creates many
more users and tasks than that.

### Not verified

- **The Docker image and Caddy.** There was no Docker daemon. The compose file
  is valid, and the build and run steps of the Dockerfile were run by hand in
  clean folders and the app worked, but `docker build`, `docker compose up`,
  Caddy's internal certificates and the backup service have **not been run**.
- **HTTPS on a real intranet name and installing Caddy's root certificate on
  devices.** The offline tests ran on `http://localhost`, which browsers treat
  as secure.
- **Browsers other than Chromium** (Firefox, Safari, iPhone) and real phones.
  The Safari storage risk from the PRD is untested.
- **The "new version available" prompt (FR-21)** is implemented but not tested;
  it needs two different builds.
- **Accessibility** was built in (labels, focus outlines, native dialogs,
  reduced motion, dark mode) but not audited against WCAG 2.2 AA with a tool.

### Not built (PRD "Should" and "Could")

FR-5 drag-and-drop reordering of tasks (lists can be reordered with buttons),
FR-6 overdue highlighting, FR-7 search, FR-11 open-task counts, FR-12 Today and
All tasks views, FR-19 a notice for changes the server rejected (they are kept
in `deadLetter` but never shown), and the delete-user button in the admin
screen (the endpoint exists and is tested). FR-20 (persistent storage) and
FR-21 (update prompt) were built.

### Other limits worth knowing

- Only the first account is an admin; there is no screen to promote others.
- A login lasts a fixed 90 days.
- Moving a task to another list puts it on top there; there is no other way to
  place a task between two others yet.


---

## 1. What the MVP is

The MVP contains every requirement marked **Must** in the PRD (FR-1 to FR-4,
FR-8 to FR-10, FR-13 to FR-18, FR-22 to FR-27) and has to pass the eight
acceptance scenarios in PRD section 11.

**Left for after the MVP** (PRD priority Should / Could): drag-and-drop
reordering (FR-5), overdue highlighting (FR-6), search (FR-7), open-task counts
(FR-11), Today / All tasks views (FR-12), rejected-change notice (FR-19),
persistent storage request (FR-20), update prompt (FR-21), admin delete user
(FR-28). Step 13 lists them in a sensible order.

**Size guide:** S = about a day, M = a few days, L = about a week (for one
developer).

---

## 2. Order and reasoning

The plan builds the app **local-only first**, then adds the server and sync.
That way the hardest part (offline behaviour) is built into the app from day
one, and every step gives something you can run and test.

```
 0 Setup
 │
 1 Shared package ──────────────┐
 │                              │
 2 Local-only app (no server)   3 Server base + database
 │                              │
 │                              4 Accounts + admin
 │                              │
 └──────────────┬───────────────┘
                5 Sync: server
                │
                6 Sync: client
                │
                7 Conflicts + edge cases
                │
                8 Login and admin screens
                │
                9 Offline app (PWA)
                │
               10 Deployment (Docker + Caddy)
                │
               11 End-to-end tests
                │
               12 Acceptance check  →  MVP done
                │
               13 After the MVP
```

Steps 2 and 3–4 do not depend on each other, so two people can work in parallel.
Step 9 can also be started earlier; it is placed late only to keep the list simple.

---

## Step 0 – Project setup (S)

**Build**

1. Create the pnpm workspace with three packages: `client`, `server`, `shared`
   (structure in TechStack section 9).
2. TypeScript strict mode in all packages; one shared `tsconfig` base.
3. `client`: Vite + React 19. `server`: Node.js 22 + Hono. Add `wouter`, `dexie`,
   `dexie-react-hooks`, `zod`, `better-sqlite3`, `@node-rs/argon2`,
   `fractional-indexing`.
4. ESLint (flat config) + Prettier, and the scripts `dev`, `build`, `test`,
   `lint` at the workspace root.
5. Vitest in `shared` and `server`; vite dev proxy so the client calls `/api/*`
   on the dev server.

**Done when** `pnpm dev` starts both client and server, the browser shows a
placeholder page, and `GET /api/health` returns 200 (even if it only returns
`ok` for now).

---

## Step 1 – Shared package (M)

Code used by both sides. Build it first and test it well, because sync depends on it.

**Build**

1. **IDs:** a `newId()` function that returns a UUIDv7.
2. **HLC (Hybrid Logical Clock):** `now()`, `receive(remoteHlc)`, `compare(a, b)`
   with the string format from DBModel section 1. Clock never goes backwards,
   even if the device clock does.
3. **Types and Zod schemas** for `Todo`, `List`, `OutboxOp`, push request and
   response, pull response (DBModel sections 4 and 5). Include the whitelist of
   fields allowed in a `patch` for each entity.
4. **Merge function** `applyPatch(row, patch, hlc)`: per-field "last write
   wins", updates `fieldHlc`, handles `delete` and `restore` (DBModel 3.2, rules
   3 and 4). The server and the client both use it.

**Done when** unit tests pass for: HLC ordering and ties, clock moving
backwards, different-field merge, same-field conflict (later wins), delete
beats edit, restore, and repeating the same patch twice gives the same result.

---

## Step 2 – Local-only app (L)

The whole app working in the browser with **no server**. All data in IndexedDB.

**Build**

1. **Dexie schema** from DBModel section 4, with `lists`, `todos`, `outbox`,
   `deadLetter`, `meta`. Create `clientId` in `meta` on first run.
2. **Repository layer** (the only code allowed to write to Dexie):
   `createTodo`, `updateTodo`, `toggleDone`, `deleteTodo`, `restoreTodo`,
   `moveTodo`, `createList`, `renameList`, `deleteList`. Each function does
   **one transaction**: change the row **and** append an `OutboxOp` (DBModel
   4.2 rule 1). Each uses the HLC from Step 1.
3. **Ordering:** `orderKey` from `fractional-indexing`. A new task gets a key
   **before** the first task in its list, so it appears at the top (FR-2).
4. **Screens** (plain CSS, light/dark by system setting):
   - Main layout: sidebar (lists) + task list. On phones, a slide-out menu.
   - Quick-add field at the top of the task list (type, press Enter).
   - Task row: checkbox, title, due date, priority mark.
   - Completed tasks in their own collapsed area per list, with show/hide (L4).
   - Task detail screen: title, notes, due date, priority, list, delete.
   - Delete shows an **Undo** message for about 5 seconds (FR-4). Undo sends a
     `restore`.
   - List create / rename / delete; delete asks for confirmation (FR-10).
   - Moving a task to another list (L2).
5. **Inbox:** for now, create the Inbox locally if it does not exist; it cannot
   be deleted or renamed (FR-8). (In Step 5 the server will create it instead.)
6. **Sync status indicator:** a small component that reads from `outbox` and
   shows *N changes pending* or *All changes saved*. The *Offline* and
   *Syncing…* states are added in Step 6.
7. All text in one `strings` file (English only, ready for later translation).
8. Accessibility basics: labelled buttons, visible focus, keyboard use for
   add, complete and delete, contrast in both themes.

**Done when** you can add, edit, complete, delete (and undo), reorder by
moving between lists, and reload the page without losing anything; and every
change leaves a matching row in `outbox`. Repository functions have unit tests
(with `fake-indexeddb`).

---

## Step 3 – Server base and database (M)

**Build**

1. **SQLite connection** with the pragmas from DBModel section 3
   (`WAL`, `foreign_keys`, `busy_timeout`).
2. **Migration runner:** applies numbered `.sql` files in order at start and
   records the version in `PRAGMA user_version`. First file `001_init.sql` is
   the schema from DBModel section 3.
3. **Server settings** from environment variables (`PORT`, `DATABASE_PATH`,
   `CLIENT_DIR`, `COOKIE_SECURE`, `TRUST_PROXY`) with a clear error when
   something required is missing.
4. **Hono app:** JSON error format, request logging, `GET /api/health` (checks
   that the database answers), and static file serving of `CLIENT_DIR` with
   fallback to `index.html` for client routes.
5. Delete expired `sessions` rows at start (DBModel 3.4).

**Done when** the server starts on an empty folder, creates the database file,
applies the migration once (a second start applies nothing), and serves the
built client. Tests use an in-memory SQLite database.

---

## Step 4 – Accounts and admin on the server (M)

**Build**

1. **Register** `POST /api/auth/register`: validate e-mail (case-insensitive,
   unique) and password (at least 8 characters); hash with argon2id; the **first
   user becomes `admin`** (FR-27). In the same transaction create the user's
   **Inbox** list (`is_inbox = 1`) **and a `change_log` entry for it**, so it
   reaches the browser through the normal pull.
2. **Login** `POST /api/auth/login`: check the hash, create a session (random
   value in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie; the database stores
   a hash of it; valid 90 days).
   **After an admin reset** (`password_hash IS NULL`): store the hash of the
   password the user typed and log in (FR-26).
3. **Logout** `POST /api/auth/logout` and **`GET /api/me`** (user and role;
   `401` if not logged in).
4. **Auth middleware** for everything except health, register and login.
5. **Rate limit** on login: for example 10 attempts per 15 minutes per IP and
   e-mail (uses the real IP when `TRUST_PROXY` is on).
6. **Admin endpoints** (admin only):
   `GET /api/admin/users`, `POST /api/admin/users/:id/reset-password` (sets
   `password_hash = NULL` and deletes that user's sessions).
   `DELETE /api/admin/users/:id` can wait (FR-28).
7. The same message for "unknown e-mail" and "wrong password".

**Done when** integration tests pass for: first user is admin and second is not;
duplicate e-mail rejected; wrong password rejected; session cookie works and
expires; reset logs the user out and the next login with any password sets it;
non-admin gets `403` on admin endpoints; new user has exactly one Inbox and one
`change_log` row for it.

---

## Step 5 – Sync on the server (L)

This is the core of the app. Follow DBModel section 3.2.

**Build**

1. **`POST /api/sync/push`**: validate the body with the shared Zod schema. In
   one `BEGIN IMMEDIATE` transaction, for each operation in order:
   - `INSERT OR IGNORE` into `processed_ops`; if nothing was inserted, count the
     operation as accepted and skip it;
   - check the entity belongs to the user (and that a todo's `list_id` is the
     user's list);
   - apply it with the shared `applyPatch` (creates the row for `create`);
   - append a `change_log` row with only the fields actually accepted.
   An invalid operation goes into `rejected` with a reason and does **not**
   fail the other operations.
2. **`GET /api/sync/pull?since=&limit=`**: return `change_log` rows for the user
   with `server_seq > since`, oldest first, paged, with `nextSeq` and `hasMore`.
3. Never allow a client to set `user_id`, timestamps from the server side, or
   fields outside the whitelist.

**Done when** tests pass for: the same push sent twice changes nothing the
second time; a partly invalid batch accepts the valid operations; users cannot
read or write each other's data; pull pages correctly; `since=0` returns
everything; two devices' operations on different fields both end up in the row.

---

## Step 6 – Sync on the client (L)

**Build**

1. **Sync engine** (`client/src/sync/`): `push()` then `pull()`, one run at a
   time (a flag in the engine; the server is safe if two tabs overlap).
2. **Push:** read the oldest operations from `outbox` (for example 50 at a
   time), send, delete the accepted ones, and move rejected ones to `deadLetter`.
3. **Pull:** apply changes in one Dexie transaction using the shared `applyOp`
   (per-field last write wins; see DBModel 4.2), then save `lastServerSeq` in
   `meta`. Move the local HLC forward with `receive()`.
4. **Retry:** on network error or `5xx`, wait 1 s, 2 s, 4 s … up to 5 seconds,
   with a little random variation. A `4xx` validation error goes to `deadLetter`.
   A `401` stops syncing and tells the UI to show the login screen. **Local data
   and the outbox are kept.**
5. **Triggers** (TechStack 6.2): app start, `online` event, tab becomes visible,
   about 1 s after a local change, and every 5 s while online.
6. **Status indicator:** add *Offline* (no connection) and *Syncing…* to the
   component from Step 2.
7. **First login on a device ("initial sync"):** after login, show a short
   loading screen and run a full pull (`since=0`) **before** showing the app, so
   the Inbox and existing tasks are there. This needs a connection; the screen
   shows a clear message if there is none.
8. Remove the "create Inbox locally" code from Step 2; the Inbox now arrives
   from the server.

**Done when** with the server running: a task created in browser A appears in
browser B within about a minute; with the network switched off in DevTools you
can keep working, the indicator shows pending changes, and after switching it
on everything is sent once, with no duplicates, even if the connection is cut
in the middle of a push.

---

## Step 7 – Conflicts and edge cases (M)

**Build and test each case with two browser profiles**

| Case | Expected result |
|------|-----------------|
| Both edit **different fields** of one task while offline | Both changes kept on both devices |
| Both edit the **same field** | The later edit wins on both devices |
| One deletes, the other edits | The task is deleted on both |
| Delete, then Undo before the delete synced | Task is back, no leftover delete |
| Undo after the delete already synced | A `restore` operation brings it back on all devices |
| Delete a list that has tasks | The list and its tasks disappear on all devices |
| Move a task to a list that was deleted elsewhere | Task is deleted with the list; no error screen |
| Rename the Inbox or delete it | Not possible in the UI, rejected by the server |
| Phone clock is days wrong | Order of edits is still correct (HLC) |
| Very long offline period (many operations) | Sent in batches, in order |

**Done when** every row above is covered by an automated test (unit or
integration) or a written manual test.

---

## Step 8 – Login and admin screens (M)

**Build**

1. **Login / sign-up screen** (one screen with a switch): e-mail, password,
   clear error messages. After a successful login: run the initial sync (Step 6
   point 7), then show the app.
2. **Session handling in the client:** on start, call `/api/me`. If it answers
   `401` **while online** show the login screen. If the device is **offline**,
   open the app from local data without asking (FR-23). Keep the user id in
   `meta`; if a *different* user logs in on the same device, clear local data
   first.
3. **Logout** (settings screen): warns when `outbox` is not empty, then clears
   all Dexie tables and calls `/api/auth/logout` (FR-25).
4. **Expired or reset session while using the app:** when sync gets `401`, show
   the login screen on top; after login continue syncing the kept outbox.
5. **Admin screen** (only if `role = 'admin'`): table of users with a
   **Reset password** button (with confirmation).
6. **Settings screen:** theme (follows the system, optional override), e-mail
   shown, log out.

**Done when** acceptance scenarios 7 (logout safety) and 8 (admin reset) from the
PRD pass by hand.

---

## Step 9 – Offline app (PWA) (M)

**Build**

1. `vite-plugin-pwa` with a service worker that **caches the app shell** (HTML,
   JS, CSS, icons). API calls are not cached.
2. Web App Manifest: name, short name, icons (192 and 512 px, plus a maskable
   one), `display: standalone`, theme colour.
3. A fallback so that a reload at any app address while offline serves
   `index.html`.
4. The service worker file is served with `Cache-Control: no-cache` (set in the
   Caddyfile; also set by the Node server for local use).
5. Offline test on a **real HTTPS address** (see Step 10). Service workers do
   not work on a plain `http://` intranet address.

**Done when** after one online visit you can close the browser, switch the
network off, open the app and see your tasks (PRD scenario 6), and the app can
be installed from the browser.

---

## Step 10 – Deployment with Docker and Caddy (S–M)

**Build**

1. Add `Dockerfile`, `docker-compose.yml` and `Caddyfile` from TechStack
   section 13. Correct the build commands and paths to match the real code.
2. Set the real internal DNS name in the `Caddyfile`.
3. `docker compose up -d --build` on the internal server.
4. Export Caddy's root certificate and install it on the devices you will test
   with (TechStack 13.5).
5. Check that the nightly backup creates a file, and do one restore test.
6. Put a short **README** at the repository root: how to run in development,
   how to deploy, how to update, how to restore.

**Done when** `https://<internal-name>` opens without a warning on a laptop and
on a phone, you can register the first (admin) account, and `docker compose
restart` keeps all data.

---

## Step 11 – End-to-end tests (M)

Use Playwright with `context.setOffline(true)`. Run against a test server with a
fresh database.

1. **Offline create and reload** (PRD scenario 1): add a task offline, reload,
   the task is there, status shows 1 pending.
2. **Reconnect** (scenario 2): back online, status becomes *All changes saved*,
   and a second browser context sees the task.
3. **No duplicates** (scenario 3): cut the connection during a push (block the
   request), reconnect, the task exists once.
4. **Merge** (scenario 4) and **delete versus edit** (scenario 5), with two
   browser contexts.
5. **Logout safety** (scenario 7) and **admin reset** (scenario 8).

Scenario 6 (first load offline) needs HTTPS and a real service worker, so test
it by hand on the deployed address (Step 9).

**Done when** the suite passes locally and can be run with one command
(`pnpm e2e`).

---

## Step 12 – Acceptance check (S)

1. Go through all **eight scenarios** in PRD section 11 on the deployed server,
   using one laptop and one phone.
2. Check the **success goal**: 5 users registered, each with 2 tasks, all
   visible on every device of that user.
3. Go through the **Must** requirements table in the PRD and tick each one.
4. Fix what fails; repeat until everything passes.

**Done when** all checks pass. That is the MVP.

---

## Step 13 – After the MVP

In this order (value for effort):

| # | Item | PRD |
|---|------|-----|
| 1 | Ask the browser to keep data persistent (`navigator.storage.persist()`) | FR-20 |
| 2 | "New version available, reload?" prompt | FR-21 |
| 3 | Notice when the server rejects a change (show `deadLetter`) | FR-19 |
| 4 | Overdue highlighting | FR-6 |
| 5 | Open-task count per list; Today and All tasks views | FR-11, FR-12 |
| 6 | Drag-and-drop reordering (with keyboard alternative) | FR-5 |
| 7 | Search (local, works offline) | FR-7 |
| 8 | Admin: delete a user | FR-28 |

---

## Appendix – Rules to follow while building

1. **The screen only reads from Dexie and only writes through the repository
   layer.** Never call the server from a component to change data.
2. **One local change = one transaction** (row + outbox operation together).
3. **IDs are created on the device.** Never wait for the server to get an ID.
4. **Every server query is limited to the logged-in user.**
5. **A `401` is never a logout.** Keep local data until the user logs out on
   purpose or a different user logs in.
6. **Change both databases and the shared schema together** when a synced field
   changes (DBModel section 6): server first, then client.
7. **Test sync logic without a browser** (Vitest + `fake-indexeddb` + in-memory
   SQLite) and keep Playwright for the few full scenarios.
