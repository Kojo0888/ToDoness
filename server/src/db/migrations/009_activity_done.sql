-- Done activities (docs/plan/PRD.md section 8, FR-153). A column with a default needs no
-- rebuild: existing activities are not done.
ALTER TABLE activities ADD COLUMN done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1));
