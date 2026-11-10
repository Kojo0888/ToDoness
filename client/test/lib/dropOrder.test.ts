/**
 * The order shown right after a drop, until the stored order catches up: without it the
 * released row jumps back to its old place for a moment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDropOrder } from '../../src/lib/dropOrder';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('dropOrder', () => {
  it('holds the order of one list (scope) and tells its listeners', () => {
    const store = createDropOrder();
    const heard = vi.fn();
    store.subscribe(heard);
    expect(store.orderFor('list:1')).toBeNull();
    store.set('list:1', ['B', 'A']);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.orderFor('list:1')).toEqual(['B', 'A']);
    expect(store.orderFor('list:2')).toBeNull(); // another list is not affected
  });

  it('forgets the order once the stored order is the same', () => {
    const store = createDropOrder();
    store.set('notes', ['B', 'A']);
    store.settle('notes', ['A', 'B']); // not written yet
    expect(store.orderFor('notes')).toEqual(['B', 'A']);
    store.settle('notes', ['B', 'A']);
    expect(store.orderFor('notes')).toBeNull();
  });

  it('forgets the order when the items changed meanwhile (added or removed elsewhere)', () => {
    const store = createDropOrder();
    store.set('notes', ['B', 'A']);
    store.settle('notes', ['C', 'A', 'B']);
    expect(store.orderFor('notes')).toBeNull();
  });

  it('settling another scope does not touch it', () => {
    const store = createDropOrder();
    store.set('notes', ['B', 'A']);
    store.settle('list:1', ['X']);
    expect(store.orderFor('notes')).toEqual(['B', 'A']);
  });

  it('gives up after a while if the stored order never matches (a failed or changed write)', () => {
    const store = createDropOrder(2000);
    store.set('notes', ['B', 'A']);
    vi.advanceTimersByTime(1999);
    expect(store.orderFor('notes')).toEqual(['B', 'A']);
    vi.advanceTimersByTime(1);
    expect(store.orderFor('notes')).toBeNull();
  });

  it('a new drop replaces the earlier one', () => {
    const store = createDropOrder(2000);
    store.set('notes', ['B', 'A']);
    vi.advanceTimersByTime(1500);
    store.set('notes', ['A', 'B']);
    vi.advanceTimersByTime(1500);
    expect(store.orderFor('notes')).toEqual(['A', 'B']);
  });
});

describe('dropScope.lists', () => {
  it('is its own scope, so a list drop never mixes with a task drop', async () => {
    const { dropScope } = await import('../../src/lib/dropOrder');
    expect(dropScope.lists).toBe('lists');
    expect(dropScope.lists).not.toBe(dropScope.notes);
    expect(dropScope.lists).not.toBe(dropScope.list('lists'));
  });
});

describe('cancel', () => {
  it('forgets the pending order of that list at once (a refused drop jumps back now)', async () => {
    const { createDropOrder } = await import('../../src/lib/dropOrder');
    const order = createDropOrder();
    order.set('lists', ['b', 'a']);
    order.cancel('other', ['b', 'a']);
    expect(order.orderFor('lists')).toEqual(['b', 'a']); // another scope: untouched
    order.cancel('lists', ['b', 'a']);
    expect(order.orderFor('lists')).toBeNull();
  });

  it('leaves a newer drop alone when an older one is refused late', async () => {
    const { createDropOrder } = await import('../../src/lib/dropOrder');
    const order = createDropOrder();
    order.set('lists', ['b', 'a', 'c']); // first drop
    order.set('lists', ['c', 'b', 'a']); // second drop, before the first was written
    order.cancel('lists', ['b', 'a', 'c']); // the first one is refused
    expect(order.orderFor('lists')).toEqual(['c', 'b', 'a']);
  });
});
