# ToDoness Plan – Implementation plan

> Requirements: [PRD.md](./PRD.md). Earlier plans: [`../notes/ImplementationPlan.md`](../notes/ImplementationPlan.md),
> [`../v1/ImplementationPlan.md`](../v1/ImplementationPlan.md).

## Working method (test first)

As before, every step is: **test** (written first, run, seen to fail for the right reason),
**implement** (smallest code that passes), **check** (whole suite, `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`).

Status legend: ☐ not started · ◐ in progress · ☑ done

| Step | Content                                                                                             | Status |
| ---- | --------------------------------------------------------------------------------------------------- | ------ |
| 1    | Shared: days, `plan` and `activity` entities (schemas, operations, merge defaults), scheduling rules | ☑      |
| 2    | Server: migration 008, rows, push / pull of plans and activities, pull for older apps               | ☑      |
| 3    | Client data: Dexie version 7, repo operations with the automatic shift, queries, pulled changes     | ☑      |
| 4    | Recovery: plans and activities in the snapshot and the restore                                      | ☑      |
| 5    | Client lib: timeline geometry (range, day ↔ pixel, arrow paths), name position setting, module      | ☑      |
| 6    | UI: module switch, sidebar, plan page, timeline, drag, links, edit bar, texts, styles               | ☑      |
| 7    | Browser (e2e) tests, README, decisions                                                              | ☑      |

---

## Design

### Data model

```text
Plan     = { id, name, orderKey, fieldHlc, createdAt, updatedAt, deletedAt }
Activity = { id, planId, name, start, days, dependsOn, orderKey, fieldHlc, createdAt, updatedAt, deletedAt }
```

- `start`: `YYYY-MM-DD` (a real calendar day, years 1900 – 2999). `days`: integer 1 – 3660
  (`ACTIVITY_DAYS_MAX`), default 1. End day = `start + days − 1` (PRD decision P1).
- `dependsOn`: array of at most 50 (`ACTIVITY_LINKS_MAX`) activity ids, default `[]`, one
  last-write-wins field (decision P3). Ids that are unknown, deleted, in another plan, the
  activity itself or that would close a loop are **ignored when read** (`liveLinks`), never
  refused by the merge: after concurrent edits any combination can arrive.
- Sync operations: `entity: 'plan' | 'activity'` with `create | update | delete | restore`;
  strict patch schemas as for the other entities.

**Server** – migration `008_plans.sql`: tables `plans` and `activities` (owner column,
`ON DELETE CASCADE` from `users`; `activities.plan_id` references `plans`), and `change_log`
is rebuilt once more because its `CHECK (entity IN …)` must learn the two entities (same
method as migration 004: every row keeps its `server_seq`, the counter carries over).

**Client** – Dexie version 7 adds `plans: 'id, orderKey'` and
`activities: 'id, planId, [planId+orderKey]'`; `clearAll` clears them.

### Shared rules (`shared/src/plan.ts`, pure)

```ts
isDay(s) / dayNumber(day) / dayOf(number) / addDays(day, n) / endDay(start, days) / daysBetween(a, b)
liveLinks(activities): Link[]            // { from, to } that count: known, same plan, no loop
wouldLoop(activities, from, to): boolean // would from → to close a loop (or is it from === to)?
schedulePlan(activities): Map<id, start> // new start days that repair broken links (FR-136)
brokenLinks(activities): Link[]          // links whose successor starts too early (FR-139)
```

`schedulePlan` walks the activities in dependency order (predecessors first) and sets
`start = max(start, latest predecessor end + 1)`; it only returns the ones that change. Loops
cannot stop it: `liveLinks` drops, in a fixed order (by id), every link that would close one.

### Push and pull

- `applyPush` gets `applyPlan` and `applyActivity` (owner check; an activity's `planId` must be
  a plan of the same user, else `plan_not_found`). The restricted public pushes refuse both
  entities (`forbidden`), as they already refuse everything outside their scope.
- **Older apps (FR-143).** An app from before this change validates every pulled change
  against the entities it knows and would refuse the whole answer. So the pull only contains
  plan and activity changes when the app asks with `plans=1`; without it they are left out,
  and the cursor (`nextSeq`) still moves past them, so the old app keeps syncing everything
  else. When such a device updates, the Dexie upgrade to version 7 **resets the pull cursor**:
  the next sync reads the whole change log again (merging is idempotent) and so receives the
  plans it skipped.

