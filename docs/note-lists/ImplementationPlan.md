# Note lists and settings – implementation steps

Order per [`IMPLEMENTATION_WORKFLOW.md`](../../IMPLEMENTATION_WORKFLOW.md): PRD → these
steps → tests → implementation.

## 1. Shared (`shared/`)

- `schemas.ts`: `ListModule = 'tasks' | 'notes'`; `list.module` (create-only, optional in the
  create patch, default `'tasks'`); `note.listId: uuid | null` (create + update patches).
  Pulled list patches may carry `module`.
- `merge.ts`: defaults `module: 'tasks'` (list) and `listId: null` (note).
- Tests: `shared/test/schemas.test.ts`, `shared/test/notes.test.ts`.

## 2. Server (`server/`)

- Migration `007_note_lists.sql`: `lists.module` (CHECK tasks/notes), the one-Inbox index
  becomes one per user **and module**, `notes.list_id`.
- `sync/rows.ts`: read/write `module` and `list_id`.
- `auth/users.ts`: `ensureNotesList()` (idempotent); called at sign-up and before every pull.
- `sync/apply-ops.ts`: a list's `module` cannot change; the Inbox of tasks keeps its name, the
  default note list may be renamed but not deleted; a task's list must be a task list, a
  note's list a note list of the same user.
- `routes/sync.ts`: legacy pull (no `lists=modules`) drops note-list changes and `listId`.
- `routes/public.ts`: public lists are task lists only.
- Tests: `server/test/note-lists.test.ts`, `server/test/migrate.test.ts`.

## 3. Client (`client/`)

- `data/db.ts`: Dexie version 6 – `module: 'tasks'` on lists, `listId: null` on notes.
- `data/queries.ts`: `getLists` = task lists, `getNoteLists`, `getNotes(db, listId)`,
  `countOpenTodos`, `countNotesByList`.
- `data/repo.ts`: `createList(name, module)`, `createNote(text, listId)`; renaming the notes
  default list is allowed; reorder within the same module; deleting a note list deletes its
  notes; recovery keeps `module` / `listId`.
- `sync/engine.ts`: pull with `lists=modules`.
- `lib/notifyPref.ts` + `app/container.ts`: device switch for local notifications.
- Components: `common/InfoTip.tsx`, `common/SettingRow.tsx`; `Settings.tsx`,
  `NtfySettings.tsx` rewritten to rows; `Sidebar.tsx` (counts, note lists, manage);
  `ManageLists.tsx` takes a module; `NotesPage.tsx` takes a list; routes `/notes/l/:id`,
  `/notes/manage`; `lib/modules.ts` unchanged (`/notes/...` already belongs to Notes).
- `styles.css`: `.info-tip`, `.setting-row`, `.app-bar`, `.icon-btn`, `.manage-row.locked`.
- Tests: repo, queries, notify preference, components (Settings, InfoTip), e2e.

## 4. Docs

- `UI_GUIDELINES.md`: info button rule, round icon back button.
- `docs/v1/Decisions.md`: pointer to this PRD.
