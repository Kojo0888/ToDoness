# ToDoness Notes – Product Requirements Document (PRD)

| | |
|---|---|
| **Status** | v1.0 – built (see [ImplementationPlan.md](./ImplementationPlan.md)) |
| **Builds on** | v1 ([`../v1/PRD.md`](../v1/PRD.md)) and the MVP ([`../mvp/PRD.md`](../mvp/PRD.md)) |
| **Related docs** | [ImplementationPlan.md](./ImplementationPlan.md) (plan, design, decisions) |

> Everything in the MVP and v1 PRDs still applies unless this document says otherwise.
> Requirement numbers continue where v1 stopped (FR-83 and up).
> Choices made where the request left room are marked **[Decision]** and explained in
> section 6.

---

## 1. Summary

ToDoness gets a second **module** next to Tasks: **Notes**. A note is a simple text box
the user writes into. Notes behave like tasks in everything that matters:

1. They work **offline** and **sync** between devices (same queue, same merge rules).
2. A note can be made **public**: every logged-in user can read and edit its text.
3. They are part of the **recovery after a server loss**: offline notes of an old account
   can be pushed to the new account together with tasks and lists.

A **Tasks | Notes** switch is always visible, and the app opens in the module the user
used last. The navigation is built so that more modules can be added later.

## 2. Goals and non-goals

**Goals**

- One obvious, always-visible place to switch between Tasks and Notes, on a computer and
  on a phone.
- Notes as reliable as tasks: offline-first, synced, mergeable, restorable.
- A navigation model that takes a third or fourth module without a redesign.

**Non-goals (for this update)**

- Rich text, formatting, Markdown preview, images or attachments in notes.
- Folders, tags, titles, search or colours for notes.
- Reordering notes by hand (newest on top; the order key is stored so it can come later).
- Reminders on notes.
- Offline editing of other people's public notes (as for public lists, decision D1 of v1).

## 3. User stories

| ID | As a user, I want to… | So that… |
|----|----------------------|----------|
| N1 | switch between Tasks and Notes with one tap, from any screen | I can jot something down quickly |
| N2 | write a new note and see it on top | the latest thought is the first one I see |
| N3 | change the text of a note and have it saved without pressing a button | I never lose what I typed |
| N4 | delete a note, with Undo | a slip is not fatal |
| N5 | write and change notes offline | notes work everywhere, like tasks |
| N6 | see my notes on all my devices | I can read them on my phone |
| N7 | make a note public, and private again | colleagues can read and edit it |
| N8 | read and edit other people's public notes | we can keep shared notes together |
| N9 | get my offline notes back after the server lost its data | nothing is lost |
| N10 | land in Notes when I last used Notes | the app opens where I left it |

## 4. Functional requirements

