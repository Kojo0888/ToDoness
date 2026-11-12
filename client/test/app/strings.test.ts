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

  it('says what the server and the device hold when they differ (docs/recovery-upload FR-169)', () => {
    expect(
      t.recovery.differs(
        'a@b.co',
        { todos: 1, lists: 0, notes: 1 },
        { todos: 4, lists: 1, notes: 2, plans: 1 },
      ),
    ).toBe(
      'The server already holds 4 tasks, 1 list (besides the Inbox), 2 notes and 1 plan for this account, and this device holds 1 task, 0 lists (besides the Inbox) and 1 note of a@b.co. They are not the same.',
    );
  });
});
