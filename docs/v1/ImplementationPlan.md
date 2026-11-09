# ToDoness v1 – Implementation plan

> Requirements: [PRD.md](./PRD.md). Design changes: [TechStack.md](./TechStack.md).
> Previous plan: [`../mvp/MVPImplementationSteps.md`](../mvp/MVPImplementationSteps.md).

## Working method (test first)

Every step follows the same loop:

1. **Test** – write the tests for the step. Run them and see them **fail** for
   the right reason.
2. **Implement** – write the smallest code that makes them pass.
3. **Check** – run the whole suite, `pnpm typecheck` and `pnpm lint`; fix; commit.

Test layers (as in the MVP): **shared** (Vitest), **server** (Vitest, `app.request`),
**client** (Vitest + fake-indexeddb), **integration** (simulated browsers against the
real server), **e2e** (Playwright against the built app).

Status legend: ☐ not started · ◐ in progress · ☑ done

| Step | Content | Status |
|------|---------|--------|
| 0 | Housekeeping: old docs to `docs/mvp/`, v1 docs | ☑ |
| 1 | Shared schemas + migration 002 + server rows (`isPublic`, `remindBefore`) | ☑ |
| 2 | Client data layer: Dexie v2, repo (`setListPublic`, `reorderTodo`, reminder fields) | ☑ |
| 3 | Change password (API, session, Settings UI) | ☑ |
| 4 | Online presence + Admin "Online" column (also: all three config settings) | ☑ |
| 5 | Server config + attachments API | ☑ |
| 6 | Public lists API + sidebar section + read-only page + switch | ☑ |
| 7 | Attachments UI (task detail, public page) | ☑ |
| 8 | Drag & drop (reorder, drop on sidebar list) | ☑ |
| 9 | Reminders (due time, scheduler, notifications) | ☑ |
| 10 | End-to-end tests, README, final checks | ☑ |
| 11 | Editable public lists (server restricted push, attachments permissions, client editor and page, drag & drop) | ☑ |
| 12 | Web push, server: migration 003, VAPID keys, subscription API, reminder sweep, sender | ☑ |
| 13 | Web push, client: own service worker, subscribe / unsubscribe, Settings, logout | ☑ |
| 14 | Docs, README, final checks of the update | ☑ |
| 15 | Recovery data layer: snapshot, `Repo.restoreSnapshot` (overwrite / append), `clearAll(keep)` | ☑ |
| 16 | Recovery service + session: keep data aside at sign-up, offer, accept, decline | ☑ |
| 17 | Recovery popup (UI), integration scenario (server loses its database), e2e, docs | ☑ |
| 18 | Recovery also after a login with the same e-mail (second device, half-failed sign-up) | ☑ |

---

## Step 1 – Shared schemas, migration, server rows

**Build**
- `shared/src/schemas.ts`: `isPublic` in the list fields (optional on create);
  `remindBefore` (`'week' | 'day' | 'hour' | null`) in the todo fields. Defaults
  in `merge.ts` (`isPublic: false`, `remindBefore: null`). Pulled patches accept both.
- `server/src/db/migrations/002_v1.sql`: `lists.is_public`, `todos.remind_before`,
  `users.last_seen_at`, table `attachments`.
- `server/src/sync/rows.ts`: read and write the new columns.

**Tests first**
- shared: schemas accept/reject the new fields; `applyOp` merges them per field and
  defaults them on create.
- server: migration 002 applies to a database that already has 001 (with data);
  push + pull round-trip of `isPublic` and `remindBefore`; invalid values rejected;
  last write wins.

**Done when:** all of the above pass and the old tests are still green.

## Step 2 – Client data layer

**Build**
- `data/db.ts`: `version(2)` adds `notified: 'key'`; old rows keep working.
- `data/repo.ts`: `setListPublic(id, value)`, `reorderTodo(id, beforeId | null)`;
  `updateTodo` accepts `remindBefore`.
- `data/queries.ts`: nothing new except what the UI needs (`getOpenTodos` order is
  already by `orderKey`).

**Tests first**
- `reorderTodo` to top / middle / end; one outbox operation; no operation when the
  position does not change; works with duplicate keys; skips completed tasks when
  choosing neighbours.
- `setListPublic` on/off creates one `update` op; refused for missing lists.
- Upgrading a version-1 database keeps its data (open with the old schema first).

**Done when:** client tests pass.

## Step 3 – Change password

