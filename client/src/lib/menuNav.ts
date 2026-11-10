/**
 * Keyboard use of the small "⋯" menu of a list. Kept free of React so it can be tested alone.
 * `current` is the index of the focused item, or `null` while focus is on the menu button.
 * Enter and Space are not handled here: the focused item is a button and does them itself.
 */
export type MenuStep = { focus: number } | { close: true } | null;

export function menuStep(key: string, current: number | null, count: number): MenuStep {
  if (key === 'Escape' || key === 'Tab') return { close: true };
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return { focus: current === null ? 0 : (current + 1) % count };
    case 'ArrowUp':
      return { focus: current === null ? count - 1 : (current - 1 + count) % count };
    case 'Home':
      return { focus: 0 };
    case 'End':
      return { focus: count - 1 };
    default:
      return null;
  }
}
