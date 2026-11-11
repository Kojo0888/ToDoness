import { describe, expect, it } from 'vitest';
import { REMIND_MS, latestDueChoice, reminderKey } from '../src/reminders';

const H = 3_600_000;
const due = 1_800_000_000_000;

describe('reminders with several choices', () => {
  it('keeps the v1 key format for one choice', () => {
    expect(reminderKey({ id: 'a', dueAt: due }, 'day')).toBe(`a:${due}:day`);
  });

  it('nothing is due before the earliest reminder time or after the due date', () => {
    const t = { dueAt: due, remindBefore: ['week', 'hour'] as const };
    expect(latestDueChoice(t, due - REMIND_MS.week - 1)).toBeNull();
    expect(latestDueChoice(t, due)).toBeNull();
    expect(latestDueChoice({ dueAt: null, remindBefore: ['hour'] }, due)).toBeNull();
    expect(latestDueChoice({ dueAt: due, remindBefore: [] }, due - 1)).toBeNull();
  });

  it('picks each choice when its time comes', () => {
    const t = { dueAt: due, remindBefore: ['week', 'day', 'hour'] as const };
    expect(latestDueChoice(t, due - REMIND_MS.week)).toBe('week');
    expect(latestDueChoice(t, due - 2 * H)).toBe('day');
    expect(latestDueChoice(t, due - H + 1)).toBe('hour');
  });

  it('when several are already due, only the latest one counts (no burst)', () => {
    const t = { dueAt: due, remindBefore: ['week', 'day'] as const };
    expect(latestDueChoice(t, due - 10 * H)).toBe('day');
  });
});

describe('reminders for older app versions', () => {
  it('a list becomes the single v1 value: the earliest chosen reminder, or null', async () => {
    const { toLegacyRemindBefore } = await import('../src/schemas');
    expect(toLegacyRemindBefore([])).toBeNull();
    expect(toLegacyRemindBefore(['hour'])).toBe('hour');
    expect(toLegacyRemindBefore(['day', 'hour'])).toBe('day');
    expect(toLegacyRemindBefore(['week', 'day', 'hour'])).toBe('week');
  });

  it('one rule reads v1 values, for the sync check and for stored rows alike', async () => {
    const { legacyRemindList, normalizeRemindBefore } = await import('../src/schemas');
    expect(legacyRemindList(null)).toEqual([]);
    expect(legacyRemindList(undefined)).toEqual([]);
    expect(legacyRemindList('day')).toEqual(['day']);
    expect(legacyRemindList(['hour'])).toEqual(['hour']);
    // the sync check keeps invalid values so it can reject them; stored rows drop them
    expect(legacyRemindList('month')).toEqual(['month']);
    expect(normalizeRemindBefore('month')).toEqual([]);
  });
});
