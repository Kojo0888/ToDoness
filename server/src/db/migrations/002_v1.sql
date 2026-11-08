-- ToDoness v1 changes. See docs/v1/TechStack.md section 2.

-- Public lists: readable by every logged-in user (synced field).
ALTER TABLE lists ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1));
CREATE INDEX lists_public_idx ON lists (is_public) WHERE is_public = 1 AND deleted_at IS NULL;

-- Reminder: notify this long before the due date (synced field).
ALTER TABLE todos ADD COLUMN remind_before TEXT CHECK (remind_before IN ('week', 'day', 'hour'));

-- Presence: the last time the server heard from the user (not synced).
ALTER TABLE users ADD COLUMN last_seen_at INTEGER;

-- Attachments: metadata only. The file itself lives in ATTACHMENTS_DIR/<user_id>/<id>.
-- Not part of the sync feed (online only).
CREATE TABLE attachments (
    id             TEXT    PRIMARY KEY,                    -- UUIDv7, also the file name on disk
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    todo_id        TEXT    NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    size           INTEGER NOT NULL CHECK (size >= 0),
    content_type   TEXT    NOT NULL,
    created_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX attachments_todo_idx ON attachments (todo_id);