### 4.1 Module switch and navigation (FR-83 – FR-87)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-83 | A **module switch** with the entries **Tasks** and **Notes** is always visible: on a computer at the top of the sidebar (under the app name), on a phone in the top bar next to the menu button (the sidebar is hidden there). One tap or click opens the module (on a phone at least 44 px tall). It is a labelled group of links ("Modules"), the current module is marked (`aria-current`), and it works with the keyboard. Switching back to a module returns to the page last open in it during this visit. | Must |
| FR-84 | The sidebar shows the navigation of the **current** module: Tasks shows the lists, public lists and "Add list" as before; Notes shows **My notes** and **Public notes** (notes other users made public). Sync status, Settings and Admin stay at the bottom in both. Settings and Admin keep the sidebar of the module the user came from. | Must |
| FR-85 | The modules are defined in **one place** (name, address, how to tell whether a page belongs to it). Adding a module means adding one entry and its pages; the switch and the "open where I left" logic pick it up. **[Decision N1]** | Must |
| FR-86 | The app **remembers the last module** on the device. Opening the app (the start address `/`) shows that module: the Inbox for Tasks, *My notes* for Notes. Opening a direct link (for example a reminder's link to a task) still opens that page. **[Decision N2]** | Must |
| FR-87 | Addresses: Tasks keep theirs (`/l/…`, `/public/…`) and start at `/tasks` (the Inbox). Notes use `/notes` (my notes) and `/notes/public` (public notes of others). The start address `/` belongs to no module: it opens the last one. | Must |

### 4.2 Notes (FR-88 – FR-93)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-88 | *My notes* has a text box **"Write a note…"** with an **Add note** button (also **Ctrl/⌘ + Enter**). Adding puts the note **on top**. Empty or blank text is not added. | Must |
| FR-89 | Every note is shown as a **text box** with its full text, ready to edit. Changes are saved automatically about **1 second after the user stops typing**, and at once when the box loses focus. A note may be emptied (it stays until deleted). Max. **20 000** characters. | Must |
| FR-90 | Each note shows when it was last changed, a **Public** toggle and a **Delete** button. Deleting shows **Undo** for about 5 seconds (as for tasks). | Must |
| FR-91 | Notes are an ordinary synced entity: every change is one queued operation, works **offline**, survives a reload, and is merged **per field, last write wins** (text, public flag, order, deleted) with the same HLC rules as tasks and lists. While the user is typing in a note, a change arriving from another device does not replace the text under the cursor; the latest edit wins once it is saved. | Must |
| FR-92 | Notes are listed **newest first** (by their order key, a new note gets a key before all others). | Must |
| FR-93 | Logging out, or another user logging in, removes the notes from the device together with the tasks (and they count toward the "unsent changes" warning). | Must |

### 4.3 Public notes (FR-94 – FR-97)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-94 | The **Public** toggle (off by default) makes a note readable **and editable** by every logged-in user. It is a synced field (works offline, merged like any other). The toggle's explanation is a tooltip and a screen-reader description. | Must |
| FR-95 | **Public notes** (sidebar of Notes) lists the public notes of **other** users, newest change first, each labelled with the owner's e-mail. The count is shown next to the link. | Must |
| FR-96 | Others can **change the text** of a public note. Only the **owner** can delete it or make it private. The edit is sent to the server at once (saved like FR-89: after a pause or when leaving the box) and lands in the owner's data, so the owner's devices get it with the normal sync. | Must |
| FR-97 | Public notes of others are read from the server on demand, refreshed about every **5 seconds** (a box the user is typing in is not overwritten), and need a **connection**: offline the page says so and the boxes are read-only. A note that was made private or deleted disappears at the next refresh; an edit to it is refused with a clear message. | Must |

### 4.4 Recovery after a server loss (FR-98 – FR-99)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-98 | The data kept aside at sign-up (v1 FR-77) includes the device's live **notes** (text, public flag, order). A device holding only notes also gets the offer. | Must |
| FR-99 | The popup counts notes too ("… 3 tasks, 1 list and 2 notes …"). **Append** adds them; **Overwrite** also deletes the notes the account holds now. Restored notes keep their ids (restoring twice merges). | Must |

## 5. Non-functional requirements

| Area | Requirement |
|------|-------------|
| **Compatibility** | Old devices keep working: the server accepts the old operations unchanged, the local database is upgraded in place (Dexie version 3), and a recovery copy written before this update (without notes) still restores. |
| **Migration** | Migration `004_notes.sql` adds the `notes` table and lets the change feed carry notes. It keeps every existing row and `server_seq` (client cursors stay valid). |
| **Privacy** | A public note exposes its text and the owner's e-mail to all logged-in users, and lets them change the text. The toggle is off by default and explained. |
| **Accessibility** | The module switch is a labelled group of links with `aria-current` (not a second `nav` landmark: the sidebar is the one navigation); every note box has a label; the toggle is a `switch`. Phone touch targets at least 44 px. |
| **Performance** | Typing does not create one operation per key: a note is saved after a pause or on leaving the box. |

## 6. Decisions

| # | Topic | Decision |
|---|-------|----------|
| N1 | Where does the switch go, and how do more modules fit? | A **segmented switch** (tabs-like links) at the top of the sidebar, and in the top bar on phones, because the sidebar is hidden there and the switch must be one tap away. The module list lives in `client/src/lib/modules.ts`; each module brings its own sidebar section and pages. Two to four modules fit the segmented switch on a phone (labels are short); beyond that it should become an icon rail on computers and a bottom bar on phones, which only changes the switch component, not the modules. |
| N2 | Where is "last module" stored? | In the browser's `localStorage` (per device, like the theme), not in the synced data: it must be known **before** the local database is open so the right module shows without a flash, it is a device preference, and it survives logout. Changing the module on one device does not move the other devices. |
| N3 | What is a note? | Only **text** (plus the public flag and an order key). No title: the first line serves as one in the list. Keeps "simple text boxes" literally simple. |
| N4 | Who may do what with a public note? | Everyone edits the **text**; only the owner deletes it or makes it private, the same split as public lists (v1 FR-33). Others cannot change the order or the flag. |
| N5 | How are public notes shared? | Like public lists: read on demand (`GET /api/public/notes`) and edited online through a restricted push (`POST /api/public/notes/:id/push`) that runs the shared merge with the owner as row owner. Copying them into everyone's device would make the per-user change feed much heavier (v1 decision 3). |
| N6 | Saving while typing | Debounced (1 s) plus on blur. One operation per pause instead of per key keeps the outbox and the change feed small; blur covers "closed the app right after typing" for the common case (and the page also flushes on `pagehide`). |
| N7 | Empty notes | Allowed after creation (the user may clear a note before rewriting it). Creating requires text, so a stray click does not leave empty notes behind. |

## 7. Acceptance criteria (key scenarios)

1. **Switch:** On a computer and on a phone, the Tasks | Notes switch is visible without opening a menu. Clicking Notes shows *My notes*; clicking Tasks shows the last list.
2. **Remember:** Open Notes, reload the app at `/` → *My notes* is shown. Open Tasks, reload → the Inbox is shown.
3. **Write:** Add "Shopping: milk" → it is on top. Change it to "Shopping: milk, eggs", wait a second, reload → the new text is there.
4. **Offline:** Go offline, add a note, edit another, delete a third (Undo once, then delete again). Go online → a second device of the same user shows exactly that.
5. **Public:** A makes a note public. B sees it under *Public notes* with A's e-mail, edits the text. A's devices show B's text after the next sync. B cannot delete it or make it private. A makes it private → it disappears for B at the next refresh; an edit B sends after that is refused with a message.
6. **Recovery:** A device holding the old account's notes (and maybe tasks) signs up on a fresh server → the popup counts the notes; Append restores them; Overwrite also removes the notes the new account had.
7. **Old data:** A database and a browser from before the update keep working after upgrading; nothing is lost.

---

## 8. Update 2: reorder and search notes, offline edits to public data (FR-100 – FR-111)

This update lifts three of the non-goals of section 2: reordering notes by hand, search, and
offline editing of other people's public notes **and** public task lists (the latter was v1
decision D1).

