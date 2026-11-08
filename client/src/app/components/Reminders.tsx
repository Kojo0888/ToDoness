import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { ensurePush } from '../push';
import { useReminderMessages } from '../hooks';
import { reminderFeed, reminders } from '../services';
import { t } from '../strings';

/** Starts the reminder check while the app is open, and shows the messages (FR-45, FR-46). */
export function Reminders() {
  const [, navigate] = useLocation();

  useEffect(() => {
    reminders.start();
    void ensurePush(); // this device receives pushes for the logged-in user (FR-60)
    return () => reminders.stop();
  }, []);

  // A click on a pushed notification brings the app forward and sends it here (FR-62).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: unknown } | null;
      if (data?.type === 'navigate' && typeof data.url === 'string' && data.url.startsWith('/')) {
        navigate(data.url);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [navigate]);

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
