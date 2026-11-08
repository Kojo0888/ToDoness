import { session } from '../services';
import type { StoredUser } from '../session';
import { t } from '../strings';
import { useTheme, type Theme } from '../hooks';
import { useState } from 'react';
import { notificationSupport, requestNotificationPermission } from '../reminders';
import { ChangePassword } from './ChangePassword';

export function Settings({ user }: { user: StoredUser }) {
  const [theme, setTheme] = useTheme();
  const [support, setSupport] = useState(() => notificationSupport());
  return (
    <section className="page">
      <h2>{t.settings.title}</h2>
      <dl className="facts">
        <dt>{t.settings.account}</dt>
        <dd>
          {user.email}
          {user.role === 'admin' ? ' (admin)' : ''}
        </dd>
      </dl>
      <label>
        {t.settings.theme}
        <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
          {(Object.keys(t.settings.themes) as Theme[]).map((k) => (
            <option key={k} value={k}>
              {t.settings.themes[k]}
            </option>
          ))}
        </select>
      </label>
      <section className="card notifications" aria-label={t.settings.notifications.title}>
        <h3>{t.settings.notifications.title}</h3>
        <p>{t.settings.notifications.status[support]}</p>
        {support === 'default' && (
          <button
            type="button"
            onClick={() => void requestNotificationPermission().then(setSupport)}
          >
            {t.settings.notifications.enable}
          </button>
        )}
        <p className="hint">{t.settings.notifications.hint}</p>
      </section>
      <ChangePassword />
      <button type="button" onClick={() => void session.logout()}>
        {t.settings.logout}
      </button>
    </section>
  );
}
