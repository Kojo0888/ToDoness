/**
 * Recognises a double click or a double tap on the same thing (docs/plan/PRD.md FR-154).
 * Done by timing clicks rather than with `dblclick`, which browsers do not fire reliably for
 * touch on an element that handles its own pointer events (`touch-action: none`).
 */
export interface DoubleTap {
  /** A click on `id` at `now` (ms): true when it is the second of a double click. */
  (id: string, now: number): boolean;
  /** Forget the last click (e.g. a drag came in between). */
  reset(): void;
}

export function createDoubleTap(ms = 400): DoubleTap {
  let last: { id: string; at: number } | null = null;
  const tap = ((id: string, now: number) => {
    if (last && last.id === id && now - last.at <= ms) {
      last = null; // a third click starts again
      return true;
    }
    last = { id, at: now };
    return false;
  }) as DoubleTap;
  tap.reset = () => {
    last = null;
  };
  return tap;
}