**Build**
- `shared/src/api.ts`: `changePasswordSchema` (current + new, new = same length rules).
- `server/src/auth/sessions.ts`: `deleteOtherUserSessions`.
- `server/src/routes/auth.ts`: `POST /api/auth/change-password` (auth required,
  rate-limited per user, verifies current, stores new hash, ends other sessions).
- `client/src/app/session.ts`: `changePassword(current, next)` returning a typed result.
- Settings: form with current / new / repeat, messages, disabled offline.

**Tests first**
- server: 401 without login; 403 + `wrong_password` for a wrong current password;
  400 for a bad new password; success lets the new password log in and not the old;
  other sessions end, the current one stays; repeated wrong guesses are rate limited.
- client session: success, wrong password, network error, too many attempts.

**Done when:** tests pass; manual check in the browser.

## Step 4 – Online presence

**Build**
- Config `ONLINE_WINDOW_SECONDS` (default 30, validated).
- `requireAuth` records `last_seen_at` (throttled to once per 5 s per user; every authenticated request counts, plus login and sign-up).
- `GET /api/admin/users` returns `online` and `lastSeenAt`.
- Admin screen: "Online" column (dot + words, last seen as tooltip), refresh every 5 s.

**Tests first**
- config parsing; a request marks the user online; after the window passes they are
  offline; a never-seen user is offline with `lastSeenAt: null`; throttling does not
  lose the first request; the admin response only goes to admins.

**Done when:** tests pass.

## Step 5 – Server config + attachments API

**Build**
- Config `MAX_ATTACHMENT_MB` (default 100), `ATTACHMENTS_DIR` (default next to the
  database).
- `GET /api/config`.
- `server/src/attachments/storage.ts`: paths by id, size-limited streaming write,
  delete helpers.
- `server/src/routes/attachments.ts`: list, upload, download, delete with the access
  rules of FR-53. User deletion removes the user's files.

**Tests first**
- config: defaults, valid values, rejects `0`, negative, text, decimals.
- upload: success stores the exact bytes; name and size listed; `Content-Length`
  above the limit → 413 and nothing stored; a body that **lies** about its length and
  exceeds the limit while streaming → 413 and no file left behind; empty name or file
  rejected; another user's task → 404; unknown task → 404.
- download: owner gets the same bytes with `Content-Disposition: attachment`,
  `X-Content-Type-Options: nosniff`; other users get 404 unless the list is public;
  delete only by the owner.
- deleting a user removes their files; a deleted task keeps its attachments.

**Done when:** tests pass.

## Step 6 – Public lists

**Build**
- `shared/src/api.ts`: response schemas for the public endpoints.
- `server/src/routes/public.ts`: list and read endpoints (other users' public lists,
  not deleted, tasks not deleted, with attachment metadata).
- Client: `ListPage` "Public" switch; sidebar section "Public lists"; route
  `/public/:listId` with a read-only page; offline note.

**Tests first**
- server: private lists never appear; a public list appears for other users but not
  in the owner's "other users" listing; deleted lists/tasks hidden; becoming private
  hides it again; requires login; list order follows `orderKey`.
- integration: owner toggles the switch offline, syncs, second user sees it.

**Done when:** tests pass.

## Step 7 – Attachments UI

**Build**
- `app/attachments.ts`: config cache, list, upload with progress (XMLHttpRequest),
  delete, size check helper.
- Task detail "Attachments" section; read-only list in the public page.

**Tests first**
- Pure helpers: size formatting, size check against the limit, upload error mapping
  (413, 404, network).

**Done when:** helper tests pass; manual and e2e check in the browser.

## Step 8 – Drag & drop

**Build**
- Add `@dnd-kit/core` and `@dnd-kit/sortable`.
- A drag handle on each open task row; sortable list in `ListPage`; the sidebar lists
  are drop targets; one `DndContext` in the shell; collision rule: a list under the
  pointer wins, otherwise the closest task.
- Screen-reader texts for pick-up / move / drop.

**Tests first**
- A pure function that turns a drop (`activeId`, `overId`, list order) into either
  "reorder before X" or "move to list Y" or "nothing", with unit tests.
- e2e: keyboard reorder and a mouse drop on a sidebar list.

**Done when:** unit tests pass and the e2e scenarios pass.

## Step 9 – Reminders

**Build**
- Due time input next to the date (`dates.ts` helpers).
- "Remind me" select in the task detail with the notification permission flow.
- `app/reminders.ts`: pure `dueReminders(todos, now, notified)` + the scheduler
  (start, visibility, every 30 s) + notification delivery + in-app message.
