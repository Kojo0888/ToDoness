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
| 3 | Change password (API, session, Settings UI) | ☐ |
| 4 | Online presence + Admin "Online" column | ☐ |
| 5 | Server config + attachments API | ☐ |
| 6 | Public lists API + sidebar section + read-only page + switch | ☐ |
| 7 | Attachments UI (task detail, public page) | ☐ |
| 8 | Drag & drop (reorder, drop on sidebar list) | ☐ |
| 9 | Reminders (due time, scheduler, notifications) | ☐ |
| 10 | End-to-end tests, README, final checks | ☐ |

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
- `requireAuth` records `last_seen_at` (throttled to once per 10 s per user).
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

## Implementation notes

*(Filled in while building: what was done, deviations from the plan.)*
