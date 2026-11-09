# ToDoness Notes – Implementation plan

> Requirements: [PRD.md](./PRD.md). Earlier plans: [`../v1/ImplementationPlan.md`](../v1/ImplementationPlan.md),
> [`../mvp/MVPImplementationSteps.md`](../mvp/MVPImplementationSteps.md).

## Working method (test first)

As in v1, every step is: **test** (written first, run, seen to fail for the right reason),
**implement** (smallest code that passes), **check** (whole suite, `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`).

Status legend: ☐ not started · ◐ in progress · ☑ done

| Step | Content | Status |
|------|---------|--------|
| 1 | Shared: `note` entity (schema, patches, sync operations, pull changes, merge defaults) | ☐ |
| 2 | Server: migration 004, note rows, push / pull of notes, public notes API | ☐ |
| 3 | Client data: Dexie version 3, repo note operations, queries, pulled changes, `clearAll` | ☐ |
| 4 | Recovery: notes in the snapshot, restore (append / overwrite), offer counts | ☐ |
| 5 | Public notes, client: read service and online editor | ☐ |
| 6 | Modules: registry, module of an address, last module on the device, start address | ☐ |
| 7 | UI: module switch, sidebar per module, *My notes*, *Public notes*, texts, styles | ☐ |
| 8 | Integration and browser tests, README and docs | ☐ |

---

## Design

### Data model

```text
Note = { id, text, orderKey, isPublic, fieldHlc, createdAt, updatedAt, deletedAt }
```

- `text`: 0 – 20 000 characters (`NOTE_TEXT_MAX`). Creating requires `orderKey`; `text`
  defaults to `''` in the merge (the UI only creates notes with text, PRD N7).
- Same row bookkeeping as tasks and lists: per-field HLC (`fieldHlc`), soft delete
  (`deletedAt`), `create` of an existing row merges like an update.
- Sync operations: `entity: 'note'` with `create | update | delete | restore`; the patch
  schemas are strict, like the others (only `text`, `orderKey`, `isPublic`).

**Server** – migration `004_notes.sql`:

```sql
CREATE TABLE notes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '' CHECK (length(text) <= 20000),
    is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
    order_key TEXT NOT NULL COLLATE BINARY, field_hlc TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
```

`change_log.entity` had `CHECK (entity IN ('todo', 'list'))`. SQLite cannot change a CHECK,
so the migration rebuilds `change_log` (new table, copy every row **with its `server_seq`**,
drop, rename, re-create the index). `AUTOINCREMENT` continues after the highest copied value,
so client cursors stay valid. Covered by a migration test on a filled version-3 database.

**Client** – Dexie version 3 adds `notes: 'id, orderKey'`. `clearAll` clears it too.

### Push and pull

`applyPush` gets `applyNote` (owner check, merge, save, change log). The pull already sends
whatever is in `change_log`; only the response schema learns `note`. The client's
`applyChanges` picks the table by entity (`todo`, `list`, `note`).

### Public notes

- `GET /api/public/notes` → `{ notes: [{ id, text, ownerEmail, updatedAt }] }`, public live
  notes of **other** users, newest change first.
- `POST /api/public/notes/:id/push` → the normal push body, run through `applyPush` with the
  owner as row owner and the scope `{ actorId, onlyNoteId }`: only `update` operations on that
  note whose patch is `{ text }` are accepted; anything else is `forbidden` (delete, restore,
  public flag, order, other entities, other notes). 404 when the note is not public (any more).
- Client: `services/publicNotes.ts` (`fetchPublicNotes`, `createPublicNoteEditor().saveText`),
  same error mapping as the public list editor.

### Modules and navigation

`client/src/lib/modules.ts` (pure, unit tested):

```ts
MODULES = [
  { id: 'tasks', home: '/',      owns: (path) => path === '/' || /^\/(l|public)(\/|$)/.test(path) },
  { id: 'notes', home: '/notes', owns: (path) => /^\/notes(\/|$)/.test(path) },
]
moduleOfPath(path): ModuleId | undefined       // settings, admin → undefined
readLastModule(storage) / saveLastModule(storage, id)   // localStorage key 'todoness.module'
```

