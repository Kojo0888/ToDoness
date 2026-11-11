/** The device switch for local notifications (docs/note-lists/PRD.md FR-120, decision S1). */
import { describe, expect, it } from 'vitest';
import {
  localNotificationsOn,
  setLocalNotifications,
  type KeyValueStore,
} from '../../src/lib/notifyPref';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('local notifications preference', () => {
  it('is on until the user turns it off, and remembers the choice', () => {
    const s = memory();
    expect(localNotificationsOn(s)).toBe(true);
    setLocalNotifications(s, false);
    expect(localNotificationsOn(s)).toBe(false);
    setLocalNotifications(s, true);
    expect(localNotificationsOn(s)).toBe(true);
  });

  it('stays on when storage is missing or blocked', () => {
    expect(localNotificationsOn(undefined)).toBe(true);
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(localNotificationsOn(blocked)).toBe(true);
    expect(() => setLocalNotifications(blocked, false)).not.toThrow();
  });
});
