/**
 * Where the names of activities are shown on a plan's timeline (docs/plan/PRD.md FR-140):
 * on the block, after the block, or in a column of their own. A device setting, like the
 * theme (decision P6), so it lives in `localStorage`.
 */
import type { KeyValueStore } from './modules';

export const NAME_MODES = ['on', 'after', 'column'] as const;
export type NameMode = (typeof NAME_MODES)[number];

const KEY = 'todoness.plan.names';
const DEFAULT: NameMode = 'on';

export function readNameMode(storage: KeyValueStore | undefined): NameMode {
  try {
    const v = storage?.getItem(KEY);
    return NAME_MODES.includes(v as NameMode) ? (v as NameMode) : DEFAULT;
  } catch {
    return DEFAULT; // storage blocked
  }
}

export function saveNameMode(storage: KeyValueStore | undefined, mode: NameMode): void {
  try {
    storage?.setItem(KEY, mode);
  } catch {
    /* storage may be blocked; the choice then lasts until reload */
  }
}
