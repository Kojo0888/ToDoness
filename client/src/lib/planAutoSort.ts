/**
 * Whether a plan's rows are sorted after every change (docs/plan-sort FR-193, FR-194).
 * A device setting, like the name position and the scale, so it lives in `localStorage`.
 */
import type { KeyValueStore } from './modules';

const KEY = 'todoness.plan.autoSort';

export function readAutoSort(storage: KeyValueStore | undefined): boolean {
  try {
    return storage?.getItem(KEY) === '1';
  } catch {
    return false; // storage blocked
  }
}

export function saveAutoSort(storage: KeyValueStore | undefined, on: boolean): void {
  try {
    storage?.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage may be blocked; the choice then lasts until reload */
  }
}
