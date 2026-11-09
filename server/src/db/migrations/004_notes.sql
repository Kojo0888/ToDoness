-- Notes module (docs/notes/ImplementationPlan.md, "Design").

-- A note: a simple text box, synced like tasks and lists.
CREATE TABLE notes (
    id             TEXT    PRIMARY KEY,                    -- created on the client
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text           TEXT    NOT NULL DEFAULT '' CHECK (length(text) <= 20000),
    is_public      INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
    order_key      TEXT    NOT NULL COLLATE BINARY,        -- fractional index, newest first
    field_hlc      TEXT    NOT NULL DEFAULT '{}',          -- JSON {"text":"<hlc>", ...}
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER                                 -- marker for deleted rows
) STRICT;
CREATE INDEX notes_user_idx ON notes (user_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX notes_public_idx ON notes (is_public) WHERE is_public = 1 AND deleted_at IS NULL;

-- The change feed must carry notes. SQLite cannot change a CHECK, so the table is rebuilt.
-- Every row keeps its server_seq (client cursors stay valid), and the AUTOINCREMENT counter
-- carries over, so a number is never handed out twice.
CREATE TABLE change_log_new (
    server_seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id      TEXT,
    entity         TEXT    NOT NULL CHECK (entity IN ('todo', 'list', 'note')),
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
