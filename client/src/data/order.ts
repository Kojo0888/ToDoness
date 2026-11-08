/** Choosing the `orderKey` of a task that is put at a new position (fractional indexing). */
import { generateKeyBetween } from 'fractional-indexing';

export interface Keyed {
  id: string;
  orderKey: string;
}

export type KeyChoice = { kind: 'key'; key: string } | { kind: 'same' } | { kind: 'missing' };

/** A key that sorts before `firstKey` (a new task lands on top). */
export const keyOnTop = (firstKey: string | null) => generateKeyBetween(null, firstKey);

/**
 * The key for putting task `id` directly before task `beforeId` (`null` = at the end),
 * among `open`, the open tasks in their current order (including `id`).
 * `same` = it is already there, nothing to change.
 */
export function keyForPosition(
  open: readonly Keyed[],
  id: string,
  beforeId: string | null,
): KeyChoice {
  const at = open.findIndex((t) => t.id === id);
  if (at < 0) return { kind: 'missing' };
  const next = open[at + 1]?.id ?? null;
  if (beforeId === id || beforeId === next) return { kind: 'same' };

  const rest = open.filter((t) => t.id !== id);
  let index = rest.length;
  if (beforeId !== null) {
    index = rest.findIndex((t) => t.id === beforeId);
    if (index < 0) return { kind: 'missing' };
  }
  const lo = rest[index - 1]?.orderKey ?? null;
  let hi = rest[index]?.orderKey ?? null;
  // Equal keys (two devices created tasks at once): step past the equal ones.
  if (lo !== null && hi !== null && lo >= hi) {
    hi = rest.slice(index).find((t) => t.orderKey > lo)?.orderKey ?? null;
  }
  return { kind: 'key', key: generateKeyBetween(lo, hi) };
}
