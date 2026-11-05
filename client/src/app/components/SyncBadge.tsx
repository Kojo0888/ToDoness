import { useLiveQuery } from 'dexie-react-hooks';
import { countPending } from '../../data/queries';
import { useOnline, useSyncStatus } from '../hooks';
import { db } from '../services';
import { t } from '../strings';

/** Shows whether the data is safe (FR-18). */
export function SyncBadge() {
  const status = useSyncStatus();
  const online = useOnline();
  const pending = useLiveQuery(() => countPending(db), [], 0);

  let text: string;
  let tone: 'ok' | 'busy' | 'warn';
  if (!online || status.state === 'offline') {
    text = pending > 0 ? `${t.sync.offline} · ${t.sync.pending(pending)}` : t.sync.offline;
    tone = 'warn';
  } else if (status.state === 'error') {
    text = pending > 0 ? `${t.sync.problem} · ${t.sync.pending(pending)}` : t.sync.problem;
    tone = 'warn';
  } else if (status.state === 'syncing') {
    text = t.sync.syncing;
    tone = 'busy';
  } else if (pending > 0) {
    text = t.sync.pending(pending);
    tone = 'busy';
  } else {
    text = t.sync.saved;
    tone = 'ok';
  }

  return (
    <p
      className={`sync-badge sync-${tone}`}
      role="status"
      aria-live="polite"
      data-testid="sync-status"
    >
      <span className="sync-dot" aria-hidden="true" />
      {text}
    </p>
  );
}
