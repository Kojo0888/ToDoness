/** The "Manage lists" page: where it lives and which moves a list allows. */
export const MANAGE_LISTS_PATH = '/lists/manage';

export interface MovableList {
  id: string;
  isInbox: boolean;
}

/** Which way a list can move; `lists` is in display order. The Inbox stays first. */
export function moveAvailability(
  lists: readonly MovableList[],
  id: string,
): { up: boolean; down: boolean } {
  const i = lists.findIndex((l) => l.id === id);
  if (i < 0 || lists[i]!.isInbox) return { up: false, down: false };
  return { up: i > 0 && !lists[i - 1]!.isInbox, down: i < lists.length - 1 };
}
