# ToDoness Calendar – Implementation plan

> Requirements: [PRD.md](./PRD.md). Pattern followed: [`../plan/ImplementationPlan.md`](../plan/ImplementationPlan.md).

Status legend: ☐ not started · ◐ in progress · ☑ done

| Step | Content                                                                                           | Status |
| ---- | ------------------------------------------------------------------------------------------------- | ------ |
| 1    | Shared: `calendar` and `event` entities (schemas, ops, merge defaults), `shared/src/calendar.ts` | ☑      |
| 2    | Server: migration 011, rows, push / pull (`calendar=1`), public push refuses                      | ☑      |
| 3    | Client data: Dexie version 10, repo operations, queries, pulled changes, recovery                 | ☑      |
| 4    | Client lib: `calendarGrid.ts` (month / week / agenda layout), `calendarSettings.ts`, `modules.ts` | ☑      |
| 5    | UI: module picker (tab bar / rail), calendar page and views, event page, manage, sidebar, texts   | ☑      |
| 6    | Tests first for each step above; e2e; CODEBASE_MAP, README, Decisions                             | ☑      |

## Design

### Data model

```text
Calendar = { id, name, color, orderKey, fieldHlc, createdAt, updatedAt, deletedAt }
Event    = { id, calendarId, title, start, days, startTime, endTime, place, fieldHlc, ... }
```

- `color`: `'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'` (default `blue`).
- `start`: `YYYY-MM-DD` (`isDay`). `days` 1 – 366 (default 1). `startTime` / `endTime`:
  `HH:MM` 24 h or `null` (default `null`). `place`: ≤ 200 chars (default `''`).
- Ops: `entity: 'calendar' | 'event'` with `create | update | delete | restore`, strict patch
  schemas. Create requires: calendar `name, orderKey`; event `calendarId, title, start`.
- `shared/src/calendar.ts` (pure): `isTime`, `timeMinutes`, `eventSpan(e)` (normalised
  `{ day, endDay, from, to }`: timed → one day, bad end → +60 min), `eventsOnDay(events, day)`,
  `compareEvents` (all-day first, then start time, then title), `dueDay(dueAt)` helper stays on
  the client (needs the local zone).

### Server

