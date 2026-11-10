/** Keyboard use of the small "⋯" menu of a list (arrow keys, Home, End, Escape). */
import { describe, expect, it } from 'vitest';
import { menuStep } from '../../src/lib/menuNav';

describe('menuStep', () => {
  it('opening with the arrow keys starts at the first or the last item', () => {
    expect(menuStep('ArrowDown', null, 3)).toEqual({ focus: 0 });
    expect(menuStep('ArrowUp', null, 3)).toEqual({ focus: 2 });
  });

  it('moves to the next and the previous item and wraps around', () => {
    expect(menuStep('ArrowDown', 0, 3)).toEqual({ focus: 1 });
    expect(menuStep('ArrowDown', 2, 3)).toEqual({ focus: 0 });
    expect(menuStep('ArrowUp', 1, 3)).toEqual({ focus: 0 });
    expect(menuStep('ArrowUp', 0, 3)).toEqual({ focus: 2 });
  });

  it('Home and End go to the ends', () => {
    expect(menuStep('Home', 2, 3)).toEqual({ focus: 0 });
    expect(menuStep('End', 0, 3)).toEqual({ focus: 2 });
  });

  it('Escape and Tab close the menu', () => {
    expect(menuStep('Escape', 1, 3)).toEqual({ close: true });
    expect(menuStep('Tab', 1, 3)).toEqual({ close: true });
  });

  it('ignores other keys and an empty menu', () => {
    expect(menuStep('a', 1, 3)).toBeNull();
    expect(menuStep('Enter', 1, 3)).toBeNull(); // the focused item handles it itself
    expect(menuStep('ArrowDown', null, 0)).toBeNull();
  });
});
