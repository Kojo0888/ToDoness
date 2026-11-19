import { describe, expect, it } from 'vitest';
import { createLinkQuality } from '../../src/sync/linkQuality';

const good = { ok: true, ms: 100 };
const slow = { ok: true, ms: 2000 };
const failed = { ok: false, ms: 3500 };

describe('link quality (docs/unstable-connection FR-257, FR-258)', () => {
  it('starts stable and stays stable with fast answers', () => {
    const q = createLinkQuality();
    for (let i = 0; i < 20; i++) expect(q.record(good)).toBe(false);
  });

  it('one bad sample is not enough', () => {
    const q = createLinkQuality();
    q.record(good);
    expect(q.record(failed)).toBe(false);
  });

  it('two bad samples of the last six make it unstable (slow, failed, partial)', () => {
    const q = createLinkQuality();
    q.record(good);
    q.record(slow);
    expect(q.record(failed)).toBe(true);
  });

  it('an answer just under 2 s is fast, 2 s is slow', () => {
    const q = createLinkQuality();
    q.record({ ok: true, ms: 1999 });
    expect(q.record({ ok: true, ms: 1999 })).toBe(false);
    q.record({ ok: true, ms: 2000 });
    expect(q.record({ ok: true, ms: 2000 })).toBe(true);
  });

  it('bad samples that left the window of six no longer count', () => {
    const q = createLinkQuality();
    q.record(failed);
    for (let i = 0; i < 6; i++) q.record(good);
    expect(q.record(failed)).toBe(false);
  });

  it('becomes stable only after four good samples in a row', () => {
    const q = createLinkQuality();
    q.record(failed);
    q.record(failed);
    expect(q.record(good)).toBe(true);
    expect(q.record(good)).toBe(true);
    expect(q.record(good)).toBe(true);
    expect(q.record(good)).toBe(false);
  });

  it('a bad sample while recovering restarts the count', () => {
    const q = createLinkQuality();
    q.record(failed);
    q.record(failed);
    q.record(good);
    q.record(good);
    q.record(good);
    expect(q.record(slow)).toBe(true);
    q.record(good);
    q.record(good);
    q.record(good);
    expect(q.record(good)).toBe(false);
  });

  it('thresholds can be changed', () => {
    const q = createLinkQuality({ slowMs: 500, windowSize: 3, badToUnstable: 1, goodToStable: 1 });
    expect(q.record({ ok: true, ms: 600 })).toBe(true);
    expect(q.record(good)).toBe(false);
  });
});
