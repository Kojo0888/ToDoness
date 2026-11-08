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

**Test counts after update 2:** shared 95, server 221, client 216, integration 31,
browser (e2e) 33 (13 MVP + 20 v1 scenarios).

**Not done / ideas for later**

- Several reminders per task; a change history for public lists (who changed what);
  offline editing of other people's public lists.
- Offline queueing of attachments; per-user storage quota; clean-up of attachments of tasks
  that were deleted long ago.
- Dragging completed tasks and dragging lists in the sidebar.

