-- Note lists (docs/note-lists/PRD.md, decision L1).
-- A list belongs to the Tasks or the Notes module; set at creation, never changed.
ALTER TABLE lists ADD COLUMN module TEXT NOT NULL DEFAULT 'tasks' CHECK (module IN ('tasks', 'notes'));

-- One default list per user AND module: the task Inbox and "My notes" (decision L2).
DROP INDEX lists_one_inbox_idx;
CREATE UNIQUE INDEX lists_one_inbox_idx ON lists (user_id, module) WHERE is_inbox = 1 AND deleted_at IS NULL;

-- The note list of a note; NULL = the default note list "My notes".
ALTER TABLE notes ADD COLUMN list_id TEXT;
