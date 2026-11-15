# ToDoness Calendar – Product Requirements Document (PRD)

|                  |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Status**       | v1.0 – built; **Update 1** (section 6, repeats and reminders) – built (see [ImplementationPlan.md](./ImplementationPlan.md))              |
| **Builds on**    | Plan ([`../plan/PRD.md`](../plan/PRD.md)), Notes, v1 and the MVP                        |
| **Related docs** | [ImplementationPlan.md](./ImplementationPlan.md), [mockups.html](./mockups.html)        |

> Everything in the earlier PRDs still applies unless this document says otherwise.
> Requirement numbers continue where Notes details stopped (FR-201 and up).
> **[Answered]** = the product owner chose it from the mockups; **[Decision]** = taken here
> where the request left room (section 5).

## 1. Summary

ToDoness gets a fourth **module**, **Calendar**, next to Tasks, Notes and Plan:

1. There can be **several calendars** (Personal, Work…). Each has a name and a **colour**, and
   is created, renamed, reordered and deleted the way plans are.
2. A calendar holds **events**: a title, a day, optionally a start and end time (otherwise
   the event is _all day_), a number of days for an all-day event, and an optional place.
3. Events are shown in three **views**: **Month**, **Week** and **Agenda** (a list of what is
   coming). Previous / next / Today move through time.
4. **Tasks with a due date** appear read-only on their day (a switch hides them); a tap opens
   the task.
5. Calendars can be **shown or hidden** per device.
6. **Four modules need a new module picker [Answered]:** a bottom tab bar on a phone and a
   vertical list in the sidebar on a computer (mockups, option B).

Calendars and events are ordinary synced data: offline-first, on all devices of the user.

## 2. Goals and non-goals

**Goals** – see what happens on a day / week / month at a glance; add an event in a few
taps; keep several calendars apart by colour; see tasks that are due next to events; a
module picker that scales beyond four modules.

**Non-goals (this version)** – repeating events, reminders / notifications for events,
a Day view, dragging events to another day, time zones (all times are the device's local
time), sharing or public calendars, import / export (iCal), showing Plan activities,
events that span several days **with** times (a timed event is within one day).

## 3. Requirements

### Module picker

- **FR-201** The module picker lists every module with its **icon and full name**: a
  **bottom tab bar** on a phone (≤ 760 px, targets ≥ 44 px, safe-area aware) and a
  **vertical list at the top of the sidebar** on a computer. It is a labelled group of links
  (`aria-label` "Modules"); the current module has `aria-current`. The top bar on a phone
  shows only the menu button and the app name.
- **FR-202** `MODULES` gains `calendar`: home `/calendar`, owns `/calendar…`. "Open where I
  left" (FR-86) works for it.

### Calendars

- **FR-203** A calendar has a **name** (1 – 200 characters), a **colour** (one of blue, green,
  amber, red, purple, teal; default blue) and an order. A new calendar goes last.
- **FR-204** The sidebar of the module lists the calendars (colour dot, name, shown / hidden
  toggle with `aria-pressed`), a "Manage calendars" button and a "New calendar" field. On
  a phone the same list is in the menu (☰).
- **FR-205** `/calendar/manage` renames, recolours, reorders and deletes calendars (over
  `ManageItems`). Deleting a calendar deletes its events (undoable like other deletes).
- **FR-206** With no calendar yet, the module shows an empty state with a field to create the
  first calendar.

### Events

- **FR-207** An event has a **title** (1 – 200), a **day**, an optional **start time** and
  **end time** (`HH:MM`), a number of **days** (1 – 366, all-day events only) and a **place**
  (≤ 200). No start time = all day. An end time earlier than or equal to the start time is
  ignored (the event is shown as 1 hour).
- **FR-208** "New event" opens `/calendar/new` (the selected day pre-filled), with native
  date and time inputs (UI guidelines), a switch **All day**, a calendar choice (chips when ≤ 6
  calendars, a select above), Save and Cancel. `/calendar/e/:id` edits and deletes an event
  (with Undo toast).
- **FR-209** Events of hidden calendars are not shown. Events of a deleted calendar are not
  shown.

### Views

- **FR-210** **Month**: a grid of weeks (Monday first), today marked, days outside the month
  dimmed, at most 3 events per day then "+n more". On a phone: a compact month with dots and
  the events of the selected day below it.
- **FR-211** **Week**: seven columns, an all-day row, an hour grid 00:00 – 24:00 that scrolls
  to 07:00, a "now" line in the current week. On a phone the week shows as the agenda.
- **FR-212** **Agenda**: the days with something on them from the chosen day on (default
  today), with date headings; days without events are left out except today. All-day events
  first, then by start time.
- **FR-213** A toolbar: previous / next, **Today**, a title for the period, view chips
  (Month, Week, Agenda; `aria-pressed`), **New event**. The chosen view is a device setting;
  the default is Agenda on a phone and Month on a computer.
- **FR-214** Tapping a day (month) opens it in Agenda; tapping an event opens it.

### Tasks on the calendar

