import { describe, expect, it, vi } from 'vitest';
import { createConnectivity } from '../../src/sync/connectivity';

describe('connectivity (what the app itself found out, not the browser flag)', () => {
  it('starts from the browser’s hint', () => {
    expect(createConnectivity(true).getSnapshot().online).toBe(true);
    expect(createConnectivity(false).getSnapshot().online).toBe(false);
  });

  it('report() changes it and says whether it changed', () => {
    const c = createConnectivity(false);
    expect(c.report(true)).toBe(true);
    expect(c.getSnapshot().online).toBe(true);
    expect(c.report(true)).toBe(false); // same again: no change
    expect(c.report(false)).toBe(true);
  });

  it('tells subscribers only when the value changes, with a new snapshot object', () => {
    const c = createConnectivity(true);
    const listener = vi.fn();
    const off = c.subscribe(listener);
    const first = c.getSnapshot();
    c.report(true);
    expect(listener).not.toHaveBeenCalled();
    expect(c.getSnapshot()).toBe(first);
    c.report(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot()).not.toBe(first);
    off();
    c.report(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
