/**
 * The order a list is shown in right after a drop, until the stored order catches up.
 *
 * The new order is written to the local database (or the public queue), and the page only
 * hears about it a moment later. Without this, dnd-kit drops the row back into its old place
 * for those frames and then it jumps to the new one. The drop sets the order synchronously,
 * so the very next render already shows the row where it was released.
 */
export interface DropOrder {
  set(scope: string, ids: string[]): void;
  /** The order to show for the list `scope`, or `null`. */
  orderFor(scope: string): string[] | null;
  /** The order the list now has: forget the pending order once it is there (or moot). */
  settle(scope: string, ids: string[]): void;
  /**
   * The drop that set `ids` was refused: show the stored order again at once. A newer drop
   * (another pending order) is left alone.
   */
  cancel(scope: string, ids: string[]): void;
  subscribe(listener: () => void): () => void;
  /** Changes whenever the pending order does (for `useSyncExternalStore`). */
  getSnapshot(): unknown;
}

const sameItems = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
};

export function createDropOrder(giveUpMs = 3000): DropOrder {
  let pending: { scope: string; ids: string[] } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const change = (next: typeof pending) => {
    pending = next;
    clearTimeout(timer);
    // If the stored order never matches (a refused write, a change from elsewhere), give up.
    if (next) timer = setTimeout(() => change(null), giveUpMs);
    for (const l of listeners) l();
  };

  return {
    set: (scope, ids) => change({ scope, ids }),
    orderFor: (scope) => (pending?.scope === scope ? pending.ids : null),
    settle(scope, ids) {
      if (pending?.scope !== scope) return;
      const done = !sameItems(pending.ids, ids) || pending.ids.every((id, i) => ids[i] === id);
      if (done) change(null);
    },
    cancel(scope, ids) {
      if (pending?.scope !== scope || pending.ids.length !== ids.length) return;
      if (pending.ids.every((id, i) => ids[i] === id)) change(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => pending,
  };
}

/** The one used by the app: the drag & drop context sets it, the sortable lists read it. */
export const dropOrder = createDropOrder();

/** Which list a pending order is for. */
export const dropScope = {
  list: (listId: string) => `list:${listId}`,
  publicList: (listId: string) => `public:${listId}`,
  notes: 'notes',
  /** My lists on the Manage lists page. */
  lists: 'lists',
};
