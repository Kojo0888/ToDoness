import { useEffect, useReducer, useRef, useState } from 'react';
import { createPendingValue } from '../../lib/pendingValue';

/**
 * A saved value that this screen edits (see lib/pendingValue.ts): `value` to show,
 * `latest()` to build the next change on (in event handlers), `set()` to save one.
 */
export function usePendingValue<T>(saved: T, same?: (a: T, b: T) => boolean) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [store] = useState(() => createPendingValue<T>(same, rerender));
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
    store.saved(saved);
  }, [saved, store]);

  return {
    value: store.current(saved),
    latest: () => store.current(savedRef.current),
    /** Saves `next`; `save` resolves to false when it did not work. */
    async set(next: T, save: (next: T) => Promise<boolean>): Promise<boolean> {
      store.start(next);
      let ok = false;
      try {
        ok = await save(next);
        return ok;
      } finally {
        store.settle(ok, savedRef.current);
      }
    },
  };
}