- Settings: notification status and "Enable notifications" button.

**Tests first**
- `dueReminders`: week / day / hour boundaries; not before the time; not after the due
  moment; done, deleted, no-due-date and no-reminder tasks skipped; already notified
  skipped; changing the due date or choice makes it fire again; catch-up after a long gap.
- Due date + time helpers (`fromDateTimeInput`, `toTimeInput`), including midnight
  and daylight-saving days.

**Done when:** tests pass.

## Step 10 – End to end, docs, final checks

**Build**
- Extend `e2e/test/scenarios.test.ts`: change password, public list visible to a
  second user, attachment upload and download, admin online indicator, reorder.
- README: new features, **configuration table** (`MAX_ATTACHMENT_MB`, `ATTACHMENTS_DIR`,
  `ONLINE_WINDOW_SECONDS`), backup note for the attachments folder, HTTPS note for
  notifications, links to `docs/mvp/` and `docs/v1/`.
- Docker: attachments folder lives in the existing `/data` volume.

**Done when:** `pnpm test`, `pnpm e2e`, `pnpm typecheck`, `pnpm lint` and
`pnpm format:check` pass.

---

## Update 2: editable public lists and web push

(Requested after v1 was delivered. Requirements: PRD sections 4.2 and 4.7.)

### Step 11 – Editable public lists

**Build**
- `server/src/sync/apply-ops.ts`: `applyPush` gets options `{ actorId, onlyListId }`: rows stay
  owned by the list owner, the change log goes to the owner, `processed_ops` is per actor;
  with `onlyListId` only task operations inside that list are accepted.
- `POST /api/public/lists/:id/push` (login; list must be public and not deleted).
- `GET /api/public/lists/:id` returns `orderKey`.
- Attachments: add and remove allowed for every logged-in user on tasks of public lists.
- `client/src/data/order.ts`: the "key for a position" function now shared by the local repo
  and the public editor.
- `client/src/app/publicEdit.ts`: builds operations with the device's own clock and sends them.
- Public list page: add task, complete, edit title / notes / due / priority, delete with Undo,
  reorder by drag, attachments.

**Tests first**
- server: a non-owner can create, update, delete, restore tasks in a public list; the owner
  sees them in their pull and in their database; repeats are safe; a private, deleted or
  unknown list is 404; list operations and ops touching other lists or moving a task out are
  rejected; invalid operations are rejected one by one; the owner's other lists and tasks are
  untouchable; attachments can be added and removed by others.
- integration: owner and visitor edit the same list (visitor online, owner offline), results
  converge by the merge rules; owner's pending offline edit vs visitor's edit of another field.
- client: the key-for-position function; the public editor builds valid operations.
- e2e: Bob adds, completes, edits and deletes in Ann's public list; Ann sees it.

### Step 12 – Web push, server

**Build** migration `003_push.sql`; `web-push` dependency; VAPID key store; `push` routes;
`push/reminders.ts` sweep with an injected sender; the real sender; the 30 s timer in
`index.ts`; config for `VAPID_*`.

**Tests first** key generation and persistence, env override; subscribe / move between users /
unsubscribe / auth; sweep: window rules (week, day, hour, before, after due), once only,
re-arm on change, catch-up, skip done / deleted / no due / no reminder, no subscription = nothing
recorded, several devices, dead subscription removed, one failing send does not stop others,
pruning of old `sent_reminders`.

### Step 13 – Web push, client

**Build** `src/sw.ts` (precache as before, `push`, `notificationclick`, skip-waiting message);
vite-plugin-pwa `injectManifest`; `app/push.ts`; Settings switch; auto-subscribe when a reminder
is set or the app starts with permission granted; unsubscribe on logout.

**Tests first** `urlBase64ToUint8Array`, support detection, the payload-to-notification function
used by the service worker (title, body, tag, url; bad payloads), logout calls the hook,
subscription request body. The offline e2e scenarios of the MVP guard the new service worker.

### Step 14 – Docs and final checks

README (VAPID settings, outbound access note), PRD/plan status, all test suites.

---

---

## Update 6: recovery after the server lost its data

(PRD 4.11, FR-77 – FR-82; decisions D7, D8.)

### Step 15 – Recovery data layer

**Build**
- `data/db.ts`: `clearAll(keep?: MetaRow[])` clears everything but writes the given `meta`
  rows in the **same transaction**, so the data kept aside cannot be lost between "clear" and
  "save".
