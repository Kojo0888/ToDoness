import type { SyncStatus } from '../../sync/engine';
import { t } from '../../app/strings';

export type SyncTone = 'ok' | 'busy' | 'warn';

/**
 * What the sync badge says and how it is coloured. The admin diagnostics header uses the
 * same, so the two can never disagree.
 */
export function syncSummary({
  online,
  state,
  pending,
}: {
  online: boolean;
  state: SyncStatus['state'];
  pending: number;
}): { text: string; tone: SyncTone } {
  const withPending = (text: string) =>
    pending > 0 ? `${text} · ${t.sync.pending(pending)}` : text;
  if (!online || state === 'offline') return { text: withPending(t.sync.offline), tone: 'warn' };
  if (state === 'error') return { text: withPending(t.sync.problem), tone: 'warn' };
  if (state === 'auth_required') {
    return { text: withPending(t.syncDiag.states.auth_required), tone: 'warn' };
  }
  if (state === 'syncing') return { text: t.sync.syncing, tone: 'busy' };
  if (pending > 0) return { text: t.sync.pending(pending), tone: 'busy' };
  return { text: t.sync.saved, tone: 'ok' };
}
