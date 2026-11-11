# ToDoness Plan – Product Requirements Document (PRD)

|                  |                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **Status**       | v1.0 – built (see [ImplementationPlan.md](./ImplementationPlan.md))                              |
| **Builds on**    | Notes ([`../notes/PRD.md`](../notes/PRD.md)), v1 ([`../v1/PRD.md`](../v1/PRD.md)) and the MVP    |
| **Related docs** | [ImplementationPlan.md](./ImplementationPlan.md) (plan, design, decisions taken on the way)      |

> Everything in the earlier PRDs still applies unless this document says otherwise.
> Requirement numbers continue where the UI refresh stopped (FR-119 and up).
> Choices made where the request left room are marked **[Decision]** and explained in
> section 6. Answers the product owner gave before this document was written are marked
> **[Answered]**.

---

## 1. Summary

ToDoness gets a third **module** next to Tasks and Notes: **Plan**. A plan is a timeline
(a Gantt chart) that helps to put activities in order:

1. There can be **several plans**. They are created, opened, renamed and deleted the way
   task lists are: a list in the sidebar with a "new plan" field below it.
2. A plan holds **activities**. An activity has only a **name**, a **start day** and an
   **end day**. It is drawn as a **block** on a day grid, from its start to its end.
3. Blocks are changed by **dragging**: grabbing the beginning (or the block itself) moves
   the activity to another start day; grabbing the end changes how long it lasts.
4. Activities can be **linked**: the end of one block to the start of another. The link is a
   **dependency** – the second activity can only start after the first one has ended – and
   it is drawn as an **arrow**. When the first activity moves or gets longer, the ones that
   depend on it are pushed later automatically.
5. A switch chooses where the **name** of an activity is shown: **on** the block, **after**
   the block, or in an extra **column** left of the timeline (the classic Gantt layout).

Plans are ordinary synced data: they work offline and appear on all devices of the user.

## 2. Goals and non-goals

**Goals**

- Seeing at a glance in which order activities happen and how long they take.
- Changing a plan directly on the timeline, with the mouse, a finger or the keyboard.
- Dependencies that are quick to make, visible, and that keep the plan consistent.
- Plans as reliable as tasks and notes: offline-first, synced, restorable.

**Non-goals (for this first version)**

- A details view of an activity; descriptions, assignees, progress, colours, attachments.
- Hours and minutes: the smallest step is one day **[Answered]**.
- Other kinds of links than end → start (start → start, end → end, start → end), and lag
  or lead time on a link **[Answered]**.
- Skipping weekends or holidays: every calendar day counts.
- Reordering the activity rows by hand (a new activity goes to the bottom; the order key is stored,
  so this can come later), grouping, milestones, zoom levels (week / month columns).
- Public (shared) plans, links between activities and tasks, reminders for activities.
- Printing or exporting a plan.

## 3. User stories

| ID  | As a user, I want to…                                                    | So that…                                   |
| --- | ------------------------------------------------------------------------ | ------------------------------------------ |
| P1  | switch to Plan with one tap, next to Tasks and Notes                     | planning is as close as my tasks           |
| P2  | keep several plans and create one the way I create a task list           | each project has its own timeline          |
| P3  | add an activity by typing its name                                       | building a plan is fast                    |
| P4  | see every activity as a block from its start day to its end day          | I see order and duration at a glance       |
| P5  | grab the beginning of a block and put it on another day                  | I can reschedule an activity               |
| P6  | grab the end of a block and stretch or shrink it                         | I can change how long it takes             |
| P7  | link the end of one block to the start of another and see an arrow       | I know what has to be finished first       |
| P8  | have dependent activities pushed later when an earlier one slips         | the plan never shows an impossible order   |
| P9  | choose whether names are on the blocks, after them, or in a column       | the chart stays readable for my data       |
| P10 | use my plans offline and on all my devices                               | plans work everywhere, like tasks          |

