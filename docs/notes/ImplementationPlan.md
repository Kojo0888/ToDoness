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
| 1 | Shared: `note` entity (schema, patches, sync operations, pull changes, merge defaults) | ☑ |
| 2 | Server: migration 004, note rows, push / pull of notes, public notes API | ☑ |
| 3 | Client data: Dexie version 3, repo note operations, queries, pulled changes, `clearAll` | ☑ |
| 4 | Recovery: notes in the snapshot, restore (append / overwrite), offer counts | ☑ |
| 5 | Public notes, client: read service and online editor | ☑ |
| 6 | Modules: registry, module of an address, last module on the device, start address | ☑ |
| 7 | UI: module switch, sidebar per module, *My notes*, *Public notes*, texts, styles | ☑ |
| 8 | Integration and browser tests, README and docs | ☑ |
| 9 | Update 2 – Reorder notes: `Repo.reorderNote`, drag & drop on the note grid | ☑ |
| 10 | Update 2 – Search notes: `matchesSearch`, search box on both note pages | ☑ |
| 11 | Update 2 – Public data offline, data layer: Dexie version 4 (`publicCache`, `publicOutbox`), queued public editor, overlay of pending changes | ☑ |
| 12 | Update 2 – Public data offline, sync: engine sends the public outbox, refusals to dead letter, pending count | ☑ |
| 13 | Update 2 – Public data offline, UI: pages read cache + overlay, edits enabled offline, refused-changes notice, background loading | ☑ |
| 14 | Update 2 – Integration and browser tests, docs | ☑ |

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
  { id: 'tasks', home: '/tasks', owns: (path) => /^\/(tasks|l|public)(\/|$)/.test(path) },
  { id: 'notes', home: '/notes', owns: (path) => /^\/notes(\/|$)/.test(path) },
]
moduleOfPath(path): ModuleId | undefined       // '/', settings, admin → undefined
readLastModule(storage) / saveLastModule(storage, id)   // localStorage key 'todoness.module'
```

- `Shell` watches the address: when it belongs to a module, that module is saved as the last
  one; when it does not (Settings, Admin), the sidebar keeps the last module.
- `Start` (`/` and unknown addresses): redirects to the home of the last module. `/tasks` is
  the Tasks home and redirects to the Inbox (what `/` did before).
- The switch links to the page last shown in each module during this visit (kept in memory),
  or to the module's home.
- `ModuleSwitch` renders the registry as a labelled group of links; it is placed in the sidebar
  (computer) and in the top bar (phone); CSS decides which one is shown, both are the same
  component.
- The sidebar body is chosen by module: `TasksNav` (the old content) or `NotesNav`.

### Pages

- `NotesPage` (`/notes`): add form (textarea, Add note, Ctrl/⌘ + Enter), then one card per
  live note (newest first, live query): `NoteEditor`, changed time, Public toggle, Delete with
  Undo toast.
- `NoteEditor` (shared by both pages) holds the text locally, saves 1 s after the last key, on
  blur, on `pagehide` and when it goes away; it takes a new stored text only while the user is
  not focused in it, has nothing unsaved and no save in flight.
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

## Update 2: reorder, search, public data offline (PRD section 8)

### Design

**Reorder.** `Repo.reorderNote(id, beforeId)` uses the existing `keyForPosition` over the live
notes in order (one `orderKey` update; `same` = nothing). The note grid is a `SortableContext`
(rect strategy) inside the existing `DragAndDrop` context; drag data gets a `kind`
(`'todo' | 'note'`) and `onDragEnd` calls `reorderNote` for notes. `resolveDrop` is reused
unchanged (it works on ids).

**Search.** `lib/search.ts`: `normalize` (lower case, accents removed with NFD) and
`matchesSearch(text, query)` (every word of the query occurs). Pure, unit tested.

**Public data offline.**

```text
Dexie version 4
  publicCache   key            { key: 'lists' | 'notes' | 'list:<id>', value, at }
                               value = the server's answer, or 'gone' for a list page
  publicOutbox  opId, hlc, targetId
                               SyncOp + { target: 'list' | 'note', targetId, attempts, createdAt }
