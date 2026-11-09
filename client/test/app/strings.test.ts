import { describe, expect, it } from 'vitest';
import { t } from '../../src/app/strings';

describe('recovery texts', () => {
  const empty = { todos: 2, lists: 1, notes: 0 };
  it('keeps the old wording when there are no notes', () => {
    expect(t.recovery.emptyAccount('a@b.co', empty)).toBe(
      'Your new account is empty on the server, but 2 tasks and 1 list (besides the Inbox) of a@b.co are still stored offline on this device.',
    );
  });

  it('names the notes when there are some', () => {
    expect(t.recovery.emptyAccount('a@b.co', { todos: 2, lists: 1, notes: 3 })).toContain(
      '2 tasks, 1 list (besides the Inbox) and 3 notes of a@b.co',
    );
    expect(t.recovery.emptyAccount('a@b.co', { todos: 0, lists: 0, notes: 1 })).toContain(
      '0 tasks, 0 lists (besides the Inbox) and 1 note of a@b.co',
    );
  });

  it('says what the account already holds, notes included', () => {
    expect(
      t.recovery.filledAccount('a@b.co', { todos: 1, lists: 0, notes: 1 }, { todos: 4, notes: 2 }),
    ).toBe(
      'Your new account already holds 4 tasks and 2 notes, and 1 task, 0 lists (besides the Inbox) and 1 note of a@b.co are still stored offline on this device.',
    );
    expect(
      t.recovery.filledAccount('a@b.co', { todos: 1, lists: 0, notes: 0 }, { todos: 4, notes: 0 }),
    ).toBe(
      'Your new account already holds 4 tasks, and 1 task and 0 lists (besides the Inbox) of a@b.co are still stored offline on this device.',
    );
  });
});
