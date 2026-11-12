# ToDoness Plan – Product Requirements Document (PRD)

|                  |                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **Status**       | v1.0 – built; **Update 3** (section 8) – built (see [ImplementationPlan.md](./ImplementationPlan.md)) |
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
  *(Update 3: an activity now has a details view and a done state, section 8.)*
- Hours and minutes: the smallest step is one day **[Answered]**.
- Other kinds of links than end → start (start → start, end → end, start → end), and lag
  or lead time on a link **[Answered]**.
- Skipping weekends or holidays: every calendar day counts.
- Reordering the activity rows by hand (a new activity goes to the bottom; the order key is stored,
  so this can come later), grouping, milestones, zoom levels (week / month columns). *(Update 3: zoom levels are in, FR-157.)*
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

## 8. Update 3 – details view, done, scales

Requested by the product owner after using the module (nine points, quoted in short):

1. Dependency arrows should be **straight**: the end of a block points straight at the
   beginning of the next one.
2. All details of an activity go to a **separate view**, opened with a button on its row.
3. The **Starts after** field does not work well and is not needed: remove or change it.
4. The details show the **duration** instead of the end day.
5. A **done** activity looks different on the timeline.
6. The name position (**On block / After block / Column**) moves to an **options view**
   behind a gear button.
7. **Double-clicking** a block marks the activity done, or not done when it already is.
8. **Undo last change** moves to the bottom of the plan.
9. The timeline can show **days, weeks, months or years**.

Requirements in this section replace the ones they name; everything else stays.

### 8.1 Requirements

| ID     | Requirement | Priority |
| ------ | ----------- | -------- |
| FR-148 | **Straight arrows** (replaces the route of FR-135). A dependency A → B is drawn as **one straight line** from the end of A to the start of B: from the bottom right corner of A's block to the top left corner of B's block (top right of A to bottom left of B when B is in a row above). The arrow head sits on B's corner and points along the line. When B starts the day after A ends, the line is vertical, as before. A broken link (FR-139) is the same line, dashed in the warning colour. **[Decision P12]** | Must |
| FR-149 | **Details view.** Every row of the timeline has a **details button** (an icon button named "Details of ‹name›"), in a narrow column at the left that stays visible while scrolling sideways (next to the name in the Column mode). It opens the activity's own page (`/plan/‹plan›/activity/‹activity›`) with an app bar (back button to the plan, title) and the fields **Name, Start, Duration, Done**, the activity's dependencies (FR-151) and **Delete activity**. The edit bar of FR-130 is removed; selecting a block only highlights it (for the keyboard of FR-132). **[Decision P13]** | Must |
| FR-150 | Changes on the details page are saved at once (the name on Enter or when the field is left), go through the same rules as on the timeline (the automatic shift of FR-136, the earliest start of predecessors) and show a message when refused. Delete goes back to the plan and shows the usual Undo message (FR-131). An activity that does not exist (any more) leads back to its plan. | Must |
| FR-151 | **Starts after** (replaces the field of FR-133). The details page lists the activities this one **starts after** – its live predecessors – each with a **remove** button (removing moves nothing, as FR-138). Without predecessors the list is not shown. New dependencies are made on the timeline by dragging (FR-133). **[Decision P14]** | Must |
| FR-152 | **Duration** (replaces the End field). The details page shows the **duration in days** (a number field, 1 – 3660) instead of the end day; the end day is shown next to it as a hint ("ends ‹day›"). Changing the duration keeps the start (as dragging the end does). | Must |
| FR-153 | **Done.** An activity can be **done** (a new field, `done`, default not done). It is set and cleared with a switch on the details page and by FR-154; it syncs like every other field and is part of the recovery copy. Done changes nothing in the schedule. | Must |
| FR-154 | **Double click** (or double tap) on a block toggles done. It is a timeline change, so **Undo last change** takes it back (FR-147 now also covers `done`). A double click does not move the block. | Must |
| FR-155 | On the timeline a **done block** is drawn differently: a light (surface) fill with an accent outline instead of the solid accent fill, a ✓ before the name and the name struck through (on the block, after it and in the column). Its accessible name ends with ", done". | Must |
| FR-156 | **Options.** The name position switch (FR-140, FR-141) moves into an **options panel** opened by a **gear button** (named "Timeline options") above the timeline. The panel opens below the button, closes with the button, Escape or a click outside, and holds the three chips as before. | Must |
| FR-157 | **Scale.** A chip group **Days · Weeks · Months · Years** above the timeline sets how much time a column shows: one day (as before), one week, one month or one quarter of a year (with years above). Blocks, arrows, today's line and dragging work the same on every scale; a drag still moves by whole days. The grid starts at the beginning of a column unit (Monday, the 1st of a month, 1 January) and keeps spare room around the activities that fits the scale. The choice is a **device setting** like the name position, first **Days**. **[Decision P15]** | Must |
| FR-158 | **Undo last change** (FR-147) sits **below the timeline**, at the bottom of the plan, on the left. Ctrl / ⌘ + Z keeps working. | Must |
| FR-159 | **Older apps.** Apps from before this update keep syncing plans: the server leaves `done` out of what it sends to them (they would refuse the unknown field). Once updated, the app reads all changes again and so gets the done states it skipped. | Must |