Migration `011_calendar.sql`: tables `calendars`, `events` (same shape as `plans` /
`activities`), `change_log` rebuilt (CHECK learns `'calendar','event'`, same method as 008).
`rows.ts`: `getCalendar/saveCalendar/calendarOwner`, `getEvent/saveEvent`. `apply-ops.ts`:
`applyCalendar`, `applyEvent` (the `calendarId` must be the user's, else `calendar_not_found`).
`routes/sync.ts`: calendar / event changes only with `calendar=1`.

### Client data

Dexie v10: `calendars: 'id, orderKey'`, `events: 'id, calendarId, start'`; the upgrade resets the
pull cursor. `repo`: `createCalendar / renameCalendar / recolorCalendar / reorderCalendar /
deleteCalendar` (events first), `createEvent(input) / updateEvent(id, patch) / deleteEvent /
restoreEvent`. `queries`: `getCalendars`, `getEvents(from, to)` (by `start` range, including
events that began earlier and run into the range), `getDueTasks(fromMs, toMs)`.
Recovery: snapshot `calendars?` and `events?`, restored like plans.

### UI

- `lib/modules.ts` + `ModuleSwitch.tsx`: one component, rendered twice by CSS: a vertical
  `.module-rail` in the sidebar, a bottom `.tabbar` on a phone (top bar loses the switch).
- `components/calendar/`: `CalendarPage` (toolbar + views), `MonthView`, `WeekView`,
  `AgendaView`, `EventPage` (new / edit), `ManageCalendars`, `CalendarNav` (in `Sidebar.tsx`).
- Routes (`Shell.tsx`, specific first): `/calendar/e/:id`, `/calendar/new`, `/calendar/manage`,
  `/calendar`.
- Device settings: `lib/calendarSettings.ts` (view, hidden calendars, show tasks).

### Compatibility

New entities are invisible to older apps (`calendar=1` flag; they reset the cursor on update).

## Changed on the way

- The module picker keeps the class `module-switch` on both looks (`module-rail`, `tabbar`) so
  older selectors in the browser tests still find it; two tests that expected the switch in the
  phone top bar now expect the bottom bar.
- Recovery counts returned by `restoreSnapshot` gained `calendars` (existing tests updated).
- Reminders and repeating events stay out (decision C5).
- Audit of cross-module features: the recovery offer and dialog now count calendars (`calendars`, `accountCalendars`, "calendar" in the texts), an account holding only calendars is no longer treated as empty; tests also cover the Dexie upgrade, `clearAll`, user deletion cascade and recovery end to end.

## Update 1 – repeats and reminders

| Step | Content                                                                                                   | Status |
| ---- | --------------------------------------------------------------------------------------------------------- | ------ |
| 7    | Shared: fields `repeat`, `repeatUntil`, `reminders`, `tz`; `occurrenceDays`, `zonedMs`, reminder rules      | ☑      |
| 8    | Server: migration 012 (columns, `sent_event_reminders`), rows, pull flag `events=repeat`, event sweep       | ☑      |
| 9    | Client data: Dexie v11, repo (`tz` set on save, checks), `getEventsInRange` with series, recovery           | ☑      |
| 10   | Client: occurrences in the views, event form (Repeats, Repeat until, Reminders), event reminders scheduler  | ☑      |
| 11   | Tests first for each step; e2e; CODEBASE_MAP                                                                | ☑      |

### Design

- `shared/src/calendar.ts` gains (pure, tested): `REPEATS`, `EVENT_REMINDS` (earliest first:
  `day, hour, 10min, start`), `EVENT_REMIND_MS`, `isTimeZone`, `zonedMs(day, 'HH:MM', tz)` (local
  time → epoch ms, DST-correct, two-pass offset), `eventStartMs(e, occurrenceDay)` (all-day →
  09:00), `occurrenceDays(e, from, to)` (start days of occurrences touching the range, clamping
  rule C11, `repeatUntil` honoured, arithmetic jump to the first candidate so an old daily event
  costs nothing), `latestDueEventReminder(startMs, chosen, now)` (FR-226),
  `eventReminderKey(id, day, choice)` (the tag).
- Schema: `repeat` enum (default `none`), `repeatUntil` day | null, `reminders` list (unique, in
  `EVENT_REMINDS` order, ≤ 4), `tz` (≤ 64, `''` or a valid IANA zone). Create patch: all optional.
- Server: migration `012_event_repeat_remind.sql` adds `repeat`, `repeat_until`, `reminders`
  (comma list), `tz` to `events` and the table `sent_event_reminders (event_id, occurrence,
  remind, sent_at)` with `ON DELETE CASCADE`. `routes/sync.ts`: `events=repeat` flag strips the four
  fields from event patches for older apps. `push/reminders.ts`: `sweepReminders` also sweeps
  events (`push/eventReminders.ts`): candidate events (live, own live calendar, reminders ≠ '',
  not ended), occurrences in `[now − 1 day, now + 2 days]`, the latest passed choice per
  occurrence, "already sent" row, same delivery code as tasks (web push + ntfy, record first,
  unrecord on total failure). Payload: title, body, tag = `eventReminderKey`, url `/calendar/e/<id>`.
- Client: Dexie v11 (`events` unchanged, cursor reset; defaults for the new fields). `repo`:
  `createEvent` / `updateEvent` accept `repeat`, `repeatUntil`, `reminders`; `tz` comes from
  `Intl.DateTimeFormat().resolvedOptions().timeZone` whenever the start, time, repeat or reminders
  are written; `repeatUntil` is dropped for a non-repeating event and refused before the start.
  `getEventsInRange` returns events that start on or before `to` and have an occurrence touching
  the range; `items.ts` expands them with `occurrenceDays`. `services/reminders.ts`:
  `dueEventReminders` and a second callback `notifyEvent` of the scheduler, same `notified` table.
- UI: `EventPage` gets the chip groups and the date field; strings in `t.calendar`.

### Changed on the way

- `eventReminderBody` lives in `shared/src/reminders.ts` (not `calendar.ts`): `calendar.ts` is
  imported by `schemas.ts`, and importing `reminders.ts` from it made an import cycle.
- The "already sent" table also has `start_ms` in its key, so a moved event is reminded again
  (like a task with a new due date); the client's `notified` key has the start moment too.
- The server and the app share one sweep path for tasks and events (`push/reminders.ts`
  builds a list of jobs; `push/eventReminders.ts` finds the due event occurrences).
