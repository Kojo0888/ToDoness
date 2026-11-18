-- Attachments of notes and events (docs/attachments/ImplementationPlan.md).
-- An attachment belongs to exactly one of a task, a note or an event. SQLite cannot make
-- `todo_id` nullable in place, so the table is rebuilt and its rows copied.
CREATE TABLE attachments_new (
    id             TEXT    PRIMARY KEY,                    -- UUIDv7, also the file name on disk
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    todo_id        TEXT    REFERENCES todos(id) ON DELETE CASCADE,
    note_id        TEXT    REFERENCES notes(id) ON DELETE CASCADE,
    event_id       TEXT    REFERENCES events(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    size           INTEGER NOT NULL CHECK (size >= 0),
    content_type   TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    CHECK ((todo_id IS NOT NULL) + (note_id IS NOT NULL) + (event_id IS NOT NULL) = 1)
) STRICT;
INSERT INTO attachments_new (id, user_id, todo_id, name, size, content_type, created_at)
    SELECT id, user_id, todo_id, name, size, content_type, created_at FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;
CREATE INDEX attachments_todo_idx ON attachments (todo_id) WHERE todo_id IS NOT NULL;
CREATE INDEX attachments_note_idx ON attachments (note_id) WHERE note_id IS NOT NULL;
CREATE INDEX attachments_event_idx ON attachments (event_id) WHERE event_id IS NOT NULL;