## 4. Requirements

Priority: **Must** = part of this version, **Should** = included unless it endangers it.

### 4.1 The Plan module and plans

| ID     | Requirement                                                                                                                                                                                                                                                 | Priority |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-119 | The module switch shows **Tasks, Notes, Plan** (in this order), in the sidebar on a computer and in the top bar on a phone. The rules of FR-83 – FR-87 apply to Plan too (always one tap away, the app reopens in the module used last).                      | Must     |
| FR-120 | In the Plan module the sidebar lists the user's plans (oldest first, new ones at the bottom) and, below them, a **new plan** field with an **Add plan** button, working like "new list": typing a name and pressing Enter creates the plan and opens it.     | Must     |
| FR-121 | A plan has a **name** (1 – 200 characters). Plans are **renamed, reordered (drag and drop) and deleted** on a **Manage plans** page, reached from a button under the plans in the sidebar; it works like *Manage lists* (a ⋯ menu per row). Deleting asks for confirmation and deletes the plan's activities too. *(Update 1: before, Rename and Delete were buttons on the plan page.)* | Must |
| FR-122 | Opening the Plan module shows the plan opened last in this visit, else the first plan; with no plan at all it shows an empty state that points to the "new plan" field. A plan that does not exist (any more) leads back there.                              | Must     |

### 4.2 Activities and the timeline

| ID     | Requirement                                                                                                                                                                                                                                                                             | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-123 | An activity has a **name** (1 – 200 characters), a **start day** and an **end day** (end ≥ start; one day is the shortest activity). Nothing else.                                                                                                                                       | Must     |
| FR-124 | An activity is added by typing its name above the timeline and pressing Enter (or **Add activity**). It goes to the bottom row. **[Decision P4]** It starts the day after the latest end in the plan (today in an empty plan) and lasts 3 days.                                          | Must     |
| FR-125 | The plan page shows a **timeline**: a grid with one column per day (a header with months and day numbers, weekends shaded, today marked) and one row per activity. The grid always covers all activities and today, with spare days on both sides, and scrolls sideways.                 | Must     |
| FR-126 | Each activity is a **block** from the left edge of its start day to the right edge of its end day.                                                                                                                                                                                       | Must     |
| FR-127 | **Grabbing the beginning** of a block (its left handle, or the block itself) and dragging moves the activity: the start day becomes the day it is dropped on, the duration stays. **[Decision P2]**                                                                                      | Must     |
| FR-128 | **Grabbing the end** of a block (its right handle) and dragging changes the duration: the end day becomes the day it is dropped on, never before the start day.                                                                                                                          | Must     |
| FR-129 | While dragging, the block follows the pointer in whole days and the new dates are shown; releasing saves, **Escape** cancels. Dragging works with a mouse and with touch.                                                                                                                | Must     |
| FR-130 | Selecting an activity (click, tap or keyboard focus + Enter) shows an **edit bar** with its name, start day and end day as fields (native date pickers) and **Delete**. This is how an activity is renamed, and the exact, keyboard and phone friendly way to set dates. **[Decision P5]** | Must     |
| FR-131 | Deleting an activity shows the usual **Undo** message. Links from and to it disappear with it and come back with Undo.                                                                                                                                                                   | Must     |
| FR-132 | Keyboard on a focused block: ← / → move it one day, Shift + ← / → make it one day shorter / longer, Delete removes it.                                                                                                                                                                   | Should   |

### 4.3 Dependencies

