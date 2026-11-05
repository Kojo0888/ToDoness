/**
 * Hybrid Logical Clock (see DBModel.md section 1).
 *
 * Format: `<wall-ms 13 digits>-<counter 4 hex>-<client id>`,
 * e.g. `1730822400000-0003-c9f1a2`. Because the first two parts have a fixed
 * width, comparing two HLCs as plain strings gives the correct order:
 * by wall time, then counter, then client id (the tie-breaker).
 *
 * The clock never goes backwards, even if the device clock does, and after
 * `receive()` it is always ahead of every timestamp it has seen. That keeps the
 * order of edits correct between devices whose clocks disagree.
 */

export type Hlc = string;

export interface HlcParts {
  wall: number;
  counter: number;
  clientId: string;
}

const WALL_DIGITS = 13;
const MAX_WALL = 10 ** WALL_DIGITS - 1;
const MAX_COUNTER = 0xffff;
const CLIENT_ID = /^[A-Za-z0-9_]{1,64}$/;
const HLC = /^(\d{13})-([0-9a-f]{4})-([A-Za-z0-9_]{1,64})$/;

export class HlcError extends Error {
  override name = 'HlcError';
}

export function isValidClientId(clientId: string): boolean {
  return CLIENT_ID.test(clientId);
}

export function formatHlc({ wall, counter, clientId }: HlcParts): Hlc {
  if (!Number.isInteger(wall) || wall < 0 || wall > MAX_WALL) {
    throw new HlcError(`HLC wall time out of range: ${wall}`);
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw new HlcError(`HLC counter out of range: ${counter}`);
  }
  if (!isValidClientId(clientId)) {
    throw new HlcError(`Invalid HLC client id: ${clientId}`);
  }
  return `${String(wall).padStart(WALL_DIGITS, '0')}-${counter.toString(16).padStart(4, '0')}-${clientId}`;
}

export function isHlc(value: string): boolean {
  return HLC.test(value);
}

export function parseHlc(value: string): HlcParts {
  const m = HLC.exec(value);
  if (!m) throw new HlcError(`Invalid HLC: ${value}`);
  return { wall: Number(m[1]), counter: parseInt(m[2]!, 16), clientId: m[3]! };
}

/** Wall time (epoch ms) of an HLC. */
export function hlcWall(value: Hlc): number {
  return parseHlc(value).wall;
}

export function compareHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HlcClock {
  private wall = 0;
  private counter = -1;
  private lastHlc: Hlc | undefined;

  /**
   * @param clientId  this device's id (letters, digits and `_` only)
   * @param physicalNow  source of the device time, replaceable in tests
   * @param last  the last HLC this device produced, to continue after a reload
   */
  constructor(
    private readonly clientId: string,
    private readonly physicalNow: () => number = Date.now,
    last?: Hlc,
  ) {
    if (!isValidClientId(clientId)) throw new HlcError(`Invalid HLC client id: ${clientId}`);
    if (last !== undefined) {
      const p = parseHlc(last);
      this.wall = p.wall;
      this.counter = p.counter;
      this.lastHlc = last;
    }
  }

  /** The most recent timestamp this clock produced (persist it between sessions). */
  get last(): Hlc | undefined {
    return this.lastHlc;
  }

  /** A new timestamp for a local change. */
  now(): Hlc {
    const phys = this.physicalNow();
    if (phys > this.wall) {
      this.wall = phys;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return this.emit();
  }

  /** Moves the clock ahead of a timestamp received from another device. */
  receive(remote: Hlc): Hlc {
    const r = parseHlc(remote);
    const phys = this.physicalNow();
    const wall = Math.max(phys, this.wall, r.wall);

    if (wall === this.wall && wall === r.wall) {
      this.counter = Math.max(this.counter, r.counter) + 1;
    } else if (wall === this.wall) {
      this.counter += 1;
    } else if (wall === r.wall) {
      this.counter = r.counter + 1;
    } else {
      this.counter = 0;
    }
    this.wall = wall;
    return this.emit();
  }

  private emit(): Hlc {
    if (this.counter > MAX_COUNTER) {
      // More than 65 536 events in one millisecond: borrow the next millisecond.
      this.wall += 1;
      this.counter = 0;
    }
    this.lastHlc = formatHlc({ wall: this.wall, counter: this.counter, clientId: this.clientId });
    return this.lastHlc;
  }
}
