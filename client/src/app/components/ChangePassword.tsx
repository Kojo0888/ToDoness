import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN } from '@todoness/shared';
import { useOnline } from '../hooks';
import { session } from '../services';
import { t } from '../strings';

/** Settings: a logged-in user changes their own password (FR-29 – FR-31). */
export function ChangePassword() {
  const online = useOnline();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next !== repeat) {
      setError(t.settings.password.mismatch);
      return;
    }
    setError(null);
    setBusy(true);
    const result = await session.changePassword(current, next);
    setBusy(false);
    if (result.ok) {
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
    } else {
      setError(t.settings.password.errors[result.error]);
    }
  }

  return (
    <form className="card password-form" onSubmit={(e) => void submit(e)}>
      <h3>{t.settings.password.title}</h3>
      <label>
        {t.settings.password.current}
        <input
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label>
        {t.settings.password.next}
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label>
        {t.settings.password.repeat}
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>
      <p className="hint">{t.settings.password.hint}</p>
      {!online && <p className="notice">{t.settings.password.needsConnection}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {done && <p role="status">{t.settings.password.done}</p>}
      <button type="submit" className="primary" disabled={busy || !online}>
        {busy ? t.settings.password.working : t.settings.password.submit}
      </button>
    </form>
  );
}