| ID     | Requirement                                                                                                                                                                                                                                                                        | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-133 | A dependency is made by **dragging an end of a block onto another block**: the end of A dropped on B, or the beginning of B dropped on A, creates **A → B**. As long as the pointer stays in the block's own row the drag changes the duration (end) or the start day (beginning), as in FR-127 / FR-128; over a block of another row it shows a line to that block and releasing links them. There are no separate link points. The edit bar has a **Starts after** field that adds a dependency without dragging (keyboard, phone). *(Update 1: before, each block had a link point at each end.)* **[Decision P10]** | Must |
| FR-134 | A dependency A → B means: **B starts after A has ended** (B's start day ≥ the day after A's end day). Only end → start links exist **[Answered]**. An activity can have several predecessors and several successors.                                                               | Must     |
| FR-135 | Every dependency is drawn as a line with an arrow head that **enters B from above (or below) at its start**. When B starts the day after A ends, it is one **straight vertical line** from the end of A to the start of B. Otherwise it leaves the end of A sideways, along A's row, and turns down (or up) at B's start: through the upper right corner, not along B's row. *(Update 1.)* | Must |
| FR-136 | **Automatic shift [Answered]:** whenever a change would break a dependency (A is moved or made longer, a link is created, B is dragged too early), B is moved to the first allowed day, keeping its duration, and so on down the chain. Activities are never pulled earlier by it.  | Must     |
| FR-137 | A link that would close a **loop** (B already leads to A), a link of an activity to itself, and a duplicate are refused; a loop shows a short message.                                                                                                                             | Must     |
| FR-138 | A dependency is removed by selecting its arrow (click, or keyboard focus + Enter / Delete). Removing it moves nothing, and **Undo last change** (FR-147) brings it back. | Must |
| FR-139 | If two devices changed a plan at the same time and the merged result breaks a dependency, the arrow is shown as **conflicting** (warning colour) until the next change of dates or links in that plan, which repairs it by the rule of FR-136. A rename moves nothing *(review of PR 17)*. **[Decision P7]**                                      | Should   |

### 4.4 Where the name is shown

| ID     | Requirement                                                                                                                                                                                                                             | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-140 | A three-way switch above the timeline – **On block**, **After block**, **Column** – sets where activity names are shown: inside the block; right of the block; or in an extra first column that stays visible while scrolling sideways. | Must     |
| FR-141 | The choice is remembered on the device and used for all plans. The first time it is **On block**. **[Decision P6]**                                                                                                                      | Must     |

### 4.5 Offline, sync and recovery

| ID     | Requirement                                                                                                                                                                                                                                 | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-142 | Plans and activities work **offline** and **sync** like tasks and notes: same queue, per-field "last write wins", soft delete. A user only ever sees and changes their own plans.                                                            | Must     |
| FR-143 | Devices still running an **older app version** keep syncing tasks, lists and notes after the server is updated; once they update, they receive all plans.                                                                                    | Must     |
| FR-144 | Plans and their activities are part of the **recovery after a server loss** (v1 section 4.11): they are kept aside with tasks, lists and notes and restored with them.                                                                       | Should   |

### 4.6 Look and accessibility

| ID     | Requirement                                                                                                                                                                                                                 | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-145 | All controls follow [`UI_GUIDELINES.md`](../../UI_GUIDELINES.md): chips for the name switch, native date inputs, buttons for actions, 44 px rows and handles on phones, colours only from the theme variables, dark mode.   | Must     |
| FR-146 | Blocks and arrows are focusable and named for screen readers ("Design, 3 Mar – 5 Mar", "Design → Build, remove link").                                                                                                      | Should   |

### 4.7 Undo (update 1)

| ID     | Requirement | Priority |
| ------ | ----------- | -------- |
| FR-147 | Dragging can easily go wrong (a link instead of a longer block, or the other way round). So after **every change made on the timeline** – a move, a new duration, a new or removed dependency, also by keyboard – an **Undo last change** button above the timeline (and Ctrl / ⌘ + Z) takes that change back, including activities that were pushed by it. Undo only touches what the change itself altered, and only where nobody has changed it again since: a change that arrived from another device meanwhile is never overwritten *(review of PR 17)*. One step is kept, per plan page, until the next change or until the page is left. **[Decision P11]** | Must |

## 5. Data

