/**
 * Whether done activities are hidden from a plan's timeline (docs/plan/PRD.md FR-162).
 * A device setting, like the name position and the scale, so it lives in `localStorage`.
 */
import type { KeyValueStore } from './modules';

const KEY = 'todoness.plan.hideDone';

export function readHideDone(storage: KeyValueStore | undefined): boolean {
  try {
    return storage?.getItem(KEY) === '1';
  } catch {
    return false; // storage blocked
  }
}

export function saveHideDone(storage: KeyValueStore | undefined, hide: boolean): void {
  try {
    storage?.setItem(KEY, hide ? '1' : '0');
  } catch {
    /* storage may be blocked; the choice then lasts until reload */
  }
}
