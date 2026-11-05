-- ToDoness initial schema. See docs/DBModel.md section 3.

-- ============================================================
-- Users and sessions
-- ============================================================
CREATE TABLE users (
    id             TEXT    PRIMARY KEY,                    -- UUIDv7 (app generated)
    email          TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    password_hash  TEXT,                                   -- argon2id; NULL = admin reset it,
                                                           -- next login sets the new password
    role           TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at     INTEGER NOT NULL,                       -- epoch ms
    updated_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
    id             TEXT    PRIMARY KEY,                    -- hash of the random cookie value
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at     INTEGER NOT NULL,                       -- epoch ms (90 days)
    created_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ============================================================
-- Domain data (synced to the browser)
-- ============================================================
CREATE TABLE lists (
    id             TEXT    PRIMARY KEY,                    -- created on the client
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    is_inbox       INTEGER NOT NULL DEFAULT 0 CHECK (is_inbox IN (0, 1)),
    order_key      TEXT    NOT NULL COLLATE BINARY,        -- fractional index
    field_hlc      TEXT    NOT NULL DEFAULT '{}',          -- JSON {"name":"<hlc>", ...}
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER                                 -- marker for deleted rows
) STRICT;
CREATE INDEX lists_user_idx ON lists (user_id, order_key) WHERE deleted_at IS NULL;
-- At most one Inbox per user.
CREATE UNIQUE INDEX lists_one_inbox_idx ON lists (user_id) WHERE is_inbox = 1 AND deleted_at IS NULL;

CREATE TABLE todos (
    id             TEXT    PRIMARY KEY,                    -- created on the client
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id        TEXT    NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    title          TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
    notes          TEXT    NOT NULL DEFAULT '',
    done           INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    completed_at   INTEGER,                                -- set when done = 1
    due_at         INTEGER,                                -- epoch ms
    priority       INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
                                                           -- 0 none, 1 low, 2 medium, 3 high
    order_key      TEXT    NOT NULL COLLATE BINARY,        -- fractional index within the list
    field_hlc      TEXT    NOT NULL DEFAULT '{}',          -- JSON {"title":"<hlc>", ...}
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER                                 -- marker for deleted rows
) STRICT;
CREATE INDEX todos_list_order_idx ON todos (user_id, list_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX todos_due_idx        ON todos (user_id, due_at)             WHERE deleted_at IS NULL AND done = 0;

-- ============================================================
-- Sync infrastructure
-- ============================================================

-- Append-only feed. Clients pull "everything with server_seq > my cursor".
CREATE TABLE change_log (
    server_seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id      TEXT,                                   -- browser that sent the change
    entity         TEXT    NOT NULL CHECK (entity IN ('todo', 'list')),
    entity_id      TEXT    NOT NULL,
    op_type        TEXT    NOT NULL CHECK (op_type IN ('create', 'update', 'delete', 'restore')),
    patch          TEXT    NOT NULL,                       -- JSON: the accepted field values
    hlc            TEXT    NOT NULL,
    created_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX change_log_pull_idx ON change_log (user_id, server_seq);

-- Repeat-safety: every operation id the server has already applied.
CREATE TABLE processed_ops (
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    op_id          TEXT    NOT NULL,                       -- = outbox opId from the client
    processed_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, op_id)
) STRICT, WITHOUT ROWID;
