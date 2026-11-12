-- Activity groups (docs/plan/PRD.md section 11, FR-174). The group an activity is part of;
-- NULL = top level. Not a foreign key: like `depends_on`, it is merged between devices and
-- may name anything; the app ignores a parent that cannot count (decision P21).
ALTER TABLE activities ADD COLUMN parent_id TEXT;
