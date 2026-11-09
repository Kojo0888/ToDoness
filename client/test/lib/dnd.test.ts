import { describe, expect, it } from 'vitest';
import { LIST_PREFIX, inOrder, listDropId, orderAfterDrop, resolveDrop } from '../../src/lib/dnd';

const open = ['A', 'B', 'C', 'D'];
const drop = (activeId: string, overId: string | null, listId = 'L1', openIds = open) =>
  resolveDrop({ activeId, overId, openIds, currentListId: listId });

describe('resolveDrop (FR-37 – FR-41)', () => {
  it('dropping nowhere does nothing', () => {
    expect(drop('B', null)).toEqual({ kind: 'none' });
  });

  it('dropping a task on itself does nothing', () => {
    expect(drop('B', 'B')).toEqual({ kind: 'none' });
  });

  it('dragging up puts the task before the one it was dropped on', () => {
    expect(drop('D', 'B')).toEqual({ kind: 'reorder', todoId: 'D', beforeId: 'B' });
    expect(drop('C', 'A')).toEqual({ kind: 'reorder', todoId: 'C', beforeId: 'A' });
  });

  it('dragging down puts the task after the one it was dropped on', () => {
    expect(drop('A', 'C')).toEqual({ kind: 'reorder', todoId: 'A', beforeId: 'D' });
    expect(drop('A', 'B')).toEqual({ kind: 'reorder', todoId: 'A', beforeId: 'C' });
  });

  it('dragging below the last task puts it at the end', () => {
    expect(drop('A', 'D')).toEqual({ kind: 'reorder', todoId: 'A', beforeId: null });
  });

  it('an unknown target does nothing', () => {
    expect(drop('A', 'zzz')).toEqual({ kind: 'none' });
    expect(drop('zzz', 'A')).toEqual({ kind: 'none' });
  });

  it('dropping on a different list in the sidebar moves the task there', () => {
    expect(drop('B', listDropId('L2'))).toEqual({ kind: 'move', todoId: 'B', listId: 'L2' });
  });

  it('dropping on the list the task is already in does nothing', () => {
    expect(drop('B', listDropId('L1'))).toEqual({ kind: 'none' });
  });

  it('list drop ids are recognisable and reversible', () => {
    expect(listDropId('abc')).toBe(`${LIST_PREFIX}abc`);
    expect(drop('B', `${LIST_PREFIX}`)).toEqual({ kind: 'none' }); // empty list id
  });
});

describe('orderAfterDrop: the order shown right after a drop', () => {
  it('moves the task to where the drop puts it', () => {
    expect(orderAfterDrop(open, { kind: 'reorder', todoId: 'D', beforeId: 'B' })).toEqual([
      'A',
      'D',
      'B',
      'C',
    ]);
    expect(orderAfterDrop(open, { kind: 'reorder', todoId: 'A', beforeId: 'D' })).toEqual([
      'B',
      'C',
      'A',
      'D',
    ]);
    expect(orderAfterDrop(open, { kind: 'reorder', todoId: 'A', beforeId: null })).toEqual([
      'B',
      'C',
      'D',
      'A',
    ]);
  });

  it('agrees with resolveDrop for every pair', () => {
    for (const a of open) {
      for (const b of open) {
        const action = drop(a, b);
        if (action.kind !== 'reorder') continue;
        const shown = orderAfterDrop(open, action)!;
        // The dragged task ends up exactly where the target was.
        expect(shown.indexOf(a)).toBe(open.indexOf(b));
      }
    }
  });

  it('has nothing to show for a move, nothing or an unknown task', () => {
    expect(orderAfterDrop(open, { kind: 'none' })).toBeNull();
    expect(orderAfterDrop(open, { kind: 'move', todoId: 'A', listId: 'L2' })).toBeNull();
    expect(orderAfterDrop(open, { kind: 'reorder', todoId: 'X', beforeId: 'A' })).toBeNull();
    expect(orderAfterDrop(open, { kind: 'reorder', todoId: 'A', beforeId: 'X' })).toBeNull();
  });
});

describe('inOrder: shows items in a pending order', () => {
  const items = open.map((id) => ({ id }));
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it('sorts the items by the order', () => {
    expect(ids(inOrder(items, ['D', 'A', 'B', 'C']))).toEqual(['D', 'A', 'B', 'C']);
  });

  it('keeps the items as they are without an order, or when the items changed meanwhile', () => {
    expect(inOrder(items, null)).toBe(items);
    expect(inOrder(items, ['A', 'B', 'C'])).toBe(items); // one more item now
    expect(inOrder(items, ['A', 'B', 'C', 'X'])).toBe(items); // a different item
    expect(inOrder(items, ['A', 'B', 'C', 'D', 'E'])).toBe(items); // one item fewer
  });
});
