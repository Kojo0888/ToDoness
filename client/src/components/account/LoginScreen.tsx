import { useState, type FormEvent } from 'react';
import { session } from '../../app/container';
import type { AuthResult } from '../../services/session';
import { offerSignUpAgain } from '../../lib/signUpAgain';
import { t } from '../../app/strings';

interface Props {
  email?: string;
  reason?: 'expired' | 'logged_out';
}

export function LoginScreen({ email: initialEmail = '', reason }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** A failed login that may mean the server was set up again (docs/recovery-upload FR-166). */
  const [mayBeReset, setMayBeReset] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(as: 'login' | 'register') {
    setBusy(true);
    setError(null);
    setMayBeReset(false);
    const result: AuthResult =
      as === 'login'
        ? await session.login(email, password)
        : await session.register(email, password);
    if (!result.ok) {
      const base = t.login.errors[result.error];
      const wait = result.retryAfterSec ? ` (${Math.ceil(result.retryAfterSec / 60)} min)` : '';
      setError(base + wait);
      setMayBeReset(
        offerSignUpAgain({
          mode: as,
          reason,
          storedEmail: initialEmail || undefined,
          typedEmail: email,
          error: result.error,
        }),
      );
      setBusy(false);
    }
    // On success the session changes state and this screen goes away.
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(mode);
  }

  return (
    <main className="auth">
      <h1>{t.appName}</h1>
      <form onSubmit={submit} className="card">
        <h2>{mode === 'login' ? t.login.titleLogin : t.login.titleRegister}</h2>
        {reason === 'expired' && <p className="notice">{t.login.expired}</p>}
        {reason === 'logged_out' && <p className="notice">{t.login.loggedOut}</p>}

        <label>
          {t.login.email}
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          {t.login.password}
          <input
            type="password"
            name="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p className="hint">{mode === 'login' ? t.login.resetHint : t.login.passwordHint}</p>

        {error && (
          <p className="error" role="alert">
            {error}
            {mayBeReset && ` ${t.login.serverReset}`}
          </p>
        )}
        {mayBeReset && (
          <button type="button" disabled={busy} onClick={() => void send('register')}>
            {t.login.signUpAgain}
          </button>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {mode === 'login' ? t.login.submitLogin : t.login.submitRegister}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
            setMayBeReset(false);
          }}
        >
          {mode === 'login' ? t.login.toRegister : t.login.toLogin}
        </button>
      </form>
    </main>
  );
}
