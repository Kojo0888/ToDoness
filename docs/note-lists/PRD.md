# ToDoness note lists and settings – Product Requirements Document (PRD)

| | |
|---|---|
| **Status** | v1.0 – built (see [ImplementationPlan.md](./ImplementationPlan.md)) |
| **Builds on** | Notes ([`../notes/PRD.md`](../notes/PRD.md)), UI refresh ([`../ui-refresh/PRD.md`](../ui-refresh/PRD.md)) |
| **Rules** | [`../../UI_GUIDELINES.md`](../../UI_GUIDELINES.md) |

> Everything in the earlier PRDs still applies unless this document says otherwise.
> Requirement numbers continue at FR-119. Choices made where the request left room are
> marked **[Decision]** and explained in section 4.

## 1. Summary

1. **Settings:** every notification channel (on this device, web push, ntfy) is one row with
   the **same on/off switch**; the explanations move into an **"i" tooltip**.
2. Notifications on this device can be **turned off** (today they can only be turned on).
3. A general UI rule: descriptions are shown behind an **"i" info button**, not as visible text.
4. **Note lists:** notes can be organised in lists, managed like task lists. *My notes* is
   created for every account and can be renamed; *Public notes* is fixed.
5. The sidebar shows the **number of open tasks** next to each task list (as Notes already
   shows counts).
6. *Manage lists* gets an **app-bar header** with a round back button instead of the pill.

## 2. Goals and non-goals

**Goals:** one consistent control for notification channels; a way to switch off in-app
notifications; notes grouped in lists with the same management as task lists.

**Non-goals:** making note lists public (single notes stay public or private as before);
moving a note to another list (may come later; the field is synced so it can be added);
counts for other users' public task lists (their tasks are not on the device until opened).

## 3. Requirements

### 3.1 Settings (FR-119 – FR-123)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-119 | The notification channels **Notifications on this device**, **Push notifications** and **Reminders through ntfy** are each shown as one row: name, "i" info button, and an on/off **switch** (`role="switch"`) on the right. A short status line (e.g. "Blocked in your browser settings") appears under the row only when it matters. | Must |
| FR-120 | **Notifications on this device** can be switched **on and off**. Off: the open app shows no reminder messages and no system notifications on this device. Switching on asks the browser for permission when it was not asked yet. The choice is kept per device. **[Decision S1]** | Must |
| FR-121 | **Push**: the switch turns web push on/off for this device; it is disabled (with the reason as status) where push is not possible. | Must |
| FR-122 | **ntfy**: switching on opens the topic setup (topic, Generate, Save); the switch stays on once a topic is saved. Switching off removes the topic. Test and the subscribe address show while it is on. | Must |
| FR-123 | **[Rule]** Explanatory text (what a setting does, hints) is not shown as a paragraph: it is behind an **"i" info button** that shows it as a tooltip on hover, keyboard focus and tap, and is linked to the control with `aria-describedby`. Errors and live status stay visible. Added to `UI_GUIDELINES.md`. | Must |

### 3.2 Note lists (FR-124 – FR-131)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-124 | Every account has the note list **My notes**. It is created with the account; existing accounts get it at their first sync after the update. **[Decision L2]** | Must |
| FR-125 | The user can **create** note lists (sidebar of Notes: "New note list" + Add). A new list opens at once and is empty. | Must |
| FR-126 | The Notes sidebar shows *My notes*, the user's note lists (in their order), then *Public notes*, each with the **number of notes**; then a **Manage lists** button. | Must |
| FR-127 | Each note list is a page like *My notes* today (add, edit, reorder, search, public toggle, delete with Undo); a note belongs to the list it was added in. | Must |
| FR-128 | **Manage note lists** works like *Manage lists* of tasks: rename, reorder by dragging, delete (with a confirmation that counts the notes; the notes are deleted with the list). | Must |
| FR-129 | *My notes* can be **renamed** but not deleted or moved (it stays first). | Must |
| FR-130 | *Public notes* is shown in *Manage note lists* as a **locked** row: it cannot be renamed, moved or deleted. | Must |
| FR-131 | Note lists sync, work offline and merge like task lists; they are part of the recovery after a server loss. Older app versions keep working: they never see note lists (their notes show under their single *My notes*). | Must |

### 3.3 Sidebar and Manage lists look (FR-132 – FR-133)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-132 | Every own task list in the sidebar shows the number of its **open** tasks, in the same badge as the note counts. | Must |
| FR-133 | *Manage lists* (tasks and notes) has an **app-bar header**: a round icon back button (44 px on phones, with `aria-label` and tooltip) to the left of the title, replacing the "← Back to tasks" pill. **[Decision U1]** | Must |

## 4. Decisions

| # | Topic | Decision |
|---|-------|----------|
| S1 | Turning off notifications | A web page cannot take back a browser permission, so "off" is an **app setting on this device** (`localStorage`, like the theme). The scheduler still marks reminders as handled while off, so switching on again does not show a burst of old reminders. Off covers both the in-app message and the system notification (both are "local" notifications); push and ntfy have their own switches. |
| L1 | Data model of note lists | **Reuse `lists`** with a new create-only field `module` (`'tasks'` default, or `'notes'`), and give notes a synced `listId` (`null` = *My notes*). Reusing the list entity keeps the change feed, merge rules, recovery and per-field history; the change-log `CHECK` does not need a rebuild. A note list's `module` can never change. |
| L2 | *My notes* | A note list with `isInbox = true` and `module = 'notes'` (at most one per user and module). The server creates it at sign-up and, for existing accounts, at the first pull after the update (idempotent), so devices never race to create duplicates. Notes keep `listId = null` for it, so notes written before the update, and notes written by older apps, land there without rewriting data. Unlike the task Inbox it may be renamed. |
| L3 | *Public notes* in Manage | It is not a stored list (it shows other users' notes), so it is a fixed, locked row (lock icon, no handle, no menu). |
| L4 | Older apps | A pull without `lists=modules` gets no changes of note lists and note patches without `listId`; everything else is unchanged. |
| U1 | Manage lists look | A back link with a label next to a title looked like two headings. An app bar (round icon button + title on one line) is the familiar mobile pattern, takes less space and leaves the title as the only text. The page stays a page (deep-linkable, works with the browser back button). Considered: a bottom sheet / dialog – better for quick edits on phones, but drag-and-drop inside a scrolling sheet is fiddly; kept as a possible later step. |

## 5. Acceptance criteria

1. Settings shows three notification rows with identical switches and "i" buttons; no hint paragraphs.
2. With notifications on, switching *Notifications on this device* off → a due reminder shows neither a message nor a notification; switching on again does not replay it.
3. Create note list "Work", add a note there → it shows only in "Work"; counts update in the sidebar.
4. In *Manage note lists*: rename *My notes* to "Personal" works; it has no delete; *Public notes* is locked; "Work" can be moved and deleted (its notes go too).
5. A second device of the same user shows "Personal" and "Work" with the same notes after syncing.
6. Task lists in the sidebar show their open-task counts.
