# ToDoness Notes – Product Requirements Document (PRD)

| | |
|---|---|
| **Status** | Draft – ready to build |
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
| FR-83 | A **module switch** with the entries **Tasks** and **Notes** is always visible: on a computer at the top of the sidebar (under the app name), on a phone in the top bar next to the menu button (the sidebar is hidden there). One tap or click opens the module. It is a set of links (`nav`), the current module is marked (`aria-current="page"`), and it works with the keyboard. | Must |
| FR-84 | The sidebar shows the navigation of the **current** module: Tasks shows the lists, public lists and "Add list" as before; Notes shows **My notes** and **Public notes** (notes other users made public). Sync status, Settings and Admin stay at the bottom in both. Settings and Admin keep the sidebar of the module the user came from. | Must |
| FR-85 | The modules are defined in **one place** (name, address, how to tell whether a page belongs to it). Adding a module means adding one entry and its pages; the switch and the "open where I left" logic pick it up. **[Decision N1]** | Must |
| FR-86 | The app **remembers the last module** on the device. Opening the app (the start address `/`) shows that module: the Inbox for Tasks, *My notes* for Notes. Opening a direct link (for example a reminder's link to a task) still opens that page. **[Decision N2]** | Must |
| FR-87 | Addresses: Tasks keep theirs (`/l/…`, `/public/…`). Notes use `/notes` (my notes) and `/notes/public` (public notes of others). | Must |

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
| **Accessibility** | The module switch is a labelled `nav` with `aria-current`; every note box has a label; the toggle is a `switch`. Phone touch targets at least 44 px. |
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
