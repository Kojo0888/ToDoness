/** Device settings of the calendar (docs/calendar/PRD.md decision C4). */
import { describe, expect, it } from 'vitest';
import {
  readCalendarView,
  readHiddenCalendars,
  readShowTasks,
  saveCalendarView,
  saveHiddenCalendars,
  saveShowTasks,
  toggleHidden,
} from '../../src/lib/calendarSettings';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}
const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('view', () => {
  it('defaults to Agenda on a phone and Month on a computer', () => {
    expect(readCalendarView(memoryStorage(), true)).toBe('agenda');
    expect(readCalendarView(memoryStorage(), false)).toBe('month');
  });

  it('remembers the choice and ignores nonsense', () => {
    const s = memoryStorage();
    saveCalendarView(s, 'week');
    expect(readCalendarView(s, true)).toBe('week');
    expect(readCalendarView(memoryStorage({ 'todoness.calendar.view': 'day' }), false)).toBe(
      'month',
    );
  });

  it('survives blocked storage', () => {
    expect(readCalendarView(broken, false)).toBe('month');
    expect(() => saveCalendarView(broken, 'week')).not.toThrow();
    expect(readCalendarView(undefined, true)).toBe('agenda');
  });
});

describe('hidden calendars', () => {
  it('starts empty; toggling hides and shows again', () => {
    const s = memoryStorage();
    expect(readHiddenCalendars(s)).toEqual(new Set());
    saveHiddenCalendars(s, toggleHidden(readHiddenCalendars(s), 'a'));
    saveHiddenCalendars(s, toggleHidden(readHiddenCalendars(s), 'b'));
    expect(readHiddenCalendars(s)).toEqual(new Set(['a', 'b']));
    saveHiddenCalendars(s, toggleHidden(readHiddenCalendars(s), 'a'));
    expect(readHiddenCalendars(s)).toEqual(new Set(['b']));
  });

  it('survives broken data and blocked storage', () => {
    expect(readHiddenCalendars(memoryStorage({ 'todoness.calendar.hidden': '{oops' }))).toEqual(
      new Set(),
    );
    expect(readHiddenCalendars(memoryStorage({ 'todoness.calendar.hidden': '[1,"x"]' }))).toEqual(
      new Set(['x']),
    );
    expect(readHiddenCalendars(broken)).toEqual(new Set());
    expect(() => saveHiddenCalendars(broken, new Set(['a']))).not.toThrow();
  });
});

describe('show tasks', () => {
  it('is on by default and remembers off', () => {
    const s = memoryStorage();
    expect(readShowTasks(s)).toBe(true);
    saveShowTasks(s, false);
    expect(readShowTasks(s)).toBe(false);
    saveShowTasks(s, true);
    expect(readShowTasks(s)).toBe(true);
    expect(readShowTasks(broken)).toBe(true);
  });
});