### 8.1 Reorder notes (FR-100 – FR-102)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-100 | Each of my notes has a **drag handle**. Dragging a note before or after another one changes its place; mouse, touch and keyboard work as for tasks (Space to pick up, arrow keys, Space to drop, Escape to cancel), with screen-reader announcements. | Must |
| FR-101 | A new position is **one change** (one new order key), works offline and is merged like any other field. Dropping a note where it was changes nothing. A new note still lands on top. | Must |
| FR-102 | Only the owner orders their notes; *Public notes* of others stay sorted by last change (as before) and have no handle. While a search is active, dragging is off (the shown order is incomplete). | Must |

### 8.2 Search notes (FR-103 – FR-105)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-103 | *My notes* and *Public notes* have a **search box**. Typing filters the notes at once to those containing **every word** typed, ignoring upper/lower case and accents (`cafe` finds `Café`); on *Public notes* the owner's e-mail is searched too. | Must |
| FR-104 | The page says how many notes match, and "No notes match" with a **Clear** button when none do. Escape in the box clears it. Adding a note clears the search, so the new note is visible. | Must |
| FR-105 | Search works offline (it runs on the device) and is not remembered across reloads. | Must |

### 8.3 Offline edits to public lists and notes (FR-106 – FR-111)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-106 | Other users' public lists (the list of them, and each list with its tasks) and public notes are **kept on the device** each time they are loaded, and every public list in the sidebar is loaded in the background about once a minute, so they can be **read offline**. A page shows when the copy is from ("Offline copy from 10:42"). A list never loaded on this device says it is not available offline. | Must |
| FR-107 | Everything other users may change in public data can now also be done **offline**: add, edit, complete, delete (with Undo), reorder tasks of a public list; change the text of a public note. Changes are shown at once and **queued** on the device; they survive a reload. Attachments still need a connection (v1 D3). | Must |
| FR-108 | Queued public changes are sent by the **normal sync** (same retry and timing as own changes), as soon as the server can be reached, and count in the "N changes pending" indicator and in the warning before logging out. Each change is applied with the usual per-field "last write wins" rule, by the time it was made: an offline edit made earlier than someone else's later edit does not overwrite it. | Must |
| FR-109 | If the server refuses a queued change (the list or note was made **private or deleted** meanwhile, or the change is not allowed), it is dropped from the queue and kept aside, and the page of that list or note (or *Public notes*) says how many changes were not saved, with a **Dismiss** button. | Must |
| FR-110 | After sending, the page shows the server's version (which includes everybody's changes). | Must |
| FR-111 | Logging out or another user logging in removes the offline copies and the queue (like own data). Queued public changes are **not** part of the recovery after a server loss (they belong to other accounts). | Must |

