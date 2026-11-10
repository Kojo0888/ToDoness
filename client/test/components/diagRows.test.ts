/** The rows of the admin's sync diagnostics. */
import { describe, expect, it } from 'vitest';
import { diagRows, diagSummary } from '../../src/components/layout/diagRows';
import type { DiagFlags } from '../../src/sync/diagnostics';

const NOW = 1_000_000;
const base: DiagFlags = {
  browserOnline: true,
  inFlight: null,
  lastRequest: null,
  lastProbe: null,
  retry: null,
  nextRun: null,
  reconnectMs: null,
  outageMs: null,
};
const rows = (flags: Partial<DiagFlags>) =>
  diagRows({ flags: { ...base, ...flags }, state: 'idle', online: true, now: NOW });
const row = (flags: Partial<DiagFlags>, name: string) => rows(flags).find(([n]) => n === name);

describe('diagRows', () => {
  it('shows when the last check was and how long it took in two separate rows', () => {
    const flags = { lastProbe: { at: NOW - 3200, ok: true, ms: 120 } };
    expect(row(flags, 'Last check')?.[1]).toBe('3.2 s ago');
    expect(row(flags, 'Check took')?.[1]).toBe('answered 120 ms');
  });

  it('says when the last check got no answer', () => {
    const flags = { lastProbe: { at: NOW - 400, ok: false, ms: 3500 } };
    expect(row(flags, 'Last check')?.[1]).toBe('400 ms ago');
    expect(row(flags, 'Check took')?.[1]).toBe('no answer 3.5 s');
  });

  it('shows a dash for both without a check yet', () => {
    expect(row({}, 'Last check')?.[1]).toBe('–');
    expect(row({}, 'Check took')?.[1]).toBe('–');
  });

  it('keeps the other rows in order', () => {
    expect(rows({}).map(([n]) => n)).toEqual([
      'Browser says',
      'App found',
      'Last check',
      'Check took',
      'Sync',
      'Request',
      'Next try',
      'Online event → saved',
      'Outage (first failure → saved)',
    ]);
  });
});

describe('diagSummary (what the folded header shows)', () => {
  it('says all is well when idle and online', () => {
    expect(diagSummary({ state: 'idle', online: true })).toEqual({
      text: 'All changes saved',
      tone: 'ok',
    });
  });

  it('says offline first, whatever the sync state is', () => {
    expect(diagSummary({ state: 'idle', online: false })).toEqual({
      text: 'Offline',
      tone: 'warn',
    });
    expect(diagSummary({ state: 'syncing', online: false }).text).toBe('Offline');
  });

  it('names the other states and marks them as needing attention', () => {
    const syncing = diagSummary({ state: 'syncing', online: true });
    expect(syncing.tone).toBe('busy');
    const authRequired = diagSummary({ state: 'auth_required', online: true });
    expect(authRequired.tone).toBe('warn');
    expect(authRequired.text).not.toBe('All changes saved');
  });
});
