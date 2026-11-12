/**
 * Which groups of a plan are collapsed (docs/plan/PRD.md FR-181, decision P25). A device
 * setting per plan, like the name position, so it lives in `localStorage`.
 */
import type { KeyValueStore } from './modules';

const keyOf = (planId: string) => `todoness.plan.collapsed.${planId}`;

export function readCollapsed(storage: KeyValueStore | undefined, planId: string): Set<string> {
  try {
    const raw = storage?.getItem(keyOf(planId));
    if (!raw) return new Set();
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string')
      ? new Set(ids)
      : new Set();
  } catch {
    return new Set(); // storage blocked or a broken value
  }
}

export function saveCollapsed(
  storage: KeyValueStore | undefined,
  planId: string,
  collapsed: ReadonlySet<string>,
): void {
  try {
    storage?.setItem(keyOf(planId), JSON.stringify([...collapsed]));
  } catch {
    /* storage may be blocked; the choice then lasts until reload */
  }
}