- `Shell` watches the address: when it belongs to a module, that module is saved as the last
  one; when it does not (Settings, Admin), the sidebar keeps the last module.
- `Home` (`/`): last module `notes` → redirect to `/notes`, otherwise to the Inbox (as before).
  The Tasks entry of the switch links to `/` for the same reason; `/` itself counts as Tasks.
- `ModuleSwitch` renders the registry as links; it is placed in the sidebar (computer) and in
  the top bar (phone, CSS decides which one is shown, both are the same component).
- The sidebar body is chosen by module: `TasksNav` (the old content) or `NotesNav`.

### Pages

- `NotesPage` (`/notes`): add form (textarea, Add note, Ctrl/⌘ + Enter), then one `NoteCard`
  per live note (newest first, live query). `NoteCard` holds the text locally while focused,
  saves 1 s after the last key and on blur (and on `pagehide`), takes the stored text when not
  focused; Public toggle; Delete with Undo toast.
- `PublicNotesPage` (`/notes/public`): polls every 5 s; one card per note with the owner's
  e-mail; editing as above through the public editor; read-only while offline; errors shown
  on the card.

---

## Step 1 – Shared

**Tests first** (`shared/test`): note create / update / delete / restore operations parse;
unknown fields, too long text, `isInbox`, `userId` refused; pulled note changes parse; merge
creates a note with defaults, needs `orderKey`, last write wins per field, delete beats an
older edit, applying twice changes nothing.

## Step 2 – Server

**Tests first** (`server/test`): migration from version 3 keeps `change_log` rows and
`server_seq`, accepts `note` afterwards, sequence continues; push create / update / delete /
restore of a note, pull returns it to another device; another user's note id is refused
(`not_found`); public notes list (only other users', only public live ones, newest first, with
e-mail); public push: text edit accepted and appears in the owner's pull; delete, restore,
`isPublic`, `orderKey`, create, list / todo operations and other note ids refused; private or
deleted note → 404; not logged in → 401; deleting a user deletes their notes.

## Step 3 – Client data

**Tests first** (`client/test/data`): `createNote` puts it on top and queues a valid
operation; `updateNoteText` (also empty), `setNotePublic`, `deleteNote` / `restoreNote`
(idempotent); deleted notes are not listed; not found errors; Dexie upgrade from version 2
keeps tasks and lists and adds an empty `notes` table; pulled note changes are applied and
merged with a newer local edit; `clearAll` removes notes; offline → online sends note
operations (sync test).

## Step 4 – Recovery

**Tests first**: `takeSnapshot` includes live notes, skips deleted ones, offers a device that
only has notes; `restoreSnapshot` append adds notes with ids and fields; overwrite deletes the
account's notes first; restoring twice merges; an old snapshot without `notes` still
restores; the offer counts notes (`notes`, `accountNotes`); the popup text names notes.

## Step 5 – Public notes, client

**Tests first** (`client/test/services`): the list is parsed, `undefined` offline;
`saveText` sends one `update` with `{ text }` to `/api/public/notes/:id/push`; 404 → `gone`,
401 → `auth`, refused → `rejected`, network → `offline`; listeners are told after success.

## Step 6 – Modules

**Tests first** (`client/test/lib/modules.test.ts`): `moduleOfPath` for `/`, `/l/x`,
`/l/x/t/y`, `/public/x`, `/notes`, `/notes/public`, `/settings`, `/admin`, `/notesx`;
`readLastModule` defaults to `tasks`, ignores unknown values and a throwing storage;
`saveLastModule` writes and swallows storage errors; `homeOf`.

## Step 7 – UI

Covered by the browser tests of step 8 (the components are thin over the tested pieces).

## Step 8 – Integration, browser tests, docs

**Integration** (real server in memory): two browsers of one user, notes written offline on
one appear on the other after reconnecting, concurrent edits merge per field; user B edits A's
public note, A's devices pull it; recovery with notes (append and overwrite).

**Browser (e2e)**: the switch is visible on a computer and on a phone; the app reopens in
Notes after a reload; add, edit (saved after a pause, survives reload), delete with Undo;
public note edited by another user and seen by the owner; offline note sync.

**Docs**: README (features, docs table, structure), this plan, PRD.

---

## Implementation notes

(Filled in while building; see the end of the file.)
