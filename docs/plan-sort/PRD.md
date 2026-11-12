# Sort activities and Auto sort – PRD

Follows [`../plan/PRD.md`](../plan/PRD.md) (activities, dependencies FR-136, groups
FR-174 – FR-188, Undo FR-147, options FR-156). Requirement numbers continue from FR-188.

## 1. Problem

Activities are listed in the order they were added (their row order). After dates are changed,
links added or groups made, the rows no longer follow the calendar, and the user has to drag
rows around by hand to read the plan from top to bottom.

## 2. Goals / non-goals

Goals: one action that puts the rows in calendar order, and a switch that keeps them there.

Non-goals: sorting by anything but the start date (name, duration); changing any date, link
or group; a new synced field (the row order is the existing `orderKey`); a server or API change.

## 3. Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                                                  | Priority |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-189 | **Sort activities.** The **Timeline options** panel (gear, FR-156) has a **Sort activities** button. It is a one-time action: it puts the rows in order of their **start date**, earliest first. Activities that start on the same day keep their present order. A group's start is the start of its first activity (FR-175).                                                                  | Must     |
| FR-190 | **Parents and children.** The sort is done per level: first the **top-level** activities (groups count as one, by their start), then, separately, the children **inside every group**, at every depth. An activity never leaves its group and a group's children stay together under it.                                                                                                       | Must     |
| FR-191 | **Dependencies.** An activity never comes before one it starts after: when a link says A → B, A is placed above B even when their dates would put B first (for example a link that is still broken, FR-139). A link to or from a group counts for the group as a whole, and a link between activities in different groups orders those groups' ancestors that are siblings (FR-183, decision P24). | Must     |
| FR-192 | **Sort changes only the order of rows.** No start, duration, link, group or done state changes. Nothing happens (and no undo point is made) when the rows are already in order. It is one **Undo last change** step (FR-147).                                                                                                                                                                | Must     |
| FR-193 | **Auto sort.** Next to the button, an **Auto sort** switch. While it is on, the rows are sorted after **every change the user makes** on the plan page (a new activity, dates moved or resized by drag or keys, links, grouping, deletion, Undo of these), as part of the same undo step. Turning it on sorts at once.                                                                       | Must     |
| FR-194 | **Auto sort is a device setting per device** (like the name mode and the scale, decision P6), off by default and remembered across reloads. It applies to every plan on that device.                                                                                                                                                                                                         | Must     |

## 4. Decisions

| ID  | Decision                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Order = existing `orderKey`.** Sorting writes new order keys only for the rows that have to move, so no data-model, sync or migration change and older apps just see a new order.                                                                                                                                                                                         |
| S2  | **Ties and dependencies go by a stable topological order**: among the activities whose predecessors are placed, the one with the earliest start (then the earliest present row) comes next. A loop between groups (possible only through leaf links) is broken at the earliest start rather than refused.                                                                |
| S3  | **Auto sort is a device setting, not synced**, so a phone can keep the order it has while a computer sorts. Where an automatic sort follows a user's change it joins that change's undo step; Undo itself does not sort again, so Undo always restores exactly what was there.                                                                                            |
| S4  | **Where the switch lives:** in the options panel with the button (the request said "plan view options"), not in the always-visible toolbar, which stays calm (UI guideline 4).                                                                                                                                                                                             |

## 5. Acceptance (tested)

1. With rows C (day 5), A (day 1), B (day 3), **Sort activities** shows A, B, C; the dates are unchanged; Undo last change brings back C, A, B.
2. B depends on A but starts earlier: after the sort A is above B.
3. Top-level groups sort by their first activity; children are sorted inside their group and stay in it.
4. Sorting an ordered plan changes nothing and leaves Undo as it was.
5. With **Auto sort** on, moving an activity later (or adding one) reorders the rows by itself; Undo takes both back in one step; off, nothing reorders.
6. The switch survives a reload and is off by default.
