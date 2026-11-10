-- ntfy reminders (README, "Reminders through ntfy").

-- One topic per user. A topic works like a password on a shared ntfy server (anyone who
-- knows it can read it), so two users must never share one.
CREATE TABLE ntfy_topics (
    user_id        TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    topic          TEXT    NOT NULL UNIQUE,
    created_at     INTEGER NOT NULL
) STRICT;
