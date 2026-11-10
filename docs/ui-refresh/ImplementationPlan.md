# UI refresh – implementation steps

Order per [`IMPLEMENTATION_WORKFLOW.md`](../../IMPLEMENTATION_WORKFLOW.md): PRD → these
steps → tests → implementation.

## 1. Shared (`shared/`)

- `schemas.ts`: `remindBefore` becomes `RemindBefore[]`. Input accepts `null`, a single
  value or a list; it is normalised to a unique list in the fixed order week, day, hour.
  Export `normalizeRemindBefore()`.
- `merge.ts`: default `remindBefore: []`.
- `reminders.ts`: `REMIND_ORDER`; `reminderKey` takes one choice (same key format as v1,
  so reminders already fired are not fired again); `latestDueChoice(todo, now)` implements
  FR-114.
- Tests: `shared/test/schemas.test.ts`, `shared/test/reminders.test.ts`.

## 2. Server (`server/`)

- Migration `006_multi_reminders.sql`: new column `reminders TEXT NOT NULL DEFAULT ''`
  (comma list), filled from `remind_before`; the old column (with its CHECK) is left unused.
- `sync/rows.ts`: read / write `reminders`.
- `push/reminders.ts`: one candidate per task and choice, keep only the smallest offset
  whose time has passed (FR-114), then the existing "already sent" check per choice.
- Tests: `server/test/push.test.ts`, `server/test/migrate.test.ts`, sync round trip.

## 3. Client (`client/`)

- `data/db.ts`: Dexie version bump converting stored `remindBefore` to a list.
- `services/reminders.ts`: `dueReminders` uses `latestDueChoice`.
- `TaskDetail.tsx`: chip group (`aria-pressed`) instead of the select; asking for
  notification permission when the first chip is turned on.
- `Sidebar.tsx`, `ManageLists.tsx`, `styles.css`: `.btn`, `.btn-block`, `.btn-back`; the
  intro paragraph removed (drag instructions remain for screen readers via dnd-kit).
- Tests: `client/test/services/reminders.test.ts`, repo tests, e2e (`e2e/test/v1.test.ts`).

## 4. Docs

- `docs/v1/Decisions.md`: D2 superseded by FR-112.
