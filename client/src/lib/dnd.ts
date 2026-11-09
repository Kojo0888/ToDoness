/**
 * Turns a finished drag into what should happen (docs/v1/PRD.md section 4.3).
 * Kept free of any library so it can be tested on its own.
 */

/** Droppable ids of sidebar lists start with this; task ids never do (they are UUIDs). */
export const LIST_PREFIX = 'list:';

export const listDropId = (listId: string) => `${LIST_PREFIX}${listId}`;

export type DropAction =
  | { kind: 'reorder'; todoId: string; beforeId: string | null }
  | { kind: 'move'; todoId: string; listId: string }
  | { kind: 'none' };

export function resolveDrop(input: {
  activeId: string;
  overId: string | null;
  /** The open tasks of the current list, in the order they were shown when the drag began. */
  openIds: string[];
  currentListId: string;
}): DropAction {
  const { activeId, overId, openIds, currentListId } = input;
  if (overId === null || overId === activeId) return { kind: 'none' };

  if (overId.startsWith(LIST_PREFIX)) {
    const listId = overId.slice(LIST_PREFIX.length);
    if (listId === '' || listId === currentListId) return { kind: 'none' };
    return { kind: 'move', todoId: activeId, listId };
  }

  const from = openIds.indexOf(activeId);
  const to = openIds.indexOf(overId);
  if (from < 0 || to < 0) return { kind: 'none' };

  // Moving down lands after the target, moving up lands before it.
  const beforeId = to > from ? (openIds[to + 1] ?? null) : overId;
  return { kind: 'reorder', todoId: activeId, beforeId };
}

/**
 * The order to show right after a drop, before the stored order catches up; `null` when the
 * drop does not change the order of this list.
 */
export function orderAfterDrop(ids: string[], action: DropAction): string[] | null {
  if (action.kind !== 'reorder') return null;
  const { todoId, beforeId } = action;
  if (!ids.includes(todoId)) return null;
  const rest = ids.filter((id) => id !== todoId);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  if (at < 0) return null;
  return [...rest.slice(0, at), todoId, ...rest.slice(at)];
}

/**
 * `items` in the given order of ids; the items unchanged without an order, or when the
 * items are not exactly the ones the order names (one was added or removed meanwhile).
 */
export function inOrder<T extends { id: string }>(items: T[], ids: string[] | null): T[] {
  if (ids === null || ids.length !== items.length) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const sorted: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) return items;
    sorted.push(item);
  }
  return sorted;
}
