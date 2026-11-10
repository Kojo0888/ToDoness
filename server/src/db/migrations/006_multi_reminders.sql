-- Several reminders per task (docs/ui-refresh/PRD.md, FR-112).
-- A comma-separated list in the order week,day,hour; '' = no reminder.
-- The v1 column `remind_before` (one value, with a CHECK) is copied and then left unused.
ALTER TABLE todos ADD COLUMN reminders TEXT NOT NULL DEFAULT '';
UPDATE todos SET reminders = remind_before WHERE remind_before IS NOT NULL;
