# ToDoness Calendar – Product Requirements Document (PRD)

|                  |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Status**       | v1.0 – built (see [ImplementationPlan.md](./ImplementationPlan.md))              |
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
- **C5** **Reminders and repeating events are deferred** to a follow-up: they need the server
  reminder sweeper and an expansion rule for repeats, and would double the size of this change.
  The data model leaves room (new optional fields need only a flag like `activities=…`).
- **C6** No default calendar is auto-created (two devices would each create one). The empty
  state asks for the first calendar.
