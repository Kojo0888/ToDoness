import { describe, expect, it } from 'vitest';
import { HlcClock, compareHlc, formatHlc, hlcWall, isHlc, parseHlc } from '../src/hlc';

/** A fake physical clock the test can move forwards and backwards. */
function fakeTime(start: number) {
  let t = start;
  return {
    now: () => t,
    set: (v: number) => {
      t = v;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const T0 = 1_730_822_400_000; // 2024-11-05T16:00:00Z

describe('formatHlc / parseHlc', () => {
  it('formats with fixed widths', () => {
    expect(formatHlc({ wall: T0, counter: 3, clientId: 'c9f1a2' })).toBe(
      '1730822400000-0003-c9f1a2',
    );
    expect(formatHlc({ wall: 5, counter: 0xabcd, clientId: 'a' })).toBe('0000000000005-abcd-a');
  });

  it('round-trips', () => {
    const parts = { wall: T0, counter: 42, clientId: 'device_1' };
    expect(parseHlc(formatHlc(parts))).toEqual(parts);
  });

  it('rejects invalid input', () => {
    const bad = [
      '',
      '1730822400000-0003', // no client id
      '173082240000-0003-a', // 12-digit wall
      '1730822400000-003-a', // 3-digit counter
      '1730822400000-ABCD-a', // uppercase hex is not canonical
      '1730822400000-0003-a-b', // dash in client id
      '1730822400000-0003-' + 'a'.repeat(65), // client id too long
      'x730822400000-0003-a',
    ];
    for (const s of bad) {
      expect(isHlc(s), s).toBe(false);
      expect(() => parseHlc(s), s).toThrow();
    }
  });

  it('refuses to format out-of-range parts', () => {
    expect(() => formatHlc({ wall: -1, counter: 0, clientId: 'a' })).toThrow();
    expect(() => formatHlc({ wall: 1e13, counter: 0, clientId: 'a' })).toThrow();
    expect(() => formatHlc({ wall: 1, counter: 0x10000, clientId: 'a' })).toThrow();
    expect(() => formatHlc({ wall: 1, counter: 0, clientId: 'a-b' })).toThrow();
  });

  it('hlcWall returns the wall time', () => {
    expect(hlcWall('1730822400000-0003-c9f1a2')).toBe(T0);
  });
});

describe('compareHlc', () => {
  const h = (wall: number, counter: number, clientId: string) =>
    formatHlc({ wall, counter, clientId });

  it('orders by wall time, then counter, then client id', () => {
    expect(compareHlc(h(1, 9, 'z'), h(2, 0, 'a'))).toBe(-1);
    expect(compareHlc(h(2, 1, 'a'), h(2, 0, 'z'))).toBe(1);
    expect(compareHlc(h(2, 1, 'a'), h(2, 1, 'b'))).toBe(-1);
    expect(compareHlc(h(2, 1, 'a'), h(2, 1, 'a'))).toBe(0);
  });

  it('agrees with plain string sorting', () => {
    const list = [
      h(T0, 2, 'b'),
      h(T0, 10, 'a'),
      h(T0 - 1, 0xffff, 'z'),
      h(T0, 2, 'a'),
      h(9, 0, 'a'),
    ];
    const byCompare = [...list].sort(compareHlc);
    const byString = [...list].sort();
    expect(byCompare).toEqual(byString);
  });
});

describe('HlcClock', () => {
  it('rejects an invalid client id', () => {
    expect(() => new HlcClock('bad-id')).toThrow();
    expect(() => new HlcClock('')).toThrow();
  });

  it('uses the physical time when it moves forward', () => {
    const time = fakeTime(T0);
    const clock = new HlcClock('a', time.now);
    expect(clock.now()).toBe(formatHlc({ wall: T0, counter: 0, clientId: 'a' }));
    time.advance(5);
    expect(clock.now()).toBe(formatHlc({ wall: T0 + 5, counter: 0, clientId: 'a' }));
  });

  it('increments the counter within the same millisecond', () => {
    const time = fakeTime(T0);
    const clock = new HlcClock('a', time.now);
    const a = clock.now();
    const b = clock.now();
    const c = clock.now();
    expect(parseHlc(b).counter).toBe(1);
    expect(parseHlc(c).counter).toBe(2);
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, c)).toBe(-1);
  });

  it('never goes backwards when the device clock does', () => {
    const time = fakeTime(T0);
    const clock = new HlcClock('a', time.now);
    const a = clock.now();
    time.set(T0 - 60_000);
    const b = clock.now();
    expect(compareHlc(a, b)).toBe(-1);
    expect(hlcWall(b)).toBe(T0);
  });

  it('moves to the next millisecond when the counter is full', () => {
    const time = fakeTime(T0);
    const clock = new HlcClock(
      'a',
      time.now,
      formatHlc({ wall: T0, counter: 0xffff, clientId: 'a' }),
    );
    const next = clock.now();
    expect(parseHlc(next)).toEqual({ wall: T0 + 1, counter: 0, clientId: 'a' });
  });

  it('continues after a saved timestamp (e.g. after a reload)', () => {
    const saved = formatHlc({ wall: T0 + 1000, counter: 7, clientId: 'a' });
    const clock = new HlcClock('a', () => T0, saved);
    expect(clock.last).toBe(saved);
    expect(compareHlc(clock.now(), saved)).toBe(1);
  });

  it('every result is newer than everything it has seen', () => {
    const time = fakeTime(T0);
    const clock = new HlcClock('a', time.now);
    const seen: string[] = [];
    const steps = [0, 3, -10, 0, 0, 100, -500, 1];
    for (const [i, step] of steps.entries()) {
      time.advance(step);
      if (i % 3 === 0) {
        seen.push(clock.receive(formatHlc({ wall: T0 + 50 * i, counter: i, clientId: 'b' })));
      } else {
        seen.push(clock.now());
      }
    }
    for (let i = 1; i < seen.length; i++) {
      expect(compareHlc(seen[i - 1]!, seen[i]!), `step ${i}`).toBe(-1);
    }
  });

  describe('receive', () => {
    it('jumps ahead of a remote timestamp from the future', () => {
      const clock = new HlcClock('a', () => T0);
      const remote = formatHlc({ wall: T0 + 10_000, counter: 4, clientId: 'b' });
      const r = clock.receive(remote);
      expect(parseHlc(r)).toEqual({ wall: T0 + 10_000, counter: 5, clientId: 'a' });
      expect(compareHlc(clock.now(), remote)).toBe(1);
    });

    it('ignores an older remote timestamp but still ticks', () => {
      const clock = new HlcClock('a', () => T0);
      const before = clock.now();
      const r = clock.receive(formatHlc({ wall: T0 - 10_000, counter: 9, clientId: 'b' }));
      expect(compareHlc(r, before)).toBe(1);
      expect(hlcWall(r)).toBe(T0);
    });

    it('uses the larger counter when wall times are equal', () => {
      const clock = new HlcClock('a', () => T0);
      clock.now(); // counter 0
      const r = clock.receive(formatHlc({ wall: T0, counter: 20, clientId: 'b' }));
      expect(parseHlc(r).counter).toBe(21);
    });

    it('uses the physical time when it is ahead of both', () => {
      const time = fakeTime(T0);
      const clock = new HlcClock('a', time.now);
      clock.now();
      time.advance(1000);
      const r = clock.receive(formatHlc({ wall: T0 + 10, counter: 3, clientId: 'b' }));
      expect(parseHlc(r)).toEqual({ wall: T0 + 1000, counter: 0, clientId: 'a' });
    });

    it('rejects an invalid remote timestamp', () => {
      const clock = new HlcClock('a', () => T0);
      expect(() => clock.receive('nonsense')).toThrow();
    });
  });

  it('orders edits correctly even when one device clock is days behind', () => {
    // Device B is correct; device A is 3 days behind.
    const days3 = 3 * 24 * 60 * 60 * 1000;
    const timeA = fakeTime(T0 - days3);
    const timeB = fakeTime(T0);
    const a = new HlcClock('a', timeA.now);
    const b = new HlcClock('b', timeB.now);

    const editB = b.now(); // B edits first
    a.receive(editB); // A syncs and sees B's edit
    timeA.advance(1000);
    const editA = a.now(); // A edits later in real time

    expect(compareHlc(editB, editA)).toBe(-1); // A's later edit wins
  });
});