```

- `services/publicData.ts`: `refreshLists()`, `refreshList(id)`, `refreshNotes()` fetch and
  write the cache (404 on a list → `'gone'`); `prefetchLists(maxAgeMs)` loads every public list
  whose copy is older than a minute.
- `PublicEditor` (lists) and `PublicNotes.saveText` keep their API but **queue** the operation
  in `publicOutbox` instead of sending it; result `{ ok: true }` or `invalid`.
- `data/publicOverlay.ts` (pure): `overlayListPage(page, ops)` and `overlayNotes(notes, ops)`
  apply pending operations, in clock order, to the cached copy (create adds, update merges the
  visible fields, delete hides, restore shows again).
- Engine: after the own outbox, `pushPublic()` takes the oldest queued operation, sends every
  queued operation of the same target (up to the batch size) to
  `/api/public/lists/:id/push` or `/api/public/notes/:id/push`; accepted → removed; refused →
  dead letter (with target); 404 → the target's whole queue to dead letter (`gone`); network /
  5xx / 401 behave as for the own outbox. `countPending` adds the public outbox.
- The runner is notified on every new public operation (Dexie hook), like the own outbox.
- `clearAll` clears both tables.
- Hooks `usePublicLists`, `usePublicList(id)`, `usePublicNotes()`: live query of cache +
  queue + dead letter for the target, polling refresh while online and after every sync.

### Step 9 – Reorder notes

**Tests first:** `reorderNote` to the top, into the middle, to the end; same place = no
operation; unknown → not found; deleted notes are skipped; equal keys from two devices; one
valid operation per move; browser: drag with the mouse and with the keyboard, order kept after
a reload.

### Step 10 – Search notes

**Tests first:** `matchesSearch`: empty query matches all; every word must occur; case and
accents ignored; extra spaces; browser: filters, count, Escape clears, no handles while
searching.

### Step 11 – Public offline data layer

**Tests first:** Dexie 3 → 4 upgrade keeps data; queued edits are valid operations with the
right target, nothing is sent; overlays (create on top / at key, update, delete, delete + restore,
note text, operations of other targets ignored, `'gone'` stays gone); refresh writes the cache
and `'gone'`; offline refresh keeps the old copy; `clearAll` empties both tables.

### Step 12 – Public offline sync

**Tests first** (engine with scripted fetch): sends own then public ops; groups by target and
uses the right URL; accepted removed; refused → dead letter with target; 404 → whole target to
dead letter; network error keeps the queue and counts an attempt; 401 → `auth`; pending count
includes public ops. Integration: Bob edits Ann's list and note offline, reconnects, Ann's devices
get it; an older offline edit loses to a newer one; a list made private meanwhile → dead letter.

### Step 13 – UI

Pages and sidebar read the hooks; inputs are no longer disabled offline (attachments are);
notices: "Offline copy from …", "N changes waiting", "N changes were not saved – Dismiss".

### Step 14 – Browser tests and docs

Browser: offline public list (reload offline, add / complete / rename, back online, owner sees
it), offline public note, refused change after the list became private; README, this plan.

## Implementation notes

- Built in the order of the steps, each with its tests written first and seen to fail
  (missing schema / module / function), then the code.
- **Migration 004** rebuilds `change_log` to widen its `entity` CHECK. The copy keeps every
  `server_seq`, and the `sqlite_sequence` value is carried over explicitly: without that,
  `AUTOINCREMENT` would restart after the highest *remaining* row and could hand out a number
  that was used by a row deleted before (a test covers exactly this).
- **Public push scope** became a union: `{ actorId, onlyListId }` (public list, unchanged) or
  `{ actorId, onlyNoteId }` (public note: only `update` of that note with a `text`-only
  patch). Everything else is `forbidden`, checked before the operation is marked processed.
- **`/` is no longer the Inbox.** It opens the last module. Remembering the module while `/`
  counted as Tasks would have saved "tasks" in the same render that redirects to Notes, so
  `/tasks` was added as the Tasks home and `/` belongs to no module. Links that meant "back
  to my tasks" now go to `/tasks`.
- **The switch is not a `nav` landmark.** The existing browser tests address the sidebar as
  *the* navigation (`getByRole('navigation')`, strict); a second landmark would be ambiguous
  for screen readers too. It is a labelled `group`.
- **The last module is read from storage during render** (no React state): the effect that saves
  it runs whenever a module page is shown, so Settings / Admin read the right value.
- **Recovery:** the snapshot type has `notes`, but copies kept before this update do not; every
  reader uses `notes ?? []` (tested with a snapshot without the field). The popup names notes
  only when there are some, so the old wording is unchanged for task-only data.
- **Found by the browser tests:** reloading the page in the same instant a note box is left
  can lose that last edit (the IndexedDB write is cut off by the unload). The test now waits
  for "2 changes pending", as a user would see. A save is also started on `pagehide`, but a
  browser may still cut it off; this is the same for any IndexedDB write at unload.
- **Not done / ideas for later:** titles and colours for notes; offline attachments; an icon
  rail / bottom bar once there are more than about four modules (only `ModuleSwitch` changes).
  (Reordering, search and offline editing of public data were added in update 2, below.)

### Notes on update 2 (reorder, search, public data offline)

- **Reorder** reuses everything from tasks: `keyForPosition` for the new key, the existing
  `DragAndDrop` context (drag data now has a `kind`), `resolveDrop` unchanged. The grid uses the
  rect sorting strategy; the browser test drives the keyboard on a phone width (one column),
  where the arrow keys mean up and down.
- **Search** is a pure function (`lib/search.ts`); while it is active the drag handles are
  disabled, because a position in a filtered view is ambiguous.
- **Public data offline:** no server change. `publicCache` holds the server's answers,
  `publicOutbox` the queued operations with their target. `PublicEditor` and
  `PublicNotes.saveText` keep their signatures but queue; their old "send at once" unit tests
  were rewritten to check the queued operations, the old public-notes service test was removed
  (reading moved to `publicData`, its cases are in the new cache tests). `services/publicApi.ts`
  is gone (replaced by `publicData`).
- The engine sends the public queue after the own outbox, one target at a time (oldest change
  first, then everything else queued for that target). A 404 sends the target's whole queue to
  the dead letter as `gone`; other refusals keep their reason. The dead-letter rows keep
  `target` / `targetId`, which is how the pages find "N of your changes were not saved".
- Pages show `overlayListPage(copy, queue)` / `overlayNotes(copy, queue)`, refresh every 5 s and
  after each sync; the sidebar loads each public list in the background about once a minute so
  it can be opened offline later.
- Three v1 integration tests assumed an immediate send (`editor.updateTodo` answering `gone`);
  they now call `sync()` after editing and check the dead letter.
- **Found by the browser tests:** a test race, not an app bug: right after a click, "All
  changes saved" can still be on screen from before, so `waitSaved` passed before the owner's
  "private" change was sent, and the visitor's queued edit was (correctly) accepted. The test
  now waits until the owner's outbox is empty.
- One run of the full browser suite had a single timeout in the recovery "Overwrite" scenario;
  it passed in four later runs (alone and in the full suite). Noted here in case it returns.

**Test counts after update 2:** shared 105, server 244, client 363, integration 48, browser
(e2e) 62 (13 MVP + 32 v1 + 5 recovery + 12 notes scenarios).

### Review fixes (PR #11)

Each fix has a test that was seen to fail first.

- **No flash of the old text after a public edit is sent.** The engine now writes the accepted
  values into the kept copy (`publicCache`) in the same transaction that removes them from the
  queue, and raises the copy's `rev`. A refresh only stores its answer if `rev` did not change
  while its request was under way, so an answer sent before the push cannot write the old text
  back.
- **Queued public changes are not lost silently at sign-up.** They are never part of the
  recovery copy (they belong to other accounts), so signing up again now asks for
  confirmation when any are queued, even when a copy is kept.
- **A text that arrives during a save is shown afterwards.** The note box logic moved into
  `components/notes/noteTextSync.ts` (plain code, unit tested with fake timers). A stored text
  that arrives while the user is busy (focused, unsaved, or saving) is shown once they are not;
  typing after it replaces it (latest edit wins). Finishing a save does not re-show the stored
  text by itself, because before the database echoes the save it is still the old text (that
  would be exactly the flash the first fix removes).
- **One poller for public notes.** The sidebar only reads the copy while the public notes page
  is open (that page refreshes it).
- **Background loading runs once at a time** (`prefetchLists` shares a running promise).
- **ETag on the public endpoints.** `GET /api/public/lists`, `/lists/:id` and `/notes` send an
  ETag (hash of the body); the client sends it back as `If-None-Match` and a 304 only confirms
  the copy. Unchanged polls are a few bytes and do not rewrite IndexedDB. Pagination / excerpts
  were not added: the server still builds the whole answer, which is fine for an intranet
  (dozens of users); it is the next step if public notes grow large.
- **Old copies are removed.** After loading the list of public lists, copies of lists that are no
  longer in it are deleted, unless changes for them are queued or the copy is less than a minute
  old (an open page may be showing "not public any more").
- **The offline hint is back:** "Public lists need a connection the first time." (and the same for
  public notes) when nothing was ever loaded on the device and there is no connection.
- The new-note box uses `NOTE_TEXT_MAX`.

- **The intermittent browser-test timeouts were a server shutdown bug** (found while
  re-running the suite for these fixes, not raised in the review). Stopping the server waited
  forever for a connection the browser had opened in advance but never used: Node's
  `server.close()` does not treat such a socket as idle. Shown with logging (one connection, no
  request in flight, never closing), then reproduced in a unit test that fails without the fix.
  `http/shutdown.ts` `closeServer` now closes idle connections at once, gives requests under
  way 3 s, then closes the rest. In production this also means `docker compose stop` exits
  cleanly instead of being killed after its 10 s limit. The e2e harness's `stop()` also no
  longer hangs if the process has already exited, and it reports the server's stderr if the
  server dies on its own.

**Test counts after the review fixes:** shared 105, server 249, client 376, integration 48,
browser (e2e) 62.

**Test counts after the notes update:** shared 105, server 244, client 346, integration 46,
browser (e2e) 57 (13 MVP + 32 v1 + 5 recovery + 7 notes scenarios).
