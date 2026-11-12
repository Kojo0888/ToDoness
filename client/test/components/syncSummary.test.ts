/** One mapping from the sync state to words and a tone, for the badge and the diagnostics. */
import { describe, expect, it } from 'vitest';
import { syncSummary } from '../../src/components/layout/syncSummary';

const s = (over: Partial<Parameters<typeof syncSummary>[0]> = {}) =>
  syncSummary({ online: true, state: 'idle', pending: 0, ...over });

describe('syncSummary', () => {
  it('all saved', () => {
    expect(s()).toEqual({ text: 'All changes saved', tone: 'ok' });
  });

  it('offline when the browser says so, or when the server cannot be reached', () => {
    expect(s({ online: false })).toEqual({ text: 'Offline', tone: 'warn' });
    expect(s({ state: 'offline' })).toEqual({ text: 'Offline', tone: 'warn' });
    expect(s({ state: 'offline', pending: 2 }).text).toBe('Offline · 2 changes pending');
  });

  it('an idle sync with queued changes is not "all saved"', () => {
    expect(s({ pending: 1 })).toEqual({ text: '1 change pending', tone: 'busy' });
  });

  it('a problem, with the pending count', () => {
    expect(s({ state: 'error' })).toEqual({ text: 'Sync problem, retrying', tone: 'warn' });
    expect(s({ state: 'error', pending: 3 }).text).toBe(
      'Sync problem, retrying · 3 changes pending',
    );
  });

  it('syncing', () => {
    expect(s({ state: 'syncing', pending: 4 })).toEqual({ text: 'Syncing…', tone: 'busy' });
  });

  it('a needed login is a warning', () => {
    expect(s({ state: 'auth_required' }).tone).toBe('warn');
  });

  describe('data comparison (docs/recovery-upload FR-172)', () => {
    it('has its own text and tone', () => {
      expect(s({ comparing: true })).toEqual({ text: 'Data comparison', tone: 'compare' });
    });

    it('wins over syncing, pending changes and all saved', () => {
      expect(s({ comparing: true, state: 'syncing' }).tone).toBe('compare');
      expect(s({ comparing: true, pending: 3 })).toEqual({
        text: 'Data comparison',
        tone: 'compare',
      });
    });

    it('offline, a sync problem and a needed login still show first', () => {
      expect(s({ comparing: true, online: false }).text).toBe('Offline');
      expect(s({ comparing: true, state: 'error' }).tone).toBe('warn');
      expect(s({ comparing: true, state: 'auth_required' }).tone).toBe('warn');
    });
  });
});
