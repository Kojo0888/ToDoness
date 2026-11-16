-- Public calendars and event descriptions (docs/calendar/PRD.md section 7).

-- A public calendar is readable by every logged-in user (read-only, FR-241).
ALTER TABLE calendars ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1));

-- Free text of an event (FR-246).
ALTER TABLE events ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000);
