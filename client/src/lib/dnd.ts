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
