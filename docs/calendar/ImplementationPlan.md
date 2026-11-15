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
