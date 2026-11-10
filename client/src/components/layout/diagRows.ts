import type { SyncStatus } from '../../sync/engine';
import type { DiagFlags } from '../../sync/diagnostics';
import { t } from '../../app/strings';

export const fmt = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

/** One flag: its name, its value and an optional tone (`ok`, `warn`, `busy`). */
export type DiagRow = [string, string, string?];

/** The flags of the admin's sync diagnostics, as rows to show. */
export function diagRows({
  flags,
  state,
  online,
  now,
}: {
  flags: Readonly<DiagFlags>;
  state: SyncStatus['state'];
  online: boolean;
  now: number;
}): DiagRow[] {
  const request = flags.inFlight
    ? t.syncDiag.waiting(flags.inFlight.what, fmt(now - flags.inFlight.since))
    : flags.lastRequest
      ? t.syncDiag.last(
          flags.lastRequest.what,
          fmt(flags.lastRequest.ms),
          flags.lastRequest.outcome,
        )
      : t.syncDiag.none;
  const probe = flags.lastProbe;
  const nextTry = flags.retry
    ? `${fmt(Math.max(0, flags.retry.at - now))} (#${flags.retry.attempt})`
    : flags.nextRun !== null && state !== 'auth_required'
      ? `${fmt(Math.max(0, flags.nextRun - now))} (${t.syncDiag.timer})`
      : t.syncDiag.none;

  return [
    [
      t.syncDiag.browser,
      flags.browserOnline ? t.syncDiag.online : t.syncDiag.offline,
      flags.browserOnline ? 'ok' : 'warn',
    ],
    [t.syncDiag.app, online ? t.syncDiag.online : t.syncDiag.offline, online ? 'ok' : 'warn'],
    [t.syncDiag.check, probe ? `${fmt(now - probe.at)} ${t.syncDiag.ago}` : t.syncDiag.none],
    [
      t.syncDiag.checkTook,
      probe
        ? `${probe.ok ? t.syncDiag.answered : t.syncDiag.noAnswer} ${fmt(probe.ms)}`
        : t.syncDiag.none,
      probe ? (probe.ok ? undefined : 'warn') : undefined,
    ],
    [t.syncDiag.sync, t.syncDiag.states[state], state === 'idle' ? 'ok' : 'warn'],
    [t.syncDiag.request, request, flags.inFlight ? 'busy' : undefined],
    [t.syncDiag.nextTry, nextTry],
    [t.syncDiag.reconnect, flags.reconnectMs === null ? t.syncDiag.none : fmt(flags.reconnectMs)],
    [t.syncDiag.outage, flags.outageMs === null ? t.syncDiag.none : fmt(flags.outageMs)],
  ];
}

/** The one-line state shown on the folded diagnostics header, with a tone for its dot. */
export function diagSummary({ state, online }: { state: SyncStatus['state']; online: boolean }): {
  text: string;
  tone: 'ok' | 'warn' | 'busy';
} {
  if (!online) return { text: t.sync.offline, tone: 'warn' };
  if (state === 'idle') return { text: t.sync.saved, tone: 'ok' };
  if (state === 'syncing') return { text: t.sync.syncing, tone: 'busy' };
  if (state === 'auth_required') return { text: t.syncDiag.states.auth_required, tone: 'warn' };
  return { text: t.sync.problem, tone: 'warn' };
}
