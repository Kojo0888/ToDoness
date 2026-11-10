import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useOnline, useSyncStatus } from '../../app/hooks';
import { db, syncDiag } from '../../app/container';
import { t } from '../../app/strings';
import { getQueuedChanges } from '../../data/queries';
import { browserStorage } from '../../lib/modules';
import { diagRows, diagSummary } from './diagRows';

const clock = (at: number) => {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

/** Whether the admin left the diagnostics open on this device. */
const OPEN_KEY = 'todoness.syncDiagOpen';
const readOpen = () => {
  try {
    return browserStorage()?.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
};
const saveOpen = (open: boolean) => {
  try {
    browserStorage()?.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Blocked storage: it just is not remembered.
  }
};

/**
 * Admin only: the flags and the log of the sync, shown above the "All changes saved"
 * indicator, to see exactly why going from offline to online takes as long as it does.
 * Folded away behind a button until the admin opens it.
 */
export function SyncDiagnostics() {
  const [open, setOpen] = useState(readOpen);
  const status = useSyncStatus();
  const online = useOnline();
  const summary = diagSummary({ state: status.state, online });
  const toggle = () => {
    saveOpen(!open);
    setOpen(!open);
  };
  return (
    <div className="sync-diag-wrap">
      <button type="button" className="diag-toggle" aria-expanded={open} onClick={toggle}>
        <svg
          className="diag-chevron"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M9 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <span className="diag-title">{t.syncDiag.toggle}</span>
        {/* Just a dot (the sync badge below says it in words); the tooltip has the text. */}
        <span
          className={`diag-dot diag-dot-${summary.tone}`}
          title={summary.text}
          aria-hidden="true"
        />
      </button>
      {open && <DiagnosticsPanel />}
    </div>
  );
}

function DiagnosticsPanel() {
  const { events, flags } = useSyncExternalStore(syncDiag.subscribe, syncDiag.getSnapshot);
  const status = useSyncStatus();
  const online = useOnline();
  const [logOpen, setLogOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const queuedCount = useLiveQuery(async () => {
    const q = await getQueuedChanges(db);
    return q.outbox.length + q.publicOutbox.length;
  }, []);

  // A clock for the live numbers (time a request has been waiting, countdown to the next try).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const rows = diagRows({ flags, state: status.state, online, now });

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
      <div className="seg" role="group" aria-label={t.syncDiag.title}>
        <button
          type="button"
          className="seg-btn"
          aria-expanded={logOpen}
          onClick={() => setLogOpen(!logOpen)}
        >
          {logOpen ? t.syncDiag.hideLog : t.syncDiag.showLog}
          <span className="seg-count" aria-hidden="true">
            {events.length}
          </span>
        </button>
        <button
          type="button"
          className="seg-btn"
          aria-expanded={queueOpen}
          onClick={() => setQueueOpen(!queueOpen)}
        >
          {t.syncDiag.showQueue}
          <span className="seg-count" aria-hidden="true">
            {queuedCount ?? 0}
          </span>
        </button>
      </div>
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
      {queueOpen && <QueuedChanges onClose={() => setQueueOpen(false)} />}
    </div>
  );
}

/** Every queued change exactly as stored on this device, updated live. */
function QueuedChanges({ onClose }: { onClose: () => void }) {
  const queued = useLiveQuery(() => getQueuedChanges(db), []);
  return (
    <section className="sync-log sync-queue" aria-label={t.syncDiag.queueTitle}>
      <div className="sync-log-head">
        <strong>{t.syncDiag.queueTitle}</strong>
        <button type="button" onClick={onClose}>
          {t.syncDiag.closeQueue}
        </button>
      </div>
      <p className="hint">{t.syncDiag.queueHint}</p>
      {queued && <pre>{JSON.stringify(queued, null, 2)}</pre>}
    </section>
  );
}