- **FR-215** An open task (not done, not deleted, in a live task list) with a due date is shown
  on that day (device local time), read-only, drawn dashed, with the list name. Tapping opens
  the task. A switch **Show tasks** (device setting, default on) hides them.

### Data, sync, compatibility

- **FR-216** `calendar` and `event` are synced entities with soft delete, per-field clocks and
  the same merge rules as the others; restored in recovery snapshots.
- **FR-217** Apps from before this change do not get calendars or events in a pull (`calendar=1`
  flag) and reset their pull cursor when they update, exactly like Plan (FR-143).
- **FR-218** Restricted public pushes refuse both entities.

## 4. Acceptance

Every requirement has a unit test (shared / server / client / integration) or a browser (e2e)
test, written before the code (see the plan).

## 5. Decisions

- **C1** Several small, strongly-typed fields instead of one date-time: `day` (`YYYY-MM-DD`),
  `startTime` / `endTime` (`HH:MM` or `null`). A merge of two devices can never produce an
  invalid instant; the same reasoning as decision P1.
- **C2** A timed event is one day; a multi-day event is all-day. Keeps every view simple.
- **C3** Colour is a fixed palette of names mapped to CSS variables (light and dark) — never a
  free hex value (UI guidelines: colours only from variables).
- **C4** Hidden calendars, the view and "Show tasks" are **device settings** (`localStorage`),
  like the Plan options.
- **C5** Reminders and repeating events were deferred from v1.0; **Update 1 (section 6) adds them.**
- **C6** No default calendar is auto-created (two devices would each create one). The empty
  state asks for the first calendar.

## 6. Update 1 – repeating events and reminders

Requirement numbers continue (FR-219 and up). Section 2 non-goals "repeating events" and
"reminders" no longer apply; the rest of that list does.

### Repeating events

- **FR-219** An event can **repeat**: never (default), daily, weekly (same weekday), monthly
  (same day of the month) or yearly (same date), every time (no interval).
- **FR-220** A repeating event may have an **end day** ("Repeat until", the last day an
  occurrence can start); without one it repeats forever.
- **FR-221** Every view shows **every occurrence** in its range (a repeating event that began
  years ago appears in this month). Opening any occurrence opens the one event.
- **FR-222** The event form has a **Repeats** chip group (Never, Daily, Weekly, Monthly,
  Yearly) and, when repeating, a **Repeat until** date field that can be cleared.
- **FR-223** Changing or deleting a repeating event changes or deletes **the whole series**
  (decision C9); to stop it, set "Repeat until".

### Reminders

- **FR-224** An event can have several **reminders**, chosen as chips (multi-select, none by
  default): **At start**, **10 minutes before**, **1 hour before**, **1 day before**.
- **FR-225** A reminder is shown on the device that has the app open, like a task reminder
  (in-app message plus system notification, FR-45 – FR-47), **once per occurrence and choice**,
  and **a pushed reminder** reaches every device of the user, and the user's ntfy topic, even
  when the app is closed (FR-60 – FR-66). The same reminder shown by the app and pushed by the
  server is one notification (same tag).
- **FR-226** Of the chosen reminders of one occurrence only the **latest one that has passed**
  counts, so no burst (as FR-114). A reminder can still fire until **10 minutes after the
  start** of the occurrence; later it is skipped (decision C10).
- **FR-227** An all-day event is reminded relative to **09:00** on the first day of the
  occurrence (decision C7): "At start" = 09:00 that day, "1 day before" = 09:00 the day before.
- **FR-228** The notification opens the event (`/calendar/e/<id>`). Its text: the title, and
  when it starts ("Starts in 1 hour (14:00)" / "Today" for all-day).
- **FR-229** Reminders of deleted events, events of deleted calendars and (on the device) when
  notifications are switched off on that device follow the task rules (FR-120).

### Data and compatibility

- **FR-230** An event also carries **`tz`**, the time zone of the device that saved it
  (decision C8), because the server has to turn "14:00 on 18 Nov" into a moment in time.
- **FR-231** New event fields (`repeat`, `repeatUntil`, `reminders`, `tz`) are synced and
  restored in recovery snapshots (the snapshot comparison counts them). Apps without them do
  not get them in a pull (flag `events=repeat`); they reset their pull cursor when updated.

### Decisions

- **C7** Reminder choices are fixed: `start`, `10min`, `hour`, `day`. An all-day event counts
  as starting at 09:00 local time.
- **C8** `tz` is an IANA name set from the device at every save of an event; an empty `tz`
  (events from before this update) counts as UTC and has no reminders anyway.
- **C9** No exceptions inside a series (move or delete one occurrence): non-goal for now.
- **C10** A reminder is valid until 10 minutes after the start; the sweep runs every 30 s.
- **C11** Short months: a monthly event on the 31st uses the last day of shorter months; a
  yearly one on 29 February uses 28 February in other years.
- **C12** Occurrences are calculated when shown (nothing is stored per occurrence); the
  server calculates them for the sweep from `repeat`, `repeatUntil`, `start` and `tz`.
