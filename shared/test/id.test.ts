import { describe, expect, it } from 'vitest';
import { idTimestamp, newClientId, newId } from '../src/id';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('returns a lowercase UUID version 7 with the RFC 9562 variant', () => {
    for (let i = 0; i < 100; i++) {
      expect(newId()).toMatch(UUID_V7);
    }
  });

  it('encodes the given time in the first 48 bits', () => {
    const t = Date.UTC(2026, 10, 5, 12, 0, 0);
    expect(idTimestamp(newId(t))).toBe(t);
  });

  it('uses the current time by default', () => {
    const before = Date.now();
    const ts = idTimestamp(newId());
    const after = Date.now();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('sorts ids created in later milliseconds after earlier ones', () => {
    const ids = [1000, 2000, 3000, 1_730_822_400_000].map((t) => newId(t));
    expect([...ids].sort()).toEqual(ids);
  });

  it('does not repeat', () => {
    const t = Date.now();
    const ids = new Set(Array.from({ length: 10_000 }, () => newId(t)));
    expect(ids.size).toBe(10_000);
  });

  it('rejects times outside the 48-bit range', () => {
    expect(() => newId(-1)).toThrow(RangeError);
    expect(() => newId(2 ** 48)).toThrow(RangeError);
    expect(() => newId(1.5)).toThrow(RangeError);
  });
});

describe('idTimestamp', () => {
  it('rejects strings that are not UUID version 7', () => {
    expect(() => idTimestamp('not-an-id')).toThrow();
    expect(() => idTimestamp('0192f0c1-0000-4000-8000-000000000000')).toThrow();
  });
});

describe('newClientId', () => {
  it('returns 16 lowercase hex characters', () => {
    expect(newClientId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newClientId()));
    expect(ids.size).toBe(1000);
  });
});
