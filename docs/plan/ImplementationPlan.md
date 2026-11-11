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
| 1    | Shared: days, `plan` and `activity` entities (schemas, operations, merge defaults), scheduling rules | ☐      |
| 2    | Server: migration 007, rows, push / pull of plans and activities, pull for older apps               | ☐      |
| 3    | Client data: Dexie version 6, repo operations with the automatic shift, queries, pulled changes     | ☐      |
| 4    | Recovery: plans and activities in the snapshot and the restore                                      | ☐      |
| 5    | Client lib: timeline geometry (range, day ↔ pixel, arrow paths), name position setting, module      | ☐      |
| 6    | UI: module switch, sidebar, plan page, timeline, drag, links, edit bar, texts, styles               | ☐      |
| 7    | Browser (e2e) tests, README, decisions                                                              | ☐      |

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

**Server** – migration `007_plans.sql`: tables `plans` and `activities` (owner column,
`ON DELETE CASCADE` from `users`; `activities.plan_id` references `plans`), and `change_log`
is rebuilt once more because its `CHECK (entity IN …)` must learn the two entities (same
method as migration 004: every row keeps its `server_seq`, the counter carries over).

**Client** – Dexie version 6 adds `plans: 'id, orderKey'` and
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
  else. When such a device updates, the Dexie upgrade to version 6 **resets the pull cursor**:
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

**Tests first** (`server/test/plans.test.ts`, `migrate.test.ts`): migration from version 6
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

_(filled in during implementation)_
