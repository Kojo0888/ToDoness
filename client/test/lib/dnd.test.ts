import { describe, expect, it } from 'vitest';
import { LIST_PREFIX, listDropId, resolveDrop } from '../../src/lib/dnd';

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
