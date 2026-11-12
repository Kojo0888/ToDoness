/**
 * The scale of a plan's timeline (docs/plan/PRD.md FR-157): days, weeks, months or years.
 * A device setting, like the name position (decision P6), so it lives in `localStorage`.
 */
import type { KeyValueStore } from './modules';
import { SCALES, type Scale } from './timeline';

const KEY = 'todoness.plan.scale';
const DEFAULT: Scale = 'day';

export function readScale(storage: KeyValueStore | undefined): Scale {
  try {
    const v = storage?.getItem(KEY);
    return SCALES.includes(v as Scale) ? (v as Scale) : DEFAULT;
  } catch {
    return DEFAULT; // storage blocked
  }
}

export function saveScale(storage: KeyValueStore | undefined, scale: Scale): void {
  try {
    storage?.setItem(KEY, scale);
  } catch {
    /* storage may be blocked; the choice then lasts until reload */
  }
}
