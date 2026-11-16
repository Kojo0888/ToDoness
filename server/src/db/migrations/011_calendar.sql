-- Calendar module (docs/calendar/ImplementationPlan.md, "Server").

-- A calendar: a named, coloured set of events, synced like plans.
CREATE TABLE calendars (
    id             TEXT    PRIMARY KEY,                    -- created on the client
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    color          TEXT    NOT NULL DEFAULT 'blue'
                           CHECK (color IN ('blue', 'green', 'amber', 'red', 'purple', 'teal')),
    order_key      TEXT    NOT NULL COLLATE BINARY,        -- fractional index, new calendars last
    field_hlc      TEXT    NOT NULL DEFAULT '{}',          -- JSON {"name":"<hlc>", ...}
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER                                 -- marker for deleted rows
) STRICT;
CREATE INDEX calendars_user_idx ON calendars (user_id, order_key) WHERE deleted_at IS NULL;

-- An event: a title, a first day, optional start / end time (NULL = all day) and, for an
-- all-day event, how many days it lasts. Times are 'HH:MM' in the device's local time.
CREATE TABLE events (
    id             TEXT    PRIMARY KEY,
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    calendar_id    TEXT    NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title          TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    start_day      TEXT    NOT NULL CHECK (length(start_day) = 10),   -- YYYY-MM-DD
    days           INTEGER NOT NULL DEFAULT 1 CHECK (days BETWEEN 1 AND 366),
    start_time     TEXT    CHECK (start_time IS NULL OR length(start_time) = 5),
    end_time       TEXT    CHECK (end_time IS NULL OR length(end_time) = 5),
    place          TEXT    NOT NULL DEFAULT '' CHECK (length(place) <= 200),
    field_hlc      TEXT    NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER
) STRICT;
CREATE INDEX events_calendar_idx ON events (user_id, calendar_id, start_day) WHERE deleted_at IS NULL;

-- The change feed must carry calendars and events. Rebuilt as in migration 008: every row
-- keeps its server_seq (client cursors stay valid) and the AUTOINCREMENT counter carries
-- over, so a number is never handed out twice.
CREATE TABLE change_log_new (
    server_seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id      TEXT,
    entity         TEXT    NOT NULL CHECK (entity IN ('todo', 'list', 'note', 'plan', 'activity', 'calendar', 'event')),
    entity_id      TEXT    NOT NULL,
    op_type        TEXT    NOT NULL CHECK (op_type IN ('create', 'update', 'delete', 'restore')),
    patch          TEXT    NOT NULL,
    hlc            TEXT    NOT NULL,
    created_at     INTEGER NOT NULL
) STRICT;
INSERT INTO change_log_new (server_seq, user_id, client_id, entity, entity_id, op_type, patch, hlc, created_at)
    SELECT server_seq, user_id, client_id, entity, entity_id, op_type, patch, hlc, created_at
      FROM change_log ORDER BY server_seq;
DELETE FROM sqlite_sequence WHERE name = 'change_log_new';
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'change_log_new', seq FROM sqlite_sequence WHERE name = 'change_log';
DROP TABLE change_log;
ALTER TABLE change_log_new RENAME TO change_log;
CREATE INDEX change_log_pull_idx ON change_log (user_id, server_seq);
