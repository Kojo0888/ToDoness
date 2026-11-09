# ToDoness v1 – Product Requirements Document (PRD)

| | |
|---|---|
| **Status** | Draft v1.0 – ready to build |
| **Builds on** | The MVP in [`../mvp/`](../mvp/) ([PRD](../mvp/PRD.md), [TechStack](../mvp/TechStack.md), [DBModel](../mvp/DBModel.md)) |
| **Related docs** | [ImplementationPlan.md](./ImplementationPlan.md), [TechStack.md](./TechStack.md) |

> Everything in the MVP PRD still applies unless this document says otherwise.
> Requirement numbers continue where the MVP stopped (FR-29 and up).
> Decisions I had to make where the request left room are marked **[Decision]**.

---

## 1. Summary

v1 turns the single-user MVP into something a small team can use together,
and makes tasks richer:

1. A signed-in user can **change their own password**.
2. A list can be switched to **public**, so every user of the app can read **and edit** it.
3. Tasks can be **reordered by drag & drop**, and **dragged onto another list**.
4. A task can have a **reminder** (1 week, 1 day or 1 hour before it is due),
   shown as a notification, also when the app is closed (**Web Push**).
5. A task can have **attachments**, up to a size set in the server config
   (default 100 MB per file).
6. The admin screen shows **who is online right now**.

## 2. Goals and non-goals

**Goals**

- Keep the offline-first promise: everything that was offline-capable in the MVP
  stays offline-capable.
- Keep the app fast and simple. No new service, no new database: still one
  container, one SQLite file, plus a folder for attachments.

**Non-goals (still out of scope)**

- Renaming, deleting, reordering or making private a list by anyone but its owner (other
  people edit the **tasks** of a public list, not the list itself).
- Anonymous visitors: "everyone" means every **logged-in** user (sign-up is open on
  the intranet, so anyone who can reach the app can become one).
- Offline upload of attachments (see decision D3).
- Virus scanning, image thumbnails, previews.

## 3. User stories

| ID | As a user, I want to… | So that… |
|----|----------------------|----------|
| A7 | change my password while I am logged in | I can keep my account safe without asking the admin |
| P1 | switch one of my lists to "public" | colleagues can see it |
| P2 | switch it back to private | I stay in control |
| P3 | browse the public lists of other users | I can see shared information |
| P4 | add, change, complete, delete, reorder tasks in a public list of someone else, and attach files | we can work on one list together |
| T6 | drag a task up or down in its list | I can put the important ones on top (this finishes MVP story T6) |
| L2 | drag a task onto another list in the sidebar | I can file it without opening it |
| R1 | pick "1 week / 1 day / 1 hour before" on a task with a due date | I am reminded in time |
| R2 | get a pop-up notification when it is time | I notice it even if the app is in another tab |
| F1 | attach files to a task | everything about the task is in one place |
| F2 | download and remove an attachment | I can get my files back and clean up |
| AD1 | (as admin) see who is online | I know who is using the app |

## 4. Functional requirements

### 4.1 Change password (FR-29 – FR-31)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-29 | In **Settings** a logged-in user can change their password by entering the **current** password, the **new** password (min. 8, max. 200 characters, as at sign-up) and a repeat of the new one. | Must |
| FR-30 | The server checks the current password. A wrong one is refused and counts toward the login rate limit. On success the new password is stored (argon2id) and **all other sessions of that user are ended**; the session making the request stays logged in. | Must |
| FR-31 | Changing the password needs a connection to the server. Offline, the form says so and is disabled. | Must |

### 4.2 Public lists (FR-32 – FR-36)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-32 | Every list has a **"Public"** switch (off by default), on the list page. It is a normal synced list field: it works offline and is merged like any other field. | Must |
| FR-33 | A public list, with its tasks and attachments, is **readable and editable by every logged-in user**: they can add tasks, change title, notes, due date and time and priority, complete and reopen, delete (with Undo), reorder by dragging, and attach or remove files. Only the **owner** can rename or delete the list, reorder it among the lists, and switch it back to private. Others cannot move a task out of the list. There is no change history in v1: the latest edit to a field wins. | Must |
| FR-34 | The sidebar shows a **"Public lists"** section with the public lists of **other** users, labelled with the owner's e-mail. Opening one shows an editable page. | Must |
| FR-35 | Other people's public lists are read from the server on demand (they are not copied to the viewer's device), refreshed about every 5 seconds while the page is open, and every edit is sent to the server at once. Offline they cannot be opened or edited (a short note says so). The owner's own edits keep working offline; edits made by others reach the owner's devices through the normal sync. **[Decision D1]** | Must |
| FR-36 | Making a list private, or deleting a list or task, removes it from other users' view at their next refresh. Attachments of a private list can no longer be downloaded by others. | Must |

