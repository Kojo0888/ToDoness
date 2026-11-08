import { useEffect } from 'react';
import { Link } from 'wouter';
import { useReminderMessages } from '../hooks';
import { reminderFeed, reminders } from '../services';
import { t } from '../strings';

/** Starts the reminder check while the app is open, and shows the messages (FR-45, FR-46). */
export function Reminders() {
  useEffect(() => {
    reminders.start();
    return () => reminders.stop();
  }, []);

  const messages = useReminderMessages();
  if (messages.length === 0) return null;

  return (
    <div
      className="reminder-region"
      role="region"
      aria-label={t.reminder.region}
      aria-live="polite"
    >
      {messages.map((m) => (
        <div key={m.key} className="reminder" role="status">
          <div>
            <strong>
              {t.reminder.label}: {m.title}
            </strong>
            <div className="hint">{m.body}</div>
          </div>
          <Link href={m.href} onClick={() => reminderFeed.dismiss(m.key)}>
            {t.reminder.open}
          </Link>
          <button type="button" onClick={() => reminderFeed.dismiss(m.key)}>
            {t.reminder.dismiss}
          </button>
        </div>
      ))}
    </div>
  );
}