### Client data (`Repo`)

```ts
createPlan(name) / renamePlan(id, name) / deletePlan(id)        // delete: activities first
createActivity(planId, name)                                    // PRD FR-124
updateActivity(id, { name?, start?, days? })
deleteActivity(id) / restoreActivity(id)
linkActivities(fromId, toId)   // RepoError 'loop' | 'invalid' (other plan, itself)
unlinkActivities(fromId, toId)
```

Every operation that can break a dependency (`updateActivity`, `linkActivities`,
`restoreActivity`, `createActivity`) ends, **in the same transaction**, with `reschedule(planId)`:
`schedulePlan` over the plan's live activities and one `update { start }` per moved activity.
`applyChanges` (pull) never reschedules (decision P7).

### Modules, addresses, pages

- `MODULES` gets `{ id: 'plan', home: '/plans', owns: /^\/plans?(\/|$)/ }`.
- `/plans` → `PlansHome`: redirect to the first plan, or the empty state. `/plan/:planId` →
  `PlanPage`.
- Sidebar `PlanNav`: the plans as links, then the same "new …" form as lists.
- `PlanPage`: title (rename in place, Delete with `ConfirmDialog`), add-activity form, the
  name-position chips, the edit bar of the selected activity, `Timeline`.

### Timeline (`components/plan/Timeline.tsx`, geometry in `lib/timeline.ts`)