### 4.3 Drag & drop (FR-37 – FR-41)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-37 | Open tasks can be **reordered by dragging** a handle on the row, with mouse, touch or keyboard (Space to pick up, arrow keys to move, Space to drop, Esc to cancel). | Must |
| FR-38 | The new position is saved as one change (one `orderKey`), works offline, and is merged without conflicts (existing fractional-index design). | Must |
| FR-39 | A task can be **dragged onto a list in the sidebar** to move it there. It lands on top of that list. The list under the pointer is highlighted while dragging. | Must |
| FR-40 | The task-detail "List" selector stays as the keyboard / touch alternative for moving between lists (on phones the sidebar is hidden while dragging). | Must |
| FR-41 | Dragging never changes anything if the task is dropped where it started. | Must |

### 4.4 Reminders (FR-42 – FR-47)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-42 | The task detail has a **"Remind me"** field: *No reminder / 1 week before / 1 day before / 1 hour before*. **[Decision D2: one choice per task.]** | Must |
| FR-43 | The due date can now carry an optional **time**. No time means the start of the day (00:00 local time), as before. The reminder is counted back from the due date and time. | Must |
| FR-44 | A reminder is only active for an **open** task with a due date. Completing, deleting or removing the due date or reminder cancels it. Changing the due date or the reminder makes it fire again. | Must |
| FR-45 | When the time has come, the app shows a **system notification** (title: the task, text: when it is due) and an in-app message. A reminder fires **once per device** per due date + choice. | Must |
| FR-46 | The check runs while the app is open: when it starts, when the tab becomes visible, and about every 30 seconds. A reminder whose time passed while the app was closed fires at the next start, **if the task is not yet due**. | Must |
| FR-47 | Notifications need a **secure context (HTTPS, or `localhost`)** and the user's permission. The app asks for permission when the user first sets a reminder (and offers a button in Settings). Without HTTPS or permission, the field explains why reminders will only appear inside the app. | Must |

### 4.5 Attachments (FR-48 – FR-55)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-48 | In the task detail the owner can **attach files**. Each file may be up to **`MAX_ATTACHMENT_MB`** (default **100**) megabytes. | Must |
| FR-49 | The limit is **configurable** on the server (environment variable `MAX_ATTACHMENT_MB`), documented in the README. The app reads it from the server (`GET /api/config`) and refuses a too large file **before** uploading; the server enforces it again while receiving, and stops and discards anything above it. | Must |
| FR-50 | Each attachment shows its name and size, with **Download** and **Remove** (owner only). Uploading shows progress. | Must |
| FR-51 | Files are stored on the server's disk in `ATTACHMENTS_DIR` (default: an `attachments` folder next to the database file). Names and sizes are stored in the database. | Must |
| FR-52 | Downloads are always sent as a **download** (never shown inline) with a safe content type, so an uploaded HTML or SVG file cannot run in the app's origin. | Must |
| FR-53 | The owner can add, download and remove attachments of their tasks. For tasks in a **public list** every logged-in user can do the same. | Must |
| FR-54 | Deleting a user also deletes their attachment files. Attachments of a deleted task stay until the task is permanently removed, so **Undo** keeps working. | Must |
| FR-55 | Attachments need a connection (upload, list, download, remove). **[Decision D3]** The task must already be on the server: if it was created offline, the app syncs first. | Must |