```text
Plan     = { id, name, orderKey, fieldHlc, createdAt, updatedAt, deletedAt }
Activity = { id, planId, name, start, days, dependsOn, orderKey,
             fieldHlc, createdAt, updatedAt, deletedAt }
```

- `start` is a calendar day, `YYYY-MM-DD`, without a time zone: a plan shows the same days
  everywhere. `days` is the duration (1 – 3660); the **end day** is `start + days − 1`.
- `dependsOn` is the list of ids of the activities that must end before this one starts
  (at most 50).

## 6. Decisions

| ID  | Decision                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **Start + duration is stored, not start + end.** Two devices may change different fields of one activity; with a stored end day the merge could give an end before the start. Any start with any duration ≥ 1 is a valid activity, so no merge can break one. The end day is shown and edited everywhere; it is just computed.                                        |
| P2  | **Grabbing the beginning moves the block; only the end changes the duration.** This is the reading of the request ("start time changes" vs "duration changes") that fits P1, and it makes the two handles do two different, predictable things. Setting an earlier start *and* keeping the end is done in two steps or in the edit bar.                               |
| P3  | **Dependencies are a field of the dependent activity** (`dependsOn`), not rows of their own. One entity less in the sync, and deleting / restoring an activity needs no extra bookkeeping: links to a deleted activity are simply ignored. The cost: if two devices change the links *into the same activity* at the same time, the later change wins as a whole.     |
| P4  | **A new activity follows the last one and lasts 3 days.** Plans are usually typed in order, so the chart grows to the right by itself, and a 3-day block is easy to grab. It does not get a link automatically.                                                                                                                                                       |
| P5  | **An edit bar, not a details view.** The request excludes a details view, but a name must be changeable and dragging is not enough on a phone or with a keyboard. The bar holds exactly the three properties of an activity plus Delete and appears only while an activity is selected.                                                                              |
| P6  | **The name position is a device setting,** like the theme: what is readable depends on the screen (a column costs a third of a phone's width), not on the plan.                                                                                                                                                                                                      |
| P7  | **The app never changes data by itself after a sync.** Repairing a broken dependency while applying pulled changes would create new changes on every device at once (they could chase each other). It is shown as a conflict and repaired with the next change of dates or links the user makes in that plan – on whichever device that happens.                                        |
| P8  | **The shift only pushes later, never pulls earlier.** Shortening A leaves a gap before B. Closing gaps automatically would move activities the user placed on purpose.                                                                                                                                                                                               |
| P9  | **Every calendar day counts.** No working-day calendar in this version (non-goal); weekends are only shaded.                                                                                                                                                                                                                                                          |
| P10 | **No link points; the grips do both jobs.** The rings beside every block took room and attention. The rule "same row = change the block, another block = link" needs no extra control. Its cost, an unintended link or resize, is covered by Undo (P11), and the target block is outlined while a link would be made. |
| P11 | **Undo restores a snapshot, one step deep.** A timeline change leaves a record of what it altered (per activity and field, the value before and after); Undo writes the earlier values back as ordinary synced changes, each only while the field still holds what the change wrote. One step is what "revert the last drag" needs; a history would have to deal with changes arriving from other devices in between. Deleting an activity keeps its own Undo message. |

## 7. Acceptance (tested)

1. Tasks | Notes | Plan switch; the app reopens in Plan after it was used last.
2. A plan is created from the sidebar and opened; renamed, reordered and deleted on Manage plans.
3. An activity is added, shown as a block of the right length on the right days.
4. Dragging the start handle moves it; dragging the end handle changes its end day.
5. Dropping the end of A on B draws an arrow and pushes B after A; lengthening A pushes B (and C behind B).
6. A loop is refused; an arrow can be removed; Undo last change reverts a drag, a link and a removal.
7. On block / After block / Column changes where names are, and survives a reload.
8. A plan made offline on one device appears on another after sync.
9. An old app version still pulls tasks while plans exist, and gets the plans after updating.
