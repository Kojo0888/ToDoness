-- Web push (docs/v1/TechStack.md section 6).

-- Small key/value store for things the server creates itself (the VAPID keys).
CREATE TABLE app_settings (
    key            TEXT    PRIMARY KEY,
    value          TEXT    NOT NULL
) STRICT;

-- One row per browser that wants pushes. A browser has one endpoint, so when another
-- user logs in there, the row moves to them (endpoint is unique).
CREATE TABLE push_subscriptions (
    id             TEXT    PRIMARY KEY,
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint       TEXT    NOT NULL UNIQUE,
    p256dh         TEXT    NOT NULL,
    auth           TEXT    NOT NULL,
    created_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Which reminders were already pushed: once per task + due date + choice.
CREATE TABLE sent_reminders (
    todo_id        TEXT    NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    due_at         INTEGER NOT NULL,
    remind_before  TEXT    NOT NULL,
    sent_at        INTEGER NOT NULL,
    PRIMARY KEY (todo_id, due_at, remind_before)
) STRICT, WITHOUT ROWID;