### 4.6 Who is online (FR-56 – FR-58)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-56 | The server records when it last heard from each logged-in user (any authenticated request; the app talks to the server about every 5 seconds while it is open). | Must |
| FR-57 | A user is **online** if that was within the last **`ONLINE_WINDOW_SECONDS`** (default 30). | Must |
| FR-58 | The admin **Users** table gets a new **"Online"** column with an indicator (a coloured dot **and** the words *Online* / *Offline*, with "last seen" as a tooltip). The table refreshes about every 5 seconds while the admin screen is open. | Must |

### 4.7 Web push (FR-59 – FR-66)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-59 | In **Settings** the user can switch **push notifications** on or off for this device. When the user allows notifications and sets a reminder, the device is subscribed automatically. | Must |
| FR-60 | The server stores each device's push subscription for its user. If another user logs in in the same browser, the subscription moves to them. **Logging out** removes it, so a logged-out device never receives someone's reminders. | Must |
| FR-61 | The server checks the reminders **every 30 seconds** (also when no app is open) and sends **one push per reminder** (task + due date + choice) to **all** subscribed devices of the owner. A reminder is sent once; changing the due date or the choice sends it again. A reminder whose time passed while the server was down is sent when it is up again, as long as the task is not yet due. | Must |
| FR-62 | The notification shows the task title and "Due in …"; clicking it focuses the app (or opens it) on the task. | Must |
| FR-63 | Subscriptions that the push service reports as gone are deleted. A failure to send never stops the other pushes. | Must |
| FR-64 | The server creates its **VAPID** keys on first start and keeps them in the database. They can be set in the environment instead (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). | Must |
| FR-65 | Push needs HTTPS (or localhost), the user's permission, and outbound HTTPS from the **server** to the browser vendor's push service. Where it is not available, Settings says why and reminders still appear inside the app. | Must |
| FR-66 | A reminder shown by the app itself (app open) and the same reminder pushed by the server use the same notification tag, so the user sees one notification, not two. | Should |

### 4.8 Switch, sidebar and sync diagnostics (FR-67 – FR-71)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-67 | The "Public list" setting is a **toggle**. Its explanation is a **tooltip** (and a description for screen readers), not text on the page. | Must |
| FR-68 | The sidebar is as tall as the screen and does not scroll with the page: the sync status, **Settings** and **Admin** are always visible, however long the task list is. The lists scroll inside the sidebar if there are many. | Must |
| FR-69 | **Offline → online takes at most 5 seconds** from the moment the connection works again, also when requests hang and the browser does not report the return. When the browser reports it, syncing continues at once (a waiting request is abandoned). Requests give up after 3.5 s (2 s after a failure) and a dead connection is retried every second. | Must |
| FR-70 | The browser's `offline` event shows **Offline** at once. | Should |
| FR-71 | **Admin only:** above the "All changes saved" indicator, flags show the browser's online state, the sync state, the request in flight (with how long it has waited) or the last one (time and result), the next planned try, and the last measured *online event → saved* and *outage* times. A **Log** shows the last 100 sync events with times (what triggered a sync, each request and its result, retries). | Must |

### 4.9 Time control and phone file pickers (FR-72 – FR-73)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-72 | The due **time** is chosen with an **hour** and a **minute** list (minutes in steps of 5; an existing off-grid minute is kept), quick choices (Morning 09:00, Noon 12:00, Afternoon 15:00, Evening 18:00) and a Clear button. It is disabled until a date is set. 00:00 is not offered because it means "no time". | Must |
| FR-73 | On a touch screen, attachments are added with two pickers: **photos or videos** (`image/*,video/*`) and **documents** (`application/*,text/*`). Neither accepts audio or "any file", so the phone offers the media/file pickers and does not ask for camera or microphone access. Computers keep one unrestricted picker. | Must |

## 5. Non-functional requirements (changes and additions)

| Area | Requirement |
|------|-------------|
| **Security** | Uploaded files are never executed or rendered inline (FR-52). File names are stored as text and never used as a path (files are stored under generated ids). Access is checked on every attachment request. The upload size is limited by both the declared and the actual number of bytes. A wrong current password counts toward rate limiting. |
| **Privacy** | Public lists expose the owner's e-mail, titles, notes, due dates and attachments to all logged-in users, **and let them change or delete the tasks**. The switch is off by default and clearly labelled as such. |
| **Performance** | Uploads are streamed to disk, never held in memory. Presence tracking writes at most once per user every 5 seconds. |
| **Accessibility** | Drag and drop works with the keyboard and announces its state to screen readers. The online indicator does not rely on colour alone. |
| **Compatibility** | Notifications use the standard Notification API (through the service worker where the browser requires it). Safari / iOS support is limited to installed web apps; the field explains when notifications are not available. |
| **Operations** | One more folder to back up: the attachments folder next to the database (documented in the README). |
| **Config** | `MAX_ATTACHMENT_MB`, `ATTACHMENTS_DIR`, `ONLINE_WINDOW_SECONDS` – all optional, validated at start-up, listed in the README. |

