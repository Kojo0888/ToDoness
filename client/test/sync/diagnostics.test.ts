import { describe, expect, it, vi } from 'vitest';
import { createSyncDiagnostics } from '../../src/sync/diagnostics';

function setup() {
  let t = 1000;
  const now = () => t;
  const diag = createSyncDiagnostics(now);
  return { diag, advance: (ms: number) => (t += ms) };
}

describe('sync diagnostics (admin)', () => {
  it('keeps a log with times, and at most the last 100 lines', () => {
    const { diag, advance } = setup();
    for (let i = 0; i < 150; i++) {
      advance(1);
      diag.log('x', `line ${i}`);
    }
    const { events } = diag.getSnapshot();
    expect(events).toHaveLength(100);
    expect(events[0]!.detail).toBe('line 50');
    expect(events.at(-1)).toMatchObject({ kind: 'x', detail: 'line 149', at: 1150 });
  });

  it('tracks the request that is in flight and the last one that finished', () => {
    const { diag, advance } = setup();
    const id = diag.requestStart('push');
    expect(diag.getSnapshot().flags.inFlight).toMatchObject({ what: 'push', since: 1000 });
    advance(250);
    diag.requestEnd(id, 'ok');
    expect(diag.getSnapshot().flags.inFlight).toBeNull();
    expect(diag.getSnapshot().flags.lastRequest).toEqual({ what: 'push', ms: 250, outcome: 'ok' });
  });

  it('remembers the planned retry until a run succeeds', () => {
    const { diag, advance } = setup();
    diag.runEnd(false, 'offline');
    diag.retryScheduled(1000, 2);
    expect(diag.getSnapshot().flags.retry).toEqual({ at: 2000, delayMs: 1000, attempt: 2 });
    advance(1000);
    diag.runEnd(true, 'saved');
    expect(diag.getSnapshot().flags.retry).toBeNull();
  });

  it('measures online event → saved (reconnect) and first failure → saved (outage)', () => {
    const { diag, advance } = setup();
    diag.runEnd(false, 'offline'); // outage starts at 1000
    advance(8000);
    diag.browserOnline(true); // 9000
    advance(1200);
    diag.runEnd(true, 'saved'); // 10200
    expect(diag.getSnapshot().flags).toMatchObject({ reconnectMs: 1200, outageMs: 9200 });

    advance(5000);
    diag.runEnd(true, 'saved again'); // nothing to measure: values stay
    expect(diag.getSnapshot().flags).toMatchObject({ reconnectMs: 1200, outageMs: 9200 });
  });

  it('a silent recovery has an outage time but no reconnect time', () => {
    const { diag, advance } = setup();
    diag.runEnd(false, 'offline');
    advance(4000);
    diag.runEnd(true, 'saved');
    expect(diag.getSnapshot().flags).toMatchObject({ reconnectMs: null, outageMs: 4000 });
  });

  it('records what the browser reports', () => {
    const { diag } = setup();
    diag.browserOnline(false);
    expect(diag.getSnapshot().flags.browserOnline).toBe(false);
    expect(diag.getSnapshot().events.at(-1)).toMatchObject({
      kind: 'browser',
      detail: 'offline event',
    });
  });

  it('gives a new snapshot after every change and tells subscribers', () => {
    const { diag } = setup();
    const listener = vi.fn();
    const off = diag.subscribe(listener);
    const first = diag.getSnapshot();
    diag.log('a');
    expect(diag.getSnapshot()).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    diag.log('b');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
