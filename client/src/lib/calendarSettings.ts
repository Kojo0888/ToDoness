/**
 * Device settings of the calendar (docs/calendar/PRD.md decision C4): the view, the calendars
 * hidden on this device and whether tasks are shown. They live in `localStorage`, like the
 * Plan options, and survive blocked storage.
 */
import { CALENDAR_VIEWS, type CalendarView } from './calendarGrid';
import type { KeyValueStore } from './modules';

const VIEW_KEY = 'todoness.calendar.view';
const HIDDEN_KEY = 'todoness.calendar.hidden';
const TASKS_KEY = 'todoness.calendar.tasks';

/** The chosen view; Agenda on a phone and Month on a computer until one is chosen (FR-213). */
export function readCalendarView(
  storage: KeyValueStore | undefined,
  isPhone: boolean,
): CalendarView {
  try {
    const v = storage?.getItem(VIEW_KEY);
    const known = CALENDAR_VIEWS.find((x) => x === v);
    if (known) return known;
  } catch {
    /* storage blocked */
  }
  return isPhone ? 'agenda' : 'month';
}

export function saveCalendarView(storage: KeyValueStore | undefined, view: CalendarView): void {
  try {
    storage?.setItem(VIEW_KEY, view);
  } catch {
    /* storage may be blocked; the choice then lasts until reload */
  }
}

export function readHiddenCalendars(storage: KeyValueStore | undefined): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(HIDDEN_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set(); // blocked storage or broken data
  }
}

export function saveHiddenCalendars(
  storage: KeyValueStore | undefined,
  hidden: ReadonlySet<string>,
): void {
  try {
    storage?.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    /* storage may be blocked */
  }
}

/** A copy of `hidden` with `id` hidden, or shown again if it was hidden. */
export function toggleHidden(hidden: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(hidden);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Tasks with a due date are shown unless the user turned them off (FR-215). */
export function readShowTasks(storage: KeyValueStore | undefined): boolean {
  try {
    return storage?.getItem(TASKS_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveShowTasks(storage: KeyValueStore | undefined, show: boolean): void {
  try {
    storage?.setItem(TASKS_KEY, show ? '1' : '0');
  } catch {
    /* storage may be blocked */
  }
}
