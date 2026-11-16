-- Repeating events and event reminders (docs/calendar/PRD.md section 6).

-- How an event repeats, until which day, which reminders it has (comma-separated, in the order
-- day,hour,10min,start; '' = none) and the time zone of the device that saved it ('' = unknown).
ALTER TABLE events ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none'
    CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly', 'yearly'));
ALTER TABLE events ADD COLUMN repeat_until TEXT CHECK (repeat_until IS NULL OR length(repeat_until) = 10);
ALTER TABLE events ADD COLUMN reminders TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN tz TEXT NOT NULL DEFAULT '' CHECK (length(tz) <= 64);

-- Which event reminders were already pushed: once per event + occurrence + choice + start
-- moment (a moved event is a new reminder, like a task with a new due date).
CREATE TABLE sent_event_reminders (
    event_id       TEXT    NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occurrence     TEXT    NOT NULL,
    remind         TEXT    NOT NULL,
    start_ms       INTEGER NOT NULL,
    sent_at        INTEGER NOT NULL,
    PRIMARY KEY (event_id, occurrence, remind, start_ms)
) STRICT, WITHOUT ROWID;