- Pure geometry, unit tested: `timelineRange(activities, today)` (first / last day shown:
  3 days before the earliest, 14 after the latest, at least 35 days), `blockBox(activity,
  range, row)`, `dayAtX(x)`, `arrowPath(fromBox, toBox)` (an elbow line that leaves the end of
  A to the right and enters the start of B from the left, going around when B starts left of
  A's end), `monthSpans(range)`.
- Layout: a horizontally scrolling box; inside it an optional sticky name column and the
  grid (header rows, one row per activity, absolutely positioned blocks, one SVG over the
  rows for arrows). Day width 36 px, row height 44 px.
- **Drag** (pointer events with pointer capture, so mouse and touch are the same code):
  `move` (block or start handle) and `resize` (end handle) keep a preview `{ id, start,
  days }` in component state; `pointerup` calls `repo.updateActivity`; Escape or
  `pointercancel` drops the preview. The preview of a move is clamped to the earliest day
  the predecessors allow, so the block never shows a position that would not be kept.
- **Linking**: `pointerdown` on a link point arms it (`{ id, side }`); a rubber line follows
  the pointer; `pointerup` over another activity (found with `elementFromPoint` and
  `data-activity-id`) links; `pointerup` on the same point leaves it armed, so a click on a
  second activity finishes the link (click – click, also the keyboard way). Escape disarms.
- Arrows are `<path>`s with a wide invisible stroke for hitting, `role="button"`, focusable.
- The name position is read from / saved to `localStorage` (`todoness.plan.names`) through
  `lib/planNames.ts` (pure, takes a `KeyValueStore`, as `lib/modules.ts`).

---

## Step 1 – Shared

**Tests first** (`shared/test/plan.test.ts`): day helpers (leap years, month ends, invalid
strings); plan / activity create, update, delete, restore operations parse; unknown fields,
bad day, `days` 0, too many links, `userId` refused; pulled changes parse; merge creates an
activity with defaults and needs `planId`, `name`, `start`, `orderKey`; `liveLinks` drops
unknown, deleted, foreign-plan, self and loop links; `wouldLoop`; `schedulePlan` pushes a
chain, keeps durations, takes the latest of several predecessors, never pulls earlier,
terminates on a loop; `brokenLinks`.

## Step 2 – Server

**Tests first** (`server/test/plans.test.ts`, `migrate.test.ts`): migration from version 7
keeps `change_log` rows and `server_seq` and accepts the new entities; push create / update /
delete / restore of a plan and an activity, pull (`plans=1`) returns them to another device;
another user's plan or activity id is refused; an activity for another user's or an unknown
plan → `plan_not_found`; pull without `plans=1` leaves them out but moves the cursor past
them; public list and public note pushes refuse both entities; deleting a user deletes their
plans.

## Step 3 – Client data

**Tests first** (`client/test/data/plans.test.ts`, `plans-upgrade.test.ts`, sync tests):
`createPlan` appends and queues a valid operation; rename, delete (with activities);
`createActivity` placement (FR-124); `updateActivity` (name, start, days; bad values
refused); delete / restore; `linkActivities` stores the link and shifts the successor, a
chain shifts, loop / self / other plan refused, duplicate is a no-op; `unlinkActivities`;
lengthening a predecessor shifts successors in the same transaction and queues their
updates; Dexie upgrade from version 5 keeps data, adds the tables and resets the pull
cursor; pulled plan changes are applied; `clearAll`; the engine asks with `plans=1`.

## Step 4 – Recovery

**Tests first**: `takeSnapshot` includes live plans and the live activities of live plans; a
device with only plans is offered; `restoreSnapshot` creates them (append / overwrite), an
old snapshot without plans still restores; counts.

## Step 5 – Client lib

**Tests first** (`client/test/lib/timeline.test.ts`, `planNames.test.ts`, `modules.test.ts`):
range rules, block boxes, `dayAtX`, arrow path forward and backward, month spans; the name
position default, save, invalid stored value; `/plans` and `/plan/x` belong to `plan`.

## Step 6 – UI

Module icon and text, `PlanNav`, routes, `PlansHome`, `PlanPage`, `Timeline`, `ActivityBar`,
strings, styles (variables only; phone sizes; dark mode).

## Step 7 – Browser tests and docs

`e2e/test/plan.test.ts` covers PRD section 7 (points 1 – 8) in the built app; README gets
the module; `docs/v1/Decisions.md` gets a pointer to this feature's decisions.

---

## Changed on the way

1. **Earliest start is checked before the change, not repaired after it.** `updateActivity`
   first limits a new start to the first day the predecessors allow (`earliestStart`) and then
   saves, so dragging a successor too early queues one change instead of two (the wrong start
   and its repair). `reschedule` still runs afterwards for the activities behind it.
2. **The preview of a drag shows the push.** While a block is dragged, `schedulePlan` runs on
   the previewed plan, so the activities that would be pushed already move with it. The grid's
   range follows the saved days only, so it cannot shift under the pointer; when days are
   added on the left after a drop, the scroll position is corrected by the same amount.
3. **The linking hint sits below the chart.** A first version showed it above; the line that
   appeared moved the chart down under the pointer in the middle of a link drag, so the drop
   hit the wrong row (found by the browser test).
4. **A loop is reported in a message line, not in the Undo toast** (the toast always carries
   an Undo button, and there is nothing to undo).
5. **Grips are not tab stops.** The two drag grips are buttons for mouse and touch only
   (`tabIndex = -1`); the keyboard moves and resizes with the arrow keys on the block (FR-132)
   or uses the edit bar. Link points and arrows are tab stops.
6. **Phones:** a day stays 36 px wide, so grips and link points are 44 px high but narrower
   than 44 px. This exception to `UI_GUIDELINES.md` is noted next to the styles; the edit bar
   has full-size controls for the same changes. With three modules the top bar's switch shows
   names without icons on a phone.
7. **Recovery counts.** `restoreSnapshot` and the recovery offer also count plans; the popup
   only names them when there are some (as for notes).
8. **Integration tests were added** (`integration/test/plans.integration.test.ts`): offline
   plan to a second device, a merge of two devices that breaks a link and its repair with the
   next change (decision P7), and the "old app skipped plans" case of FR-143.

## Update 1 – after the first review

Requested: straight dependency lines that enter a block from above, no link circles (link by
dragging an end onto another block), an easy undo of the last drag, a Manage plans page like
Manage lists, a module switch that fits the sidebar, and tidier margins.

| Step | Content                                                                                           | Status |
| ---- | ------------------------------------------------------------------------------------------------- | ------ |
| 9    | Arrows: `arrowPath` enters the target from above / below at its start; straight when adjacent     | ☑      |
| 10   | Linking by dragging a grip onto another block; link points and click – click linking removed      | ☑      |
| 11   | `Repo.revertActivities`, **Undo last change** button and Ctrl / ⌘ + Z; **Starts after** field     | ☑      |
| 12   | `Repo.reorderPlan`, `ManageItems` (shared by Manage lists and the new Manage plans), sidebar link | ☑      |
| 13   | Module switch fits the 16 rem sidebar; spacing of the plan page                                   | ☑      |

- **Arrows** (`lib/timeline.ts`): `arrowPath(from, to)` ends at the top edge of the target
  block (bottom edge when the target is in a row above), at the target's start. Same
  position as the source's end → one vertical line from the source block's edge. Target
  further right → along the source row, then down. Target further left (a broken link) → a
  short stub, the row border next to the target, then into it. `arrowTip` gives the head.
- **Linking** (`Timeline.tsx`): a drag that started on a grip looks at what is under the
  pointer (`elementFromPoint`, `.plan-bar`). Another activity's bar → the preview goes back
  to the saved block, that bar is outlined, a dashed line follows the pointer, and releasing
  calls `linkActivities` (end grip: this → other; start grip: other → this). Dragging the
  block itself only moves it.
- **Undo** (`PlanPage.tsx`): `change(run)` reads the plan's activities, runs the change and,
  if anything differs afterwards, keeps the earlier `{ id, start, days, dependsOn }` list.
  `Repo.revertActivities` writes the differing fields back in one transaction, without the
  automatic shift (the snapshot is consistent by itself).
- **Manage plans**: the Manage lists screen became `components/common/ManageItems.tsx`
  (rows, drag and drop, ⋯ menu, rename in place, delete dialog) with the texts and actions
  passed in; `ManageLists` and `ManagePlans` are thin wrappers. Address: `/plans/manage`.
- **Module switch**: three entries needed 267 px in a 223 px slot, which made the sidebar
  scroll sideways when something in it got focus. The entries are now more compact and may
  shrink (`min-width: 0`), so the switch is exactly as wide as the other sidebar controls.

## Update 2 – review of PR 17

Nine review comments; each fix has unit tests (named below), two also a browser test.

| # | Finding | Fix | Tests |
| - | ------- | --- | ----- |
| 1 | A rename rescheduled the plan (moving other activities, with no undo point) | `updateActivity` only calls `reschedule` when the start or the duration changed | `plans.test.ts` "renaming an activity moves nothing"; integration "changes made offline on two devices merge" |
| 2 | Undo replayed a snapshot of the whole plan and could overwrite newer edits, also synced ones | The undo point is a diff (`lib/planUndo.ts`: per activity and field, before and after). `revertActivities` restores a field only while it still has the "after" value | `planUndo.test.ts`; `plans.test.ts` "leaves alone what was changed again since", "does not put back a field…"; `plan-changes.test.ts` |
| 3 | Overlapping changes saved the wrong undo point | `services/planChanges.ts` runs changes through `lib/serial.ts`, one at a time. Keyboard moves are worked out from the stored activity (`updateActivity` accepts a function), so repeats add up | `serial.test.ts`; `plan-changes.test.ts` "two changes started at once"; `plans.test.ts` "quick repeats add up"; browser test |
| 4 | Link limit unchecked; dead ids filled `dependsOn` | `linkActivities` drops ids of deleted or unknown activities when the list is full, and refuses a really full list with the new error `limit` (own message). Ids are **not** removed when an activity is deleted: Undo of the delete must bring its links back (FR-131) | `plans.test.ts` "dead ids do not use up the link limit" |
| 5 | Shift + ArrowRight had no upper limit | `nudge` in `lib/timeline.ts` clamps to 1 – `ACTIVITY_DAYS_MAX` | `timeline.test.ts` "nudge" |
| 6 | The timeline could stay stuck in a drag | `onLostPointerCapture` (and pointercancel) abandon the drag | browser test "a drag whose pointer capture is lost" |
| 7 | Rename, delete and add had no error handling | All three go through `planChanges.run`, which turns a failure into a message | `plan-changes.test.ts` "turns failures into an error to show" |
| 8 | A stored link that `liveLinks` ignores could not be re-added | "Already linked" goes by `liveLinks`; such a request is refused as a loop instead of silently doing nothing. `unlinkActivities` also removes the plan's ignored links (`ignoredLinks`), so removing an arrow cannot make a hidden one appear. The "Starts after" list uses `linkCandidates` | `plan.test.ts` (shared) "linkCandidates", "ignoredLinks"; `plans.test.ts` "a stored link that does not count" |
| 9 | Performance while dragging | `liveLinks` is computed once per saved state (`useMemo`) and passed to `schedulePlan` / `brokenLinks` / `earliestStart`; `linkCandidates` walks the links once; weekends are one CSS background (`weekShift`); the day header is a memoised component | `plan.test.ts` (shared) "links computed once"; `timeline.test.ts` "weekShift" |

## Merge with `main` (note lists)

`main` gained note lists while this branch was open, and used the numbers this branch had
taken: migration 007 (`007_note_lists.sql`) and Dexie version 6. The Plan module now uses
**migration 008** and **Dexie version 7**. The pull takes both flags (`lists=modules&plans=1`).
Manage lists is `main`'s page (with the note-list rows); Manage plans keeps
`components/common/ManageItems.tsx` with `main`'s app-bar header, and both use `ListMenu`,
which takes an optional label for its delete item.

## Update 3 – details view, done, scales

Requirements: [PRD.md section 8](./PRD.md#8-update-3--details-view-done-scales) (FR-148 – FR-159).
A **major** change: it adds a field to the data model (server migration, Dexie version, a
pull flag), so it follows the full order: PRD → this plan → tests → implementation.

| Step | Content | Status |
| ---- | ------- | ------ |
| 14 | Shared: `done` in the activity fields, create / update / pulled patches, merge default `false`  | ☑ |
| 15 | Server: migration `009_activity_done.sql`, rows, pull flag `activities=done` (FR-159)  | ☑ |
| 16 | Client data: Dexie version 8 (default `done`, reset the pull cursor), `updateActivity({ done })`, undo diff and `revertActivities` with `done`, recovery copy, engine asks with the flag  | ☑ |
| 17 | Client lib: straight `arrowPath` / `arrowTip` (FR-148), scales (`SCALES`, `dayWidth`, `timelineRange(…, scale)`, `unitSpans`), `planScale` device setting, double-click detector  | ☑ |
| 18 | UI: sticky row column with the details button, `ActivityPage` (details view) and its route, `ActivityBar` removed, done look, double click, options popover with the gear, scale chips, Undo below the timeline, texts, styles  | ☑ |
| 19 | Browser tests for PRD 8.3, decisions, checks  | ☑ |

### Design

- **Data** – `Activity.done: boolean` (`activityFields.done = z.boolean()`), optional in the
  create patch, default `false` in `merge.ts`. Server column
  `done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))` added with `ALTER TABLE` (no
  rebuild needed: `change_log` already knows the entity).
- **Older apps (FR-159)** – the strict pulled-activity patch of an older app refuses
  `done`. The current app pulls with `&activities=done`; without it the server removes
  `done` from activity patches (an update that only changed `done` becomes an empty patch,
  which the old schema accepts and which changes nothing). Dexie version 8 sets
  `done = false` on stored activities and forgets `lastServerSeq`, as version 7 did.
- **Undo** – `ActivityState` gains `done`; `diffActivities` and `revertActivities` treat it
  like `start` and `days`. `planChanges.read` includes it.
- **Geometry** (`lib/timeline.ts`) – every function that turned days into pixels takes a
  `Scale` (`'day' | 'week' | 'month' | 'year'`, default `'day'`, so the Days scale is
  unchanged): `dayWidth(scale)` = 36 / 12 / 4 / 0.6; `timelineRange(spans, today, scale)`
  pads and aligns per scale; `blockBox(span, range, scale)` keeps at least `MIN_BLOCK` = 12
  px; `unitSpans(range, unit)` gives the header cells (day, week, month, quarter, year);
  `headerUnits(scale)` says which two units the two header rows show.
- **Arrows** – `arrowPath(from, to)` with `from = { x, row }` (end of the source) and
  `to = { x, row }` (start of the target) is `M x1 y1 L x2 y2` between the corners;
  `arrowTip` returns the tip and the angle, and the head is a triangle rotated to it.
- **Double click** – `lib/doubleTap.ts`: `createDoubleTap(ms = 400)` returns
  `(id, now) => boolean`, true for the second click on the same id within the time. Used
  in the block's click handler (works for a mouse and for taps; `dblclick` is not fired
  reliably for touch on an element with `touch-action: none`).
- **Details view** – `components/plan/ActivityPage.tsx`, route
  `/plan/:planId/activity/:activityId` (before `/plan/:planId`). Its own `planChanges` for
  errors. `activityPath(planId, id)` in `PlansHome.tsx` next to `planPath`.
- **Options** – `components/plan/PlanOptions.tsx`: gear `button.icon-btn` with
  `aria-expanded` / `aria-controls`, a panel (`.plan-options`) with the name chips; closes on
  Escape and on a pointer down outside.
- **Scale setting** – `lib/planScale.ts` (`todoness.plan.scale`), same shape as
  `planNames.ts`.

### Tests (written before the code)

| Where | What |
| ----- | ---- |
| `shared/test/plan.test.ts` | `done` in create / update / pulled patches, rejects a non-boolean, merge default `false` |
| `server/test/plans.test.ts` | `done` pushed and pulled with `activities=done`; left out without it |
| `server/test/migrate.test.ts` | migration 009 adds `done` (default 0) and keeps rows |
| `client/test/data/plans.test.ts` | `updateActivity({ done })` saves, moves nothing; revert restores `done` |
| `client/test/data/plans-upgrade.test.ts` | version 8 sets `done = false` and resets the cursor |
| `client/test/lib/planUndo.test.ts` | diff covers `done` |
| `client/test/lib/timeline.test.ts` | straight arrows, tip angle, scales, ranges, unit spans, min block width |
| `client/test/lib/planScale.test.ts`, `doubleTap.test.ts` | the setting; double tap timing |
| `e2e/test/plan.test.ts` | PRD 8.3 points 1 – 7 (the old edit bar and Starts after tests are rewritten for the details page) |

### Changed on the way

1. **Short blocks on coarse scales show their name after the block.** At 4 or 0.6 px per
   day a block is often 12 – 47 px wide; "On block" then showed "D…". A block narrower than
   48 px (`NARROW_BLOCK` in `Timeline.tsx`) puts its name after itself and hides its grip
   marks; the block's inner padding shrinks with it, so 12 px stays 12 px.
2. **Click selects, it no longer toggles the selection**, so the two clicks of a double
   click leave the block selected instead of selecting and deselecting it.
3. **`input[type='number']`** joined the shared field styles (the duration is the app's
   first number field).
4. **Browser tests and the sign-up limit.** The server allows 20 sign-ups per hour from one
   address; one user per test went over it. The checks of the options panel and of Undo's
   place share a user with a neighbouring test.
5. **Scrolling keeps its place across scales:** the day at the left edge of the view stays
   at the left edge when the scale changes (and, as before, when days are added on the left).

## Update 4 – counts, overdue blocks, hiding done activities

Requirements: [PRD.md section 9](./PRD.md#9-update-4--counts-overdue-blocks-hiding-done-activities)
(FR-160 – FR-162). No data model, sync or API change; several client modules, so it follows
PRD → plan → tests → code.

| Step | Content | Status |
| ---- | ------- | ------ |
| 20 | Client data: `countActivitiesByPlan(db)` in `data/queries.ts` | ☑ |
| 21 | Client lib: `isOverdue(span, done, today)` in `lib/timeline.ts`; `lib/planHideDone.ts` device setting (`todoness.plan.hideDone`) | ☑ |
| 22 | UI: count badge in `PlanNav` (`Sidebar.tsx`); overdue class and name in `Timeline.tsx`; switch in `PlanOptions.tsx`, `hideDone` from `PlanPage.tsx` to `Timeline`; texts and styles | ☑ |
| 23 | Tests: unit tests for the three helpers, browser test for PRD 9.3 | ☑ |

### Design

- **Count** – one pass over `db.activities`, live rows only, keyed by `planId`, like
  `countOpenTodosByList`.
- **Overdue** – `isOverdue(span, done, today)`: `!done && endDay(start, days) < today`. The
  timeline reads `today` once (as for today's line) and adds `.is-overdue` to the bar.
- **Hide done** – `Timeline` gets `hideDone`. What would be drawn (`shown`, including the
  drag preview and what it pushes) is worked out from all activities as before, then done
  ones are filtered out for rows, blocks and arrows. The grid range follows the visible
  activities.

### Tests (written before the code)

| Where | What |
| ----- | ---- |
| `client/test/data/plans.test.ts` | `countActivitiesByPlan` counts live activities per plan, done included, deleted not |
| `client/test/lib/timeline.test.ts` | `isOverdue`: ended yesterday, ends today, done |
| `client/test/lib/planHideDone.test.ts` | the setting: default off, remembered, blocked storage |
| `e2e/test/plan.test.ts` | PRD 9.3 points 1 – 3 (in the options test, to stay under the sign-up limit) |
