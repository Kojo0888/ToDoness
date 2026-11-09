import { describe, expect, it } from 'vitest';
import { keyForPosition, keyOnTop } from '../../src/data/order';

const items = (...keys: string[]) => keys.map((orderKey, i) => ({ id: `t${i}`, orderKey }));

describe('keyOnTop', () => {
  it('sorts before the first key, or is any key for an empty list', () => {
    expect(keyOnTop('a1') < 'a1').toBe(true);
    expect(typeof keyOnTop(null)).toBe('string');
  });
});

describe('keyForPosition', () => {
  const open = items('a0', 'a1', 'a2', 'a3'); // t0 t1 t2 t3

  it('puts a task before another one', () => {
    const r = keyForPosition(open, 't3', 't1');
    expect(r.kind).toBe('key');
    if (r.kind === 'key') expect(r.key > 'a0' && r.key < 'a1').toBe(true);
  });

  it('puts a task at the top and at the end', () => {
    const top = keyForPosition(open, 't2', 't0');
    expect(top.kind === 'key' && top.key < 'a0').toBe(true);
    const end = keyForPosition(open, 't0', null);
    expect(end.kind === 'key' && end.key > 'a3').toBe(true);
  });

  it('says nothing changes when the position is the same', () => {
    expect(keyForPosition(open, 't1', 't1')).toEqual({ kind: 'same' }); // before itself
    expect(keyForPosition(open, 't1', 't2')).toEqual({ kind: 'same' }); // already before t2
    expect(keyForPosition(open, 't3', null)).toEqual({ kind: 'same' }); // already last
  });

  it('reports an unknown target', () => {
    expect(keyForPosition(open, 't1', 'zzz')).toEqual({ kind: 'missing' });
    expect(keyForPosition(open, 'zzz', null)).toEqual({ kind: 'missing' });
  });

  it('steps past equal keys instead of failing', () => {
    const dup = items('a0', 'a0', 'a0', 'a5'); // t0 t1 t2 share a key
    const r = keyForPosition(dup, 't3', 't1');
    expect(r.kind).toBe('key');
    if (r.kind === 'key') expect(r.key >= 'a0').toBe(true);
  });
});