### 8.2 Decisions

| ID  | Decision |
| --- | -------- |
| P12 | **Corner to corner.** "The end pointing straight to the beginning" is read as one straight segment between the two points where the blocks end and begin. Using the corners (not the middle of the block's ends) keeps the line off both blocks when they overlap in time less than a row's height of slope, keeps the vertical line of Update 1 for activities that follow directly, and makes the line the same on every scale. |
| P13 | **A page, not a dialog.** "A separate view" with an app bar matches the task details on a phone and the Manage pages; it has an address, so Back works. The button is in a narrow sticky column so that it is on the row in every name mode and never hides under a block. The old edit bar goes away: having two places to edit the same fields was the clutter the request asks to remove. |
| P14 | **Starts after becomes a list, not a picker.** The product owner did not need to *add* dependencies from a field; dragging does that. What a details page should still say is what the activity waits for, and a remove button there is the phone-friendly way to delete a link (arrows are thin targets on a touch screen). |
| P15 | **Scales are pixel widths of a day, drags stay in days.** Days 36 px, weeks 12 px, months 4 px and years 0.6 px per day. Columns are labelled by unit (day number; the week's Monday; the month; the quarter, with the year above). Moving by whole weeks or months on the coarse scales would make exact days impossible there; the details page is the exact way. A block is never drawn narrower than 12 px, so a short activity stays visible and grabbable on the Years scale. |
| P16 | **Done is a field of the activity** (`done: boolean`) and not a progress percentage: the request is a yes / no, and a boolean merges per field like every other one. A double click is an undoable timeline change, because a double click on a dragging surface is easy to make by accident. |

### 8.3 Acceptance (tested)

1. An arrow is one straight line from the end of its source block to the start of its target block.
2. The details button of a row opens the details page; it renames, sets the start and the duration, marks done, lists and removes a predecessor, and deletes with Undo.
3. There is no Starts after picker and no End field.
4. A double click marks an activity done (drawn differently), a second one clears it; Undo last change takes a double click back.
5. The gear opens the options with the name chips; the choice still survives a reload.
6. Days / Weeks / Months / Years change the column width and header; the choice survives a reload; dragging works on the Weeks scale.
7. Undo last change is below the timeline.
8. An app without the `done` flag gets activity changes without `done`.

## 9. Update 4 – counts, overdue blocks, hiding done activities

Requested by the product owner (three points, quoted in short):

1. The list of plans shows a **number** (the sum of its activities), like the task and note lists.
2. A time block whose **end has passed** is shown in **red**.
3. A control **hides all done activities** from the timeline.

### 9.1 Requirements

| ID     | Requirement | Priority |
| ------ | ----------- | -------- |
| FR-160 | **Count in the plan list.** Every plan in the sidebar shows the number of its live activities (done ones included) at the right, with the same `.nav-count` badge as the task and note lists, and a tooltip "‹n› activities". **[Decision P17]** | Must |
| FR-161 | **Overdue blocks.** An activity that is **not done** and whose **last day is before today** is drawn in the danger (red) colour, on every scale and in every name mode. Its accessible name ends with ", overdue". A done activity keeps the done look (FR-155), however old. **[Decision P18]** | Must |
| FR-162 | **Hide done.** The options panel (FR-156) holds a switch **Hide done activities**. When it is on, done activities have no row, no block and no arrows on the timeline; the rows close up. Moving a visible activity still pushes hidden ones that wait for it (FR-136). The choice is a **device setting**, first off. When every activity of a plan is hidden, the plan says so. **[Decision P19]** | Must |

### 9.2 Decisions

| ID  | Decision |
| --- | -------- |
| P17 | **All activities are counted**, not only the open ones: the request asks for the sum of the activities, and a plan's done activities are still part of it (the task list counts open tasks because done ones are hidden there by default). |
| P18 | **"The end has passed" is the end of the last day.** An activity ending today is not overdue yet. Done activities are finished, so they are not overdue. Red uses `--danger`, so it works in both themes. |
| P19 | **A switch in the options panel**, not a chip above the timeline: it is an on / off setting (UI guidelines: a switch) used less often than the scale. Dependencies of hidden activities are still kept and still scheduled; only their arrows are not drawn, since one end would point at nothing. |

### 9.3 Acceptance (tested)

1. The sidebar shows the number of activities of each plan and follows adds and deletes.
2. An open activity that ended before today is red with ", overdue" in its name; marked done, it is not.
3. The switch hides done activities and their rows; the choice survives a reload; turned off, they are back.

## 10. Update 5 – a mark for hidden predecessors

Requested by the product owner: when task 1 depends on task 2, task 2 is done and done
activities are hidden, task 1 shows a **horizontal dotted line of about 30 px before its
block**, so that it is clear a hidden activity it waits for is not on the timeline.

### 10.1 Requirements

| ID     | Requirement | Priority |
| ------ | ----------- | -------- |
| FR-173 | **Hidden predecessor mark.** While done activities are hidden (FR-162), a visible activity with at least one **hidden predecessor** (a live dependency, FR-133, whose source is not drawn) shows a horizontal **dotted line, 30 px long, ending at the start of its block**, at the middle of its row. One line per activity, however many hidden predecessors. It is a mark only: it cannot be clicked and does not change the schedule. With hiding off, or without hidden predecessors, there is no line. **[Decision P20]** | Must |

### 10.2 Decisions

| ID  | Decision |
| --- | -------- |
| P20 | **Fixed 30 px on every scale**, in the muted arrow colour, dotted so that it does not read as an arrow (solid) or a broken link (dashed, FR-139). Only predecessors are marked (the request is about what an activity waits for). The line may start left of the grid's first day only if the block starts there; it is then cut at the grid's edge. |

### 10.3 Acceptance (tested)

1. Design → Build, Design done, hiding on: Build has the dotted line before its block; Design has none.
2. Hiding off: no line.

## 11. Update 6 – activity groups

Requested by the product owner: activities can be **grouped**. Moving one activity onto
another creates a **parent activity** drawn as a high and wide, lighter time block that
covers its children. A parent can be **expanded** (its children drawn inside it) or
**collapsed** (one row like any other activity, but with bold **{ }** at the ends instead of
the **[ ]** grips). A child can have children of its own. The proposal and mockup
(reviewed with the product owner) chose the rules below.

### 11.1 Requirements

| ID     | Requirement | Priority |
| ------ | ----------- | -------- |
| FR-174 | **Groups.** An activity can be **part of** another activity (a new field, `parentId`, default none). An activity with at least one live child is a **group**. Groups can be nested, up to **4 levels** deep (a top-level activity is level 1). A group is listed, linked, renamed, opened and deleted like any activity. **[Decision P21]** | Must |
| FR-175 | **A group's dates come from its children**: it starts with its earliest child and ends with its latest one (also after a sync), so it always covers them. Its own start and duration cannot be set; its details show them read-only. **[Decision P22]** | Must |
| FR-176 | **Making a group by dragging.** Dragging a block by its **middle** (not its grips) and holding it over a block of **another row** outlines that block; releasing: on an **activity** creates a **new group** at that activity's place holding both (named "‹target› & ‹dragged›"); on a **group** (its collapsed block or the box of an expanded one) adds the dragged activity to it as its last child. Over **an empty part of another row**, outside its group's box, it **takes the activity out** of its group (into the enclosing group's box under the pointer, or to the top level). In its own row the drag moves the dates as before (FR-127). A drag that would put a group into itself, or nest deeper than 4 levels, is refused with a message. A line below the timeline says what releasing will do. **[Decision P23]** | Must |
| FR-177 | **Part of** (keyboard and phone). The details page of an activity has a **Part of** select: *None*, every group it can join, and "New group with ‹activity›" for every activity it can be grouped with. Choosing does what the drag does. | Must |
| FR-178 | **A group with no children left is removed** when the user's change emptied it (dragging its last child out or into another group). | Must |
| FR-179 | **Expanded group.** It is drawn as a light, tall box from its own row (a header with an expand / collapse button, its name in bold, its dates and how many of its activities are done) down to its last child's row, a little wider than its children; nested groups are boxes inside it, each level slightly darker. | Must |
| FR-180 | **Collapsed group.** One row with one block, like any activity, in a lighter colour with a bold **{** and **}** at its ends (instead of the grips), the expand button, its name, the number of activities in it and a thin progress line along its bottom (done / all). Its children have no rows; arrows to or from them are drawn to the group's block (one arrow per pair). | Must |
| FR-181 | **Expand / collapse** with the ▸ / ▾ button on the group (the box header, the collapsed block, and the name column in the Column mode). Which groups are collapsed is a **device setting per plan**; new groups are expanded. **[Decision P25]** | Must |
| FR-182 | **Moving a group** (dragging its collapsed block, its **{** grip or the header of its box; keys ← / → on its block; its Start field) moves **every activity in it** by the same number of days, not before its predecessors allow. Its **}** grip does not change any duration: it only makes links. | Must |
| FR-183 | **Links and groups.** A dependency can be made to and from a group as to any activity. **A → group**: every activity in the group starts after A has ended. **Group → B**: B starts after the group's last activity has ended. The automatic shift (FR-136) and the loop check (FR-137) follow these rules; a link between a group and an activity inside it is refused as a loop. **[Decision P24]** | Must |
| FR-184 | **Done.** A group is done when all its activities are done. A double click on a collapsed group's block, or its **Done** switch, marks all its activities done (or all not done, when they all are). With **Hide done activities** (FR-162) a group whose activities are all done is hidden as a whole. | Must |
| FR-185 | **Name column.** In the Column mode the names are a tree: indented by level, group names in bold with their expand button. | Must |
| FR-186 | **Deleting a group.** Its details page offers **Ungroup** (the group goes, its children stay in its place) and **Delete group and ‹n› activities**; Delete on a selected group block is the second. Both show the usual Undo message. | Must |
| FR-187 | **Undo last change** (FR-147) also takes back grouping and ungrouping by drag or Part of, including the group it created or removed. | Must |
| FR-188 | **Older apps.** Apps from before this update keep syncing plans: the server leaves `parentId` out of what it sends to them. A group's stored start and duration are kept equal to its children's dates by every change made in the app, so an older app shows a group as an ordinary activity over the same days. Once updated, the app reads all changes again. | Must |

### 11.2 Decisions

| ID  | Decision |
| --- | -------- |
| P21 | **A group is an activity with children**, not a new entity: one field (`parentId`) more, so groups sync, merge, are deleted, restored, linked and kept in the recovery copy like activities. A `parentId` that cannot count (unknown, deleted, another plan, itself, or a loop made by two devices at once) is ignored when drawing and scheduling, looking at activities in a fixed order (by id), so every device shows the same tree – the same approach as for links (`liveLinks`). Nothing is repaired automatically (P7). Four levels keep a row's indent and the nested boxes readable on a phone. |
| P22 | **Derived dates.** "The parent covers its children" must stay true after two devices change different children; stored group dates could not guarantee that. The stored `start` / `days` of a group are only a copy for older apps (FR-188) and for the moment a group loses its last child. |
| P23 | **Dropping on an activity makes a new group** instead of turning the target into the parent: the target is real work with its own dates, which a group cannot keep. **The middle of a block groups, the grips link** (FR-133), and the drag only groups in **another row**, so the moves of FR-127 are unchanged. |
| P24 | **Links to a group are links to all its activities**, links from a group wait for all of them. The schedule is worked out on the activities that are not groups; a group follows them. |
| P25 | **Collapsed state is a view setting** (like the name mode, P6), per plan and per device: collapsing to see the overview on a phone should not collapse it on a computer. |

### 11.3 Acceptance (tested)

1. Dragging the middle of B onto A in another row makes the group "A & B" with both inside; dropping C on the group adds it; dragging C out of the box takes it out; Undo last change takes the group back.
2. A group starts with its first child and ends with its last; moving the group moves all children.
3. Collapsing shows one block with { }, the count and no child rows; it survives a reload; expanding shows the children again.
4. A link A → group pushes every child after A; group → B pushes B after the last child; a link from a group to its own child is refused.
5. Done: a double click on a collapsed group marks all its activities done; hiding done hides the group.
6. The details page sets Part of (join, new group, none), and Ungroup / Delete group work with Undo.
7. The Column mode shows the names as a tree.
8. An app without the groups flag gets activity changes without `parentId`.
