import { useEffect, useState, useSyncExternalStore } from 'react';
import { useOnline, useSyncStatus } from '../hooks';
import { syncDiag } from '../services';
import { t } from '../strings';

const fmt = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const clock = (at: number) => {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

/**
 * Admin only: the flags and the log of the sync, shown above the "All changes saved"
 * indicator, to see exactly why going from offline to online takes as long as it does.
 */
export function SyncDiagnostics() {
  const { events, flags } = useSyncExternalStore(syncDiag.subscribe, syncDiag.getSnapshot);
  const status = useSyncStatus();
  const online = useOnline();
  const [logOpen, setLogOpen] = useState(false);

  // A clock for the live numbers (time a request has been waiting, countdown to the next try).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const request = flags.inFlight
    ? t.syncDiag.waiting(flags.inFlight.what, fmt(now - flags.inFlight.since))
    : flags.lastRequest
      ? t.syncDiag.last(
          flags.lastRequest.what,
          fmt(flags.lastRequest.ms),
          flags.lastRequest.outcome,
        )
      : t.syncDiag.none;
  const check = flags.lastProbe
    ? `${flags.lastProbe.ok ? t.syncDiag.answered : t.syncDiag.noAnswer} ${fmt(flags.lastProbe.ms)}, ${fmt(now - flags.lastProbe.at)} ${t.syncDiag.ago}`
    : t.syncDiag.none;
  const nextTry = flags.retry
    ? `${fmt(Math.max(0, flags.retry.at - now))} (#${flags.retry.attempt})`
    : t.syncDiag.none;

  const rows: [string, string, string?][] = [
    [
      t.syncDiag.browser,
      flags.browserOnline ? t.syncDiag.online : t.syncDiag.offline,
      flags.browserOnline ? 'ok' : 'warn',
    ],
    [t.syncDiag.app, online ? t.syncDiag.online : t.syncDiag.offline, online ? 'ok' : 'warn'],
    [t.syncDiag.check, check],
    [t.syncDiag.sync, t.syncDiag.states[status.state], status.state === 'idle' ? 'ok' : 'warn'],
    [t.syncDiag.request, request, flags.inFlight ? 'busy' : undefined],
    [t.syncDiag.nextTry, nextTry],
    [t.syncDiag.reconnect, flags.reconnectMs === null ? t.syncDiag.none : fmt(flags.reconnectMs)],
    [t.syncDiag.outage, flags.outageMs === null ? t.syncDiag.none : fmt(flags.outageMs)],
  ];

  return (
    <div className="sync-diag" data-testid="sync-diagnostics" aria-label={t.syncDiag.title}>
      <dl className="sync-flags">
        {rows.map(([name, value, tone]) => (
          <div key={name} className={tone ? `flag flag-${tone}` : 'flag'}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="link"
        aria-expanded={logOpen}
        onClick={() => setLogOpen(!logOpen)}
      >
        {logOpen ? t.syncDiag.hideLog : t.syncDiag.showLog}
      </button>
      {logOpen && (
        <div className="sync-log" role="log" aria-label={t.syncDiag.logTitle}>
          <div className="sync-log-head">
            <strong>{t.syncDiag.logTitle}</strong>
            <button type="button" onClick={() => setLogOpen(false)}>
              {t.syncDiag.closeLog}
            </button>
          </div>
          {events.length === 0 && <p className="hint">{t.syncDiag.empty}</p>}
          <ol reversed>
            {[...events].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <time>{clock(e.at)}</time> <span className="log-kind">{e.kind}</span> {e.detail}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
