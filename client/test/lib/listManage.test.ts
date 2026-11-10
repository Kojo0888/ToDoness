/** The "Manage lists" page: which lists can move where. */
import { describe, expect, it } from 'vitest';
import { MANAGE_LISTS_PATH, moveAvailability } from '../../src/lib/listManage';

const lists = [
  { id: 'inbox', isInbox: true },
  { id: 'a', isInbox: false },
  { id: 'b', isInbox: false },
  { id: 'c', isInbox: false },
];

describe('moveAvailability', () => {
  it('cannot move the first list below the Inbox up', () => {
    expect(moveAvailability(lists, 'a')).toEqual({ up: false, down: true });
  });

  it('can move a middle list both ways', () => {
    expect(moveAvailability(lists, 'b')).toEqual({ up: true, down: true });
  });

  it('cannot move the last list down', () => {
    expect(moveAvailability(lists, 'c')).toEqual({ up: true, down: false });
  });

  it('never moves the Inbox', () => {
    expect(moveAvailability(lists, 'inbox')).toEqual({ up: false, down: false });
  });

  it('cannot move an unknown list', () => {
    expect(moveAvailability(lists, 'zzz')).toEqual({ up: false, down: false });
  });
});

describe('the page address', () => {
  it('is /lists/manage', () => {
    expect(MANAGE_LISTS_PATH).toBe('/lists/manage');
  });
});
