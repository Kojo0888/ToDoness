/**
 * IDs created on the device (see DBModel.md section 1).
 *
 * Rows use UUID version 7 (RFC 9562): the first 48 bits are the Unix time in
 * milliseconds, so IDs sort by creation time and index well.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const MAX_TIMESTAMP = 2 ** 48 - 1;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Returns a new UUIDv7. `now` (epoch ms) is only passed in tests. */
export function newId(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIMESTAMP) {
    throw new RangeError(`Timestamp out of range for UUIDv7: ${now}`);
  }

  const b = randomBytes(16);

  // Bytes 0–5: timestamp, big-endian.
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx

  const h = Array.from(b, (x) => HEX[x]!);
  return (
    h.slice(0, 4).join('') +
    '-' +
    h.slice(4, 6).join('') +
    '-' +
    h.slice(6, 8).join('') +
    '-' +
    h.slice(8, 10).join('') +
    '-' +
    h.slice(10, 16).join('')
  );
}

/** Returns the creation time (epoch ms) stored in a UUIDv7. */
export function idTimestamp(id: string): number {
  if (!UUID_V7.test(id)) throw new Error(`Not a UUIDv7: ${id}`);
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/**
 * Returns a random ID for one browser (stored in Dexie `meta.clientId`).
 * Only hex characters, so it is safe inside an HLC string.
 */
export function newClientId(): string {
  return Array.from(randomBytes(8), (x) => HEX[x]!).join('');
}