- `data/recovery.ts` (pure, on the database): `takeSnapshot(db, fromEmail)` returns the live
  lists (not the Inbox) and live tasks of non-deleted lists, or `undefined` if there is nothing
  worth restoring; `summarize(snapshot, db)`.
- `data/repo.ts`: `restoreSnapshot(snapshot, mode)` in one transaction. `overwrite` first deletes
  the account's live tasks and non-Inbox lists; both modes then create the lists, then the tasks
  (same ids, tasks of the old Inbox go to the current Inbox) as normal outbox operations.

**Tests first**
- `takeSnapshot`: nothing for an empty device and for one holding only an empty Inbox; skips
  deleted tasks and lists and tasks of deleted lists; keeps all task and list fields.
- `restoreSnapshot` append: server data kept, offline lists and tasks added, order and fields
  kept, old Inbox tasks land in the new Inbox, every outbox operation is valid for the server,
  lists come before their tasks.
- `restoreSnapshot` overwrite: server tasks and lists deleted first, the Inbox stays.
- Restoring the same snapshot twice does not duplicate (same ids merge).
- `clearAll(keep)` keeps exactly the given rows.

**Done when:** client tests pass.

### Step 16 – Recovery service and session

**Build**
- `services/session.ts`: on **sign-up** with a different stored user, take the snapshot **before**
  clearing and store it under `meta.recoverySnapshot` through `clearAll(keep)`. The "will delete
  your unsent changes" question is not asked in that case (the recovery question replaces it).
  Login behaves as before.
- `services/recovery.ts`: `createRecovery({ db, repo })` with `load()`, `getOffer()`,
  `subscribe()`, `accept(mode)`, `decline()`. The offer holds the old e-mail, the number of
  tasks and lists, and how many tasks the account already has. `accept` restores and removes
  the snapshot in the same step; `decline` only removes it. Both fail cleanly (snapshot kept) if
  the new Inbox is not there.

**Tests first**
- Session: sign-up on a device with another user's data keeps a snapshot and clears the rest;
  no confirm question; sign-up on a device with only an empty Inbox keeps nothing; login as a
  different user still asks and clears and keeps nothing; the same user signing up again
  (same id) keeps everything and takes no snapshot.
- Recovery: no offer without a snapshot; offer after load; accept append / overwrite writes the
  outbox and removes the snapshot; decline removes it; the offer survives a new service instance
  (reload); accept without an Inbox fails and keeps the snapshot.

**Done when:** client tests pass.

### Step 17 – Popup, integration, browser test, docs

**Build**
- `components/account/RecoveryDialog.tsx`: native `<dialog>`; step 1 asks Yes / No, step 2 asks
  Overwrite / Append / Back; mounted in `Shell`. Texts in `app/strings.ts`.
- README feature list; this plan's notes; Decisions.

**Tests first**
- Integration (real server in memory): browser A fills an account, the server is replaced by a
  fresh one, A signs up again, restores with append, a second browser sees the same data;
  overwrite on an account that already has data; decline leaves the account empty; restore done
  offline is sent after reconnecting.
- Browser (e2e): the popup appears after sign-up on a device with another account's data;
  No / Yes + Append / Yes + Overwrite; reload keeps the question.

