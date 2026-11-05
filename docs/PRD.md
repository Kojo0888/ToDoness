# ToDoness – Product Requirements Document (PRD)

| | |
|---|---|
| **Status** | Draft v0.1 – for review |
| **Product** | ToDoness – a simple to-do list web app |
| **Related docs** | [TechStack.md](./TechStack.md), [DBModel.md](./DBModel.md) |

> Items marked **[?]** are my assumptions. Please confirm or correct them.

---

## 1. Summary

ToDoness is a simple to-do app for people who want to write tasks down fast and
check them off. It works in the browser on phone and desktop, and it **keeps
working without an internet connection**. Changes made offline are saved on the
device and sent to the server automatically when the connection returns.

## 2. Problem and goal

**Problem:** Many to-do apps are slow to open, overloaded with features, or stop
working when the connection is bad (train, plane, weak mobile signal).

**Goal:** A fast, minimal to-do app that is always usable, and whose data is
never lost, whether online or offline.

**Success looks like:**

| Measure | Target **[?]** |
|---------|----------------|
| Time to add a task (open app → task saved) | under 5 seconds |
| App loads with no connection | 100% of the time after the first visit |
| Offline changes lost after reconnecting | 0 |
| Changes appear on another device after reconnecting | within 1 minute |

## 3. Target users

- **Primary:** Individuals who manage personal tasks (work, home, study) on one or
  more devices.
- Not targeted in v1: teams or shared lists.

## 4. Scope

### In scope (v1)

1. Create, edit, complete and delete tasks.
2. Organize tasks into lists.
3. Due date and priority on tasks.
4. Full offline use, with automatic sync when back online.
5. User accounts, so data is available on several devices.
6. Installable web app (PWA) for phone and desktop.

### Out of scope (v1)

Sharing or collaboration, subtasks, tags, recurring tasks, reminders and push
notifications, file attachments, native mobile apps, third-party integrations,
and a task calendar view. See section 9 for later ideas.

## 5. User stories

**Tasks**

| ID | As a user, I want to… | So that… |
|----|----------------------|----------|
| T1 | add a task by typing a title and pressing Enter | I can capture it in seconds |
| T2 | mark a task done or not done with one tap | I can see my progress |
| T3 | edit a task's title, notes, due date and priority | I can keep it accurate |
| T4 | delete a task | my list stays clean |
| T5 | undo a delete right after doing it | an accidental tap is not a problem |
| T6 | reorder tasks by dragging them | I can put the important ones on top |
| T7 | see overdue tasks clearly marked | I do not miss deadlines |

**Lists**

| ID | As a user, I want to… | So that… |
|----|----------------------|----------|
| L1 | create, rename and delete lists | I can separate work, home, etc. |
| L2 | move a task to another list | I can fix mistakes |
| L3 | have a default list ("Inbox") ready on first use | I can start immediately |
| L4 | hide or show completed tasks | I can focus on what is open |

**Offline and sync**

| ID | As a user, I want to… | So that… |
|----|----------------------|----------|
| S1 | open and use the app with no connection | I can work anywhere |
| S2 | have offline changes sent automatically when I am back online | I never have to press "sync" |
| S3 | see whether I am offline, syncing, or fully saved | I trust my data is safe |
| S4 | have the same tasks on my phone and my computer | I can switch devices |
| S5 | have edits from two devices merged without losing data | I am not asked to resolve conflicts |

**Account**

| ID | As a user, I want to… | So that… |
|----|----------------------|----------|
| A1 | sign up and log in with e-mail and password | my data is private and portable |
| A2 | stay logged in on my device | I do not log in every time |
| A3 | log out | I can protect a shared device |
| A4 | install the app to my home screen or desktop | it feels like a normal app |

## 6. Functional requirements

### 6.1 Tasks

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | A task has: title (required, 1–500 characters), notes (optional), done flag, due date (optional), priority (none / low / medium / high), and belongs to exactly one list. | Must |
| FR-2 | New tasks are added at the top of the chosen list **[?]**. | Must |
| FR-3 | Completing a task records the completion time and moves it to the "completed" area of its list. | Must |
| FR-4 | Deleting a task removes it from view immediately and offers "Undo" for about 5 seconds. | Must |
| FR-5 | Users can reorder tasks within a list by drag and drop (keyboard alternative required). | Should |
| FR-6 | Overdue open tasks (due date before today) are highlighted. | Should |
| FR-7 | Users can search tasks by title and notes, locally (also works offline). | Could |

### 6.2 Lists

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-8 | A default list named "Inbox" is created for each new account and cannot be deleted. | Must |
| FR-9 | Users can create, rename, reorder and delete lists. | Must |
| FR-10 | Deleting a list asks for confirmation and also deletes its tasks. | Must |
| FR-11 | Each list shows a count of open tasks. | Should |
| FR-12 | Built-in smart views: **Today** (due today or overdue) and **All tasks**. | Should |

