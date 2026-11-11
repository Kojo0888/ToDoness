-- Plan module (docs/plan/ImplementationPlan.md, "Design").

-- A plan: a timeline of activities, synced like lists.
CREATE TABLE plans (
    id             TEXT    PRIMARY KEY,                    -- created on the client
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    order_key      TEXT    NOT NULL COLLATE BINARY,        -- fractional index, new plans last
    field_hlc      TEXT    NOT NULL DEFAULT '{}',          -- JSON {"name":"<hlc>", ...}
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER                                 -- marker for deleted rows
) STRICT;
CREATE INDEX plans_user_idx ON plans (user_id, order_key) WHERE deleted_at IS NULL;

-- An activity of a plan: a name, a start day and a duration in days (the end day is
-- start + days - 1), and the activities that must end before it starts.
CREATE TABLE activities (
    id             TEXT    PRIMARY KEY,
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id        TEXT    NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    start_day      TEXT    NOT NULL CHECK (length(start_day) = 10),   -- YYYY-MM-DD
    days           INTEGER NOT NULL DEFAULT 1 CHECK (days BETWEEN 1 AND 3660),
    depends_on     TEXT    NOT NULL DEFAULT '[]',          -- JSON array of activity ids
    order_key      TEXT    NOT NULL COLLATE BINARY,        -- fractional index, row order
    field_hlc      TEXT    NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER
) STRICT;
CREATE INDEX activities_plan_idx ON activities (user_id, plan_id, order_key) WHERE deleted_at IS NULL;

-- The change feed must carry plans and activities. SQLite cannot change a CHECK, so the
-- table is rebuilt as in migration 004: every row keeps its server_seq (client cursors stay
-- valid), and the AUTOINCREMENT counter carries over, so a number is never handed out twice.
CREATE TABLE change_log_new (
    server_seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id      TEXT,
    entity         TEXT    NOT NULL CHECK (entity IN ('todo', 'list', 'note', 'plan', 'activity')),
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
