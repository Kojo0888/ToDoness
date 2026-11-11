import { session } from '../../app/container';
import type { StoredUser } from '../../services/session';
import { t } from '../../app/strings';
import { useTheme, type Theme } from '../../app/hooks';
import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState, type PushState } from '../../services/push';
import { notificationSupport, requestNotificationPermission } from '../../services/reminders';
import { browserStorage } from '../../lib/modules';
import { localNotificationsOn, setLocalNotifications } from '../../lib/notifyPref';
import { SettingRow } from '../common/SettingRow';
import { ChangePassword } from './ChangePassword';
import { NtfySettings } from './NtfySettings';

export function Settings({ user }: { user: StoredUser }) {
  const [theme, setTheme] = useTheme();
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
      {/* Every notification channel is one row with the same switch (docs/note-lists FR-119). */}
      <LocalNotificationsRow />
      <PushRow />
      <NtfySettings />
      <ChangePassword />
      <button type="button" onClick={() => void session.logout()}>
        {t.settings.logout}
      </button>
    </section>
  );
}

/** In-app messages and system notifications from the open app (FR-120). */
function LocalNotificationsRow() {
  const [on, setOn] = useState(() => localNotificationsOn(browserStorage()));
  const [support, setSupport] = useState(() => notificationSupport());
  const s = t.settings.notifications;

  async function change(next: boolean) {
    setLocalNotifications(browserStorage(), next);
    setOn(next);
    // Turning on is a click: the moment the browser allows asking for permission.
    if (next && support === 'default') setSupport(await requestNotificationPermission());
  }

  const status = !on
    ? s.off
    : support === 'granted' || support === 'default'
      ? s.status[support]
      : `${s.status[support]} ${s.onInAppOnly}`;

  return (
    <SettingRow
      title={s.title}
      info={s.text}
      checked={on}
      onChange={(v) => void change(v)}
      status={status}
    >
      {on && support === 'default' && (
        <button type="button" onClick={() => void requestNotificationPermission().then(setSupport)}>
          {s.enable}
        </button>
      )}
    </SettingRow>
  );
}

/** Web push for this device (FR-121). */
function PushRow() {
  const [push, setPush] = useState<PushState | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void pushState().then((s) => !cancelled && setPush(s));
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(on: boolean) {
    setBusy(true);
    setFailed(false);
    if (on) {
      const state = await enablePush();
      setPush(state);
      setFailed(state === 'off');
    } else {
      setPush(await disablePush());
    }
    setBusy(false);
  }

  const s = t.settings.push;
  return (
    <SettingRow
      title={s.title}
      info={s.text}
      checked={push === 'on'}
      disabled={busy || (push !== 'on' && push !== 'off')}
      onChange={(v) => void change(v)}
      status={failed ? s.failed : push !== undefined ? s.status[push] : undefined}
      statusKind={failed ? 'error' : 'info'}
    />
  );
}