## 6. Decisions and open points

| # | Topic | Decision |
|---|-------|----------|
| D1 | How do others get and edit public lists? | Read on demand through the API, edited online through a restricted push endpoint that applies the same merge rules and writes the change into the **owner's** change feed. Copying public lists into every user's local database (so everyone could edit offline) would make the sync model (per-user change feed) much heavier. |
| D2 | One reminder or several? | One choice per task. Simple to understand and to merge between devices. Several reminders can be added later (the field would become a list). |
| D3 | Offline attachments? | No. Files up to 100 MB do not fit the "small queue of tiny changes" offline model (browser storage quota, retries). Attach, list and download need a connection. |
| D4 | Due time | Added as an optional time next to the date. Overdue highlighting still works by day (a task due today at 09:00 is not marked overdue until tomorrow). |
| D5 | Reminders while the app is closed | **Web Push** (section 4.7). The server sends the push; delivery goes through the browser vendor's push service (Google, Mozilla, Apple), so the server needs outbound HTTPS access to it. Without push, the app still catches up at the next start (FR-46). |
| D6 | Who counts as "online" | Last authenticated request within 30 s. A browser tab in the background may be throttled and show as offline after a while; that is accepted. |

**Risks**

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Large uploads fill the disk | Size limit per file is configurable; the attachments folder is documented for backup and monitoring. No per-user quota in v1. |
| R2 | Push cannot be delivered (no outbound access from the server to the browser vendor's push service, notifications blocked, device off) | Documented in the README. The in-app reminder and the catch-up at the next start still work. Dead subscriptions are removed automatically. |
| R3 | Notifications blocked by the browser or plain HTTP | Clear explanation in the UI; in-app message still shown. |
| R4 | Drag and drop on touch screens fights with scrolling | A dedicated drag handle with `touch-action: none`; the rest of the row scrolls normally. |

## 7. Acceptance criteria (key scenarios)

1. **Change password:** In Settings enter the wrong current password → refused. Enter the right one and a new password → success; another logged-in device of the same user is logged out; logging in with the old password fails, with the new one works.
2. **Public list:** User A switches list "Recipes" to public. User B sees "Recipes (a@…)" under *Public lists*, opens it, adds a task, completes another one and edits a title. A sees all three changes after the next sync, also on a second device, and A's offline edits are merged with B's. B cannot rename or delete the list. A switches it back to private → B no longer sees it after the next refresh.
3. **Reorder:** Drag the third task to the top (mouse, then keyboard). Reload → the order is kept. Do it offline → after reconnecting the other device shows the same order.
4. **Move by drag:** Drag a task onto "Work" in the sidebar → it disappears from the current list and is on top of "Work".
5. **Reminder:** Set a task due in 1 hour 5 minutes with "1 hour before" → within about 30 seconds after the 5 minute mark a notification pops up, once. Changing the due date re-arms it.
6. **Attachments:** Attach a small file → it is listed with name and size; download returns identical bytes; remove deletes it. With `MAX_ATTACHMENT_MB=1`, a 2 MB file is refused in the app, and refused by the server if sent directly.
7. **Online indicator:** User B opens the app → the admin sees B with the green *Online* indicator within about 5 seconds; B closes the app → *Offline* within about 30 seconds plus one refresh.
8. **Offline still works:** Everything from the MVP acceptance list still passes.
9. **Web push:** On an HTTPS site the user allows notifications and sets a reminder, then **closes the app**. At the reminder time a notification appears; clicking it opens the task. It appears once even if the user has two devices subscribed on one account (one per device) and not again after a reload. Logging out on a device stops pushes to it.