### 6.3 Offline and sync

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-13 | After the first successful visit, the app shell loads with no connection. | Must |
| FR-14 | Every create, edit, complete, reorder and delete works offline and is stored locally at once. | Must |
| FR-15 | Local changes are queued and sent to the server automatically when a connection is available. Retrying never creates duplicate tasks. | Must |
| FR-16 | The app downloads changes made on other devices when online. | Must |
| FR-17 | Conflicts are resolved automatically: edits to different fields are both kept; for the same field the most recent edit wins; a delete wins over an edit. | Must |
| FR-18 | A status indicator shows one of: *Offline*, *Syncing…*, *All changes saved*, or *N changes pending*. | Must |
| FR-19 | If the server rejects a change, the user sees a notice and the change is kept aside, not silently dropped. | Should |
| FR-20 | The app asks the browser to keep its data persistent (avoid automatic clearing). | Should |
| FR-21 | When a new app version is available, the user is asked to reload (no silent switch). | Should |

### 6.4 Account and security

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-22 | Sign up, log in and log out with e-mail and password. | Must |
| FR-23 | Sessions stay valid offline. If the login has expired when the connection returns, the app refreshes it before syncing. | Must |
| FR-24 | Each user can only access their own data. | Must |
| FR-25 | Logging out clears local data. If changes are still pending, the user is warned first. | Must |
| FR-26 | Password reset by e-mail. | Should |
| FR-27 | Delete account and all data. | Should |

## 7. Non-functional requirements

| Area | Requirement **[?]** |
|------|---------------------|
| **Performance** | First load under 2 s on a mid-range phone on 4G. Actions show their result in under 100 ms (they only touch local data). |
| **Offline** | Fully usable offline. Handles at least 5,000 tasks per user without noticeable slowdown. |
| **Reliability** | No data loss on app crash, tab close or browser restart. Server data is backed up daily. |
| **Security** | HTTPS only. Passwords hashed (argon2id). Server validates all input and checks ownership on every request. Rate limiting on login and sync endpoints. |
| **Privacy** | Only e-mail and task data are stored. No third-party analytics in v1. Users can export and delete their data **[?]**. |
| **Accessibility** | Meets WCAG 2.2 AA: keyboard operable, screen-reader labels, sufficient contrast, respects reduced-motion setting. |
| **Compatibility** | Latest two versions of Chrome, Edge, Firefox and Safari (desktop and mobile). Background Sync is Chromium-only; other browsers sync on app open, focus and reconnect. |
| **Responsive design** | Works from 320 px wide phones to large desktop screens. |
| **Languages** | English only in v1 **[?]**. Text kept in translation files for later. |
| **Appearance** | Light and dark theme, following the system setting. |

## 8. Main screens

1. **Sign up / Log in**
2. **Main view** – sidebar (Inbox, Today, All tasks, user lists, "New list"), task list for the selected view, quick-add field at the top, sync status indicator.
3. **Task detail** – edit title, notes, due date, priority and list; delete button.
4. **List settings** – rename, delete.
5. **Settings** – account, theme, log out, delete account.

On phones the sidebar becomes a slide-out menu and the task detail opens as a
full screen.

## 9. Future ideas (not in v1)

Tags, subtasks, recurring tasks, reminders and push notifications, shared lists,
attachments, calendar view, import/export (CSV / JSON), keyboard shortcuts,
widgets, and native apps.

## 10. Release plan

Follows the roadmap in [TechStack.md](./TechStack.md#10-implementation-roadmap).

| Milestone | Content |
|-----------|---------|
| **M1 – Local-only MVP** | Tasks and lists, stored on the device only, installable and fully offline |
| **M2 – Sync** | Server, queue of changes, push and pull, status indicator |
| **M3 – Accounts** | Sign up, login, multiple devices, conflict handling |
| **M4 – Polish and launch** | Search, smart views, accessibility pass, error monitoring, backups |

## 11. Acceptance criteria (key scenarios)

1. **Offline create:** With the network off, add a task, reload the page. The task is still there and the status shows *1 change pending*.
2. **Reconnect:** Turn the network on. Within a minute the status shows *All changes saved* and the task exists on the server and on a second logged-in device.
3. **No duplicates:** Interrupt the connection during sync and reconnect. The task exists exactly once.
4. **Merge:** Offline on two devices, change the title on one and the due date on the other. After both sync, both changes are present on both devices.
5. **Delete vs. edit:** Delete a task on one device and edit it on another while offline. After sync the task is deleted on both.
6. **First load offline:** After one online visit, close the browser, go offline and open the app. It loads and shows the user's tasks.
7. **Logout safety:** Log out with pending changes. The app warns the user before clearing data.

## 12. Risks and open questions

| # | Topic | Notes |
|---|-------|-------|
| 1 | **iOS / Safari storage limits** | Safari may clear site data after a period of no use. Mitigation: persistent storage request, sync often, warn users with long-pending changes. |
| 2 | **Background Sync not available everywhere** | Sync on Safari and Firefox only happens while the app is open. Acceptable for v1. |
| 3 | **Account requirement** | Should the app work without an account (local only) until the user signs up? **[?]** |
| 4 | **Social login** | Add "Sign in with Google/Apple" in v1, or e-mail and password only? **[?]** |
| 5 | **Hosting cost and plan** | Free for everyone, or a paid tier later? **[?]** |
| 6 | **Data export** | Is export required for v1 (privacy regulation, user trust)? **[?]** |
| 7 | **Languages** | English only, or more at launch? **[?]** |
