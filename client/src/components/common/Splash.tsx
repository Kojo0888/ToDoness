import { session } from '../../app/container';
import { t } from '../../app/strings';

export function Splash() {
  return (
    <main className="auth">
      <h1>{t.appName}</h1>
      <p role="status">{t.loading}</p>
    </main>
  );
}

export function OfflineNoSession() {
  return (
    <main className="auth">
      <h1>{t.appName}</h1>
      <div className="card">
        <h2>{t.offlineNoSession.title}</h2>
        <p>{t.offlineNoSession.text}</p>
        <button type="button" className="primary" onClick={() => void session.boot()}>
          {t.offlineNoSession.retry}
        </button>
      </div>
    </main>
  );
}

export function InitialSync({ error }: { error?: 'offline' | 'server' }) {
  return (
    <main className="auth">
      <h1>{t.appName}</h1>
      <div className="card">
        {error ? (
          <>
            <p role="alert">{error === 'offline' ? t.initialSync.offline : t.initialSync.server}</p>
            <button
              type="button"
              className="primary"
              onClick={() => void session.retryInitialSync()}
            >
              {t.initialSync.retry}
            </button>
          </>
        ) : (
          <p role="status">{t.initialSync.loading}</p>
        )}
      </div>
    </main>
  );
}
