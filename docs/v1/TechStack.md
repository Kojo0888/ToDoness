# ToDoness v1 – Tech stack changes

> Only what changes compared with [`../mvp/TechStack.md`](../mvp/TechStack.md).
> Everything not mentioned stays as it was (React, Dexie, Hono, SQLite, Zod,
> HLC merge, Caddy, Docker).

## 1. New dependency

| Need | Choice | Why |
|------|--------|-----|
| Drag & drop (reorder + drop on sidebar list) | **`@dnd-kit/core`** + **`@dnd-kit/sortable`** (client only) | Mouse, touch **and keyboard** sensors with screen-reader announcements (WCAG requirement), small, React 19 compatible, no jQuery-style DOM hacks. The browser's native HTML5 drag & drop has no keyboard support and does not work on touch screens. |

No new server dependency: uploads use Node streams (`node:stream`, `node:fs`),
notifications use the browser's own `Notification` API.

## 2. Data model changes (migration `002_v1.sql`, Dexie version 2)

| Where | Change |
|-------|--------|
| `lists` | `is_public INTEGER NOT NULL DEFAULT 0` (synced field `isPublic`) |
| `todos` | `remind_before TEXT NULL` – `'week' \| 'day' \| 'hour'` (synced field `remindBefore`) |
| `users` | `last_seen_at INTEGER NULL` (presence, not synced) |
| new table `attachments` | `id, user_id, todo_id, name, size, content_type, created_at` – metadata only; **not** part of the sync feed (see D3) |
| Dexie | version 2: new table `notified` (`key`) remembers which reminders already fired on this device; `lists`/`todos` rows get the new fields (defaults applied on read, no data rewrite needed) |

Rules that stay the same: UUIDv7 ids created on the client, per-field HLC merge,
soft delete, `change_log` feed. `isPublic` and `remindBefore` are ordinary fields
in the whitelist (`listFields`, `todoFields`), so push/pull/merge need no special
code.

## 3. New server endpoints

| Method and path | Who | Purpose |
|-----------------|-----|---------|
| `POST /api/auth/change-password` | logged in | `{ currentPassword, newPassword }`; ends the user's other sessions |
| `GET /api/config` | anyone | `{ maxAttachmentBytes }` so the UI can check file sizes up front |
| `GET /api/public/lists` | logged in | Public lists of **other** users (id, name, owner e-mail) |
| `GET /api/public/lists/:id` | logged in | One public list with its tasks and attachment metadata |
| `GET /api/todos/:id/attachments` | owner, or anyone if the list is public | List attachments |
| `POST /api/todos/:id/attachments?name=…` | owner | Upload one file; raw request body, streamed to disk |
| `GET /api/attachments/:id` | owner, or anyone if the list is public | Download (always `Content-Disposition: attachment`) |
| `DELETE /api/attachments/:id` | owner | Remove file and metadata |
| `GET /api/admin/users` | admin | now also returns `online` and `lastSeenAt` |

## 4. Server configuration (environment variables)

| Variable | Default | Meaning |
|----------|---------|---------|
| `MAX_ATTACHMENT_MB` | `100` | Largest allowed attachment, in megabytes (whole number ≥ 1) |
| `ATTACHMENTS_DIR` | `<folder of DATABASE_PATH>/attachments` | Where uploaded files are stored |
| `ONLINE_WINDOW_SECONDS` | `30` | A user counts as online if the server heard from them this recently (whole number, 10 – 3600) |

## 5. How the pieces work

**Uploads.** The browser sends the file as the raw body of a `POST` (XMLHttpRequest,
so progress can be shown). The server checks `Content-Length` first, then counts the
bytes as they stream to `<ATTACHMENTS_DIR>/<userId>/<attachmentId>.part`; above the
limit it aborts and deletes the partial file (`413`). When complete, the file is
renamed and the database row is inserted. Files are named by id, never by the
uploaded name.

**Reordering.** `@dnd-kit` gives the new order; the repo turns "put task X before task
Y" into one new fractional `orderKey` (`fractional-indexing`, already used for lists)
and a single `update` operation. Dropping on a sidebar list reuses the existing
`moveTodo`.

**Reminders.** A small scheduler in the client reads open tasks with a due date and
`remindBefore`, computes `dueAt − 7 d / 1 d / 1 h`, and fires every reminder whose time
has passed, the task is not yet due and which is not in the local `notified` table. It
runs on start, on tab focus and every 30 s. Notifications go through the service worker
(`registration.showNotification`, needed on mobile) with `new Notification` as fallback.
Requires HTTPS or `localhost` (`window.isSecureContext`).

**Presence.** The auth middleware records `last_seen_at` (at most one write per user per
5 s). The admin API turns it into `online` using `ONLINE_WINDOW_SECONDS`. The normal
5-second sync loop is the heartbeat.