**Done when:** all suites, `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass.

### Step 18 – Recovery after a login with the same e-mail

**Build**
- `services/session.ts`: the snapshot is also taken on **login** when the stored user's e-mail
  equals the logged-in e-mail (case-insensitive) but the user id differs. A login with a
  different e-mail is unchanged.

**Tests first**
- Session: login with the same e-mail and a new id keeps a snapshot, asks nothing; login with a
  different e-mail still asks / clears / keeps nothing; same e-mail and same id keeps everything.
- Integration: the phone signs up first on the fresh server, then the laptop (holding the old
  data) logs in, is offered the data, sees the phone's data in the count, and appends.

**Done when:** all suites, typecheck and lint pass.

## Implementation notes

Every step was built test first: the tests were written and run (and seen to fail)
before the code that makes them pass.

**Deviations from the plan**

- **Config in step 4.** All three settings (`MAX_ATTACHMENT_MB`, `ATTACHMENTS_DIR`,
  `ONLINE_WINDOW_SECONDS`) were added together with the presence feature, because they
  share one config module and one test file.
- **Presence write interval** is 5 seconds (not 10), so that a user who is active (the app
  talks to the server every 5 seconds) never flickers to offline with the 10 second
  minimum window. `ONLINE_WINDOW_SECONDS` must be 10 – 3600.
- **Presence also counts login and sign-up**, not only requests with an existing session.
- **Reminders re-arm immediately.** Changing the due date, time or reminder in the task
  detail runs a reminder check right away (otherwise the user would wait up to 30 s).
- **Clearing the due date clears the reminder** in the same change.
- **Public list page** also works for the owner's own public lists (same URL), but the
  sidebar section only lists other users' lists.
- **Attachments are not in the sync feed** (decision D3). The list is fetched when the task
  detail opens and after every change.
- **Drag onto the sidebar** needs a visible sidebar, so on phones the task-detail "List"
  field is the way to move a task (FR-40).
- **Equal `orderKey`s** (two devices created tasks at the same moment): the dragged task
  is placed after the group of equal keys instead of failing.
- **Test environment note:** headless Chromium always reports `Notification.permission`
  as `denied`, so the reminder browser tests override it; real browsers report it correctly.

**Test counts at the end of v1:** shared 93, server 171, client 179, integration 28,
browser (e2e) 30 (13 MVP + 17 v1 scenarios). All pass, as do `pnpm typecheck`, `pnpm lint`
and `pnpm format:check`.

### Notes on update 2 (editable public lists and web push)

- **Editable public lists** reuse the normal merge: the visitor's device creates ordinary
  operations with its own clock and the server applies them to the owner's rows
  (`applyPush` with an `actorId` and `onlyListId`). The change lands in the owner's change
  feed, so the owner's devices receive it with the normal pull and merge it per field with
  their own (possibly offline) edits. A visitor's edits are online-only (no queue).
- **Who changed what** is not recorded (no history); the latest edit to a field wins.
- **Attachments** of a public list can be added and removed by everyone, as for any edit.
- **Reorder in a public list** works with the same drag handle; dropping a task from a
  public list on one of your own lists does nothing (tasks cannot leave the list).
- **Service worker** is now our own file (`client/src/sw.ts`, `injectManifest`). The offline
  scenarios of the MVP all pass against it. Its decisions are in `sw-logic.ts` (unit tested);
  its push handling is also tested in a real Chromium by delivering a push message to the
  worker through the DevTools protocol. The browser tests use Chromium's "new headless" mode
  for this, because the default headless shell always denies notifications.
- **What could not be tested here:** a real delivery through Google's, Mozilla's or Apple's
  push service (needs internet access and a real browser registration). The server side is
  tested up to the request that web-push would send (VAPID-signed, encrypted body) and the
  mapping of the push service's answers (404/410 remove the subscription, other errors are
  retried at the next sweep). Please try it once on your HTTPS deployment: set a reminder,
  close the app, wait.
- **Subscriptions follow the user**, not the browser: a browser has one endpoint, so when
  another user logs in there it moves to them; logging out removes it.
- The reminder tag (`<todoId>:<dueAt>:<choice>`) is shared by the app's own notification and
  the push, so a device that has the app open and push on shows one notification, not two.
- `web-push` is bundled into `server/dist/index.js` (pure JavaScript), so the Docker images
  need no extra install step.

### Update 3: toggle, sticky sidebar, sync diagnostics

(PRD 4.8.) Built test first, as before.

- **Cause of the slow offline → online switch.** A test (`client/test/recovery.test.ts`) with a
  black-holed connection reproduced it: a request that never answers kept the sync busy until
  its time limit, the browser's `online` event then waited for it (5.5 s after a 1.5 s outage),
  and the next retry came after a further delay (up to 6.6 s when the browser did not notice
  the return). Fixes: the `online` event aborts waiting requests and runs the sync again at once;
  the `offline` event shows Offline immediately; requests give up after 3.5 s and, after a
  failure, 2 s; while the connection is down it retries every second (server errors still back
  off 1 s, 2 s, 4 s, 5 s). Measured worst case with a silent return: **3.9 s** (was 6.6 s);
  with the browser's `online` event: immediate.
- **Trade-off:** a request that takes longer than 3.5 s on a very slow link now counts as a
  failure and is retried. The data per request is small (50 changes up, 500 down), so this is
  expected to be fine on an intranet.
- **The 60 s timers:** none are left in the sync. The values that remain are the login rate-limit
  windows (server), the 30 s reminder check (app and server push sweep) and the 5 s refresh of
  public lists, the admin table and the sidebar's public-list names (it was 15 s).
- **Diagnostics** (`client/src/sync/diagnostics.ts`) are recorded for everyone (a small ring
  buffer) and shown to admins only, above the sync indicator.
- Browser tests: toggle and tooltip, Settings/Admin visible with a 25-task list scrolled to the
  bottom, diagnostics only for the admin and directly above the status, a hanging connection
  that comes back silently (saved within 5 s, log explains it), and Chromium's own offline →
  online switching.

### Update 4: time control, phone pickers, deploy script

(PRD 4.9; decisions in [Decisions.md](./Decisions.md).)

- `client/src/app/timeField.ts` (tested) and `components/TimeField.tsx` replace `<input type="time">`.
  The control keeps a local draft value so two quick changes (hour, then minute) do not use stale
  props; a browser test caught that.
- `attachmentPickers(touchScreen)` (tested) decides the pickers; browser tests use a phone
  emulation (`isMobile`, `hasTouch`). Real Android behaviour could not be tested here.
- `deploy.sh` adds `/release` to the target itself; `--dry-run` prints it (tested in
  `server/test/deploy-script.test.ts`, which also showed the old script would have started a
  build for any unknown argument).
- The browser tests share two users, because the server limits sign-ups to 20 per hour per address.

### Update 5: connection state, picker buttons, sticky Close log

(PRD 4.10; Decisions 19–20.)

- `sync/connectivity.ts` (a tiny store), `engine.ping()`, and a 3-second check in the runner; the
  `isOnline()` gate in the runner is gone (the existing test that expected "no request while the
  browser says offline" now expects the opposite). `useOnline()` reads the store.
- A test with the browser flag stuck on "offline" while requests work (unit, recovery and browser
  level) is the regression guard; a browser test also checks that a real loss of connection is
  shown within about 5 s and that saving resumes within 5 s of it returning.
- Picker buttons: `FilePickButton` (label as button, input re-created after pick/cancel); browser
  tests open the chooser repeatedly without answering. This passed with the old button too, which
  supports the explanation that the phone problem was the disabled state, not the picker.
- Log popup: the header with **Close log** is sticky; a browser test scrolls the log and clicks it.

### Update 6: recovery after the server lost its data

(PRD 4.11, FR-77 – FR-82; Decisions 21–23.)

- Sign-up on a device holding another account's data keeps a copy in `meta.recoverySnapshot`
  (written by `clearAll(keep)` in the same transaction as the clearing). The popup
  (`RecoveryDialog`, mounted in `Shell`) asks after the first sync of the new account; **No**
  deletes the copy, **Yes** then asks **Append** or **Overwrite** and `Repo.restoreSnapshot`
  queues the data as ordinary outbox operations (lists first, then tasks; same ids; tasks of the
  old Inbox go to the new Inbox).
- Logging out, or logging in as another user, while the question is unanswered now warns that the
  kept data would be lost (it counts like unsent changes).
- Found by the browser tests: (1) after a reload the popup was built from local data before the
  first sync and could say "empty" for an account that was not; it now refreshes after every sync
  (and a slow refresh cannot bring back an answered question; unit test with a held read).
  (2) The dialog's accessible name changes with the step (a test finding, not a bug).
- The integration tests simulate the server loss with a second in-memory server and
  `Browser.switchServer`; the browser tests stop the app and start another one on the **same
  port** (same origin, so the local data stays) with a new database.
- Update 6b (step 18): a login with the same e-mail (new user id) also keeps the data aside, found
  while reviewing the risks: the second device of a user whose account another device re-created
  first would otherwise lose its data silently. A login with another e-mail is unchanged (shared
  devices).
- Not covered: the real-life browser reload during the second step (it is the same state as the
  first step; the step is not stored), and attachments (they only live on the server).

**Test counts after update 6:** shared 95, server 230, client 300, integration 39, browser (e2e)
50 (13 MVP + 32 v1 + 5 recovery scenarios).

**Test counts after update 5:** shared 95, server 228, client 263, integration 31, browser (e2e)
45 (13 MVP + 32 v1 scenarios).

**Superseded counts (update 3):** shared 95, server 221, client 237, integration 31,
browser (e2e) 38 (13 MVP + 25 v1 scenarios).

**Not done / ideas for later**

- Several reminders per task; a change history for public lists (who changed what);
  offline editing of other people's public lists.
- Offline queueing of attachments; per-user storage quota; clean-up of attachments of tasks
  that were deleted long ago.
- Dragging completed tasks and dragging lists in the sidebar.