### 8.4 Decisions

| # | Topic | Decision |
|---|-------|----------|
| N8 | How is public data made offline-capable without changing the sync model? | Two **local** tables, not a change in the per-user change feed: a **cache** of the server's answers (refreshed when online) and a **public outbox** of operations, each tagged with its target list or note. The sync engine sends that outbox through the existing restricted push endpoints after the own outbox. The page shows *cache + pending operations*. The server and its merge rules do not change at all, so v1 decision D1's concern (a heavy per-user feed of other people's data) does not come back. |
| N9 | Conflicts | The operations carry the device's clock time of the edit, as own operations do, and the server merges per field. An offline change therefore wins only over older edits. While a change is still queued, the page shows it on top of the cached copy (the user's view), and switches to the server's result once it is sent. |
| N10 | Refused changes | Not retried (the list is private or gone: retrying cannot help). They go to the existing dead-letter table with their target, so the page can say so. Nothing is silently lost without a message. |
| N11 | Reordering by drag only | Same interaction as tasks, so nothing new to learn; the keyboard path of the drag-and-drop library is the accessible alternative. No "move up / down" buttons, to keep the cards small. |
| N12 | Search is plain text matching | Every word must occur, case and accents ignored. No index: a person's notes are few and already in memory. |

### 8.5 Acceptance criteria

1. **Reorder:** drag the third note to the top with the mouse, then move it back with the keyboard; reload → order kept; a second device shows the same order after syncing.
2. **Search:** with notes "Café menu", "Team lunch", "Lunch: café Friday", typing `cafe lunch` shows only the last one; Escape shows all again.
3. **Offline public list:** Bob opens Ann's public list, goes offline, reloads, still sees it, adds a task, completes another, edits a title. "3 changes pending". Online again → Ann sees all three after her next sync, and Bob's page shows the server version.
4. **Offline public note:** Bob edits Ann's public note offline; online again → Ann gets the text.
5. **Refused:** Bob edits offline; Ann makes the list private; Bob goes online → the edit is not applied, Bob's page says 1 change was not saved.
