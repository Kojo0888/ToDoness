import { useLiveQuery } from 'dexie-react-hooks';
import { countPending } from '../../data/queries';
import { useDataComparison, useOnline, useSyncStatus } from '../../app/hooks';
import { db } from '../../app/container';
import { SyncDiagnostics } from './SyncDiagnostics';
import { syncSummary } from './syncSummary';

/** Shows whether the data is safe (FR-18). */
export function SyncBadge({ admin = false }: { admin?: boolean }) {
  const status = useSyncStatus();
  const online = useOnline();
  const pending = useLiveQuery(() => countPending(db), [], 0);
  const comparing = useDataComparison();

  const { text, tone } = syncSummary({ online, state: status.state, pending, comparing });

  return (
    <>
      {admin && <SyncDiagnostics />}
      <p
        className={`sync-badge sync-${tone}`}
        role="status"
        aria-live="polite"
        data-testid="sync-status"
      >
        <span className="sync-dot" aria-hidden="true" />
        {text}
      </p>
    </>
  );
}
