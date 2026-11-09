import { session } from '../../app/container';
import type { StoredUser } from '../../services/session';
import { t } from '../../app/strings';
import { useTheme, type Theme } from '../../app/hooks';
import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState, type PushState } from '../../services/push';
import { notificationSupport, requestNotificationPermission } from '../../services/reminders';
import { ChangePassword } from './ChangePassword';

export function Settings({ user }: { user: StoredUser }) {
  const [theme, setTheme] = useTheme();
  const [support, setSupport] = useState(() => notificationSupport());
  const [push, setPush] = useState<PushState | undefined>(undefined);
  const [pushFailed, setPushFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void pushState().then((s) => !cancelled && setPush(s));
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setPushFailed(false);
    const state = await enablePush();
    setPush(state);
    setSupport(notificationSupport());
    setPushFailed(state === 'off');
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    setPush(await disablePush());
    setBusy(false);
  }
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
      <section className="card notifications" aria-label={t.settings.push.title}>
        <h3>{t.settings.push.title}</h3>
        <p>{t.settings.push.text}</p>
        {push !== undefined && <p role="status">{t.settings.push.status[push]}</p>}
        {push === 'off' && (
          <button type="button" disabled={busy} onClick={() => void turnOn()}>
            {t.settings.push.enable}
          </button>
        )}
        {push === 'on' && (
          <button type="button" disabled={busy} onClick={() => void turnOff()}>
            {t.settings.push.disable}
          </button>
        )}
        {pushFailed && (
          <p className="error" role="alert">
            {t.settings.push.failed}
          </p>
        )}
        <p className="hint">{t.settings.push.hint}</p>
      </section>
      <ChangePassword />
      <button type="button" onClick={() => void session.logout()}>
        {t.settings.logout}
      </button>
    </section>
  );
}
