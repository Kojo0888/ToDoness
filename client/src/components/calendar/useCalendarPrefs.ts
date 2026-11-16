import { useSyncExternalStore } from 'react';
import { useIsPhone } from '../../app/hooks';
import type { CalendarView } from '../../lib/calendarGrid';
import {
  readCalendarView,
  readHiddenCalendars,
  readShowTasks,
  saveCalendarView,
  saveHiddenCalendars,
  saveShowTasks,
  toggleHidden,
} from '../../lib/calendarSettings';
import { browserStorage } from '../../lib/modules';

/**
 * The device settings of the calendar as one small store, so the sidebar (which calendars are
 * shown) and the page (view, tasks) see each other's changes at once (decision C4).
 */
interface Snapshot {
  view: CalendarView | undefined;
  hidden: ReadonlySet<string>;
  showTasks: boolean;
}

const listeners = new Set<() => void>();
let snapshot: Snapshot | undefined;

function read(): Snapshot {
  const storage = browserStorage();
  const stored = readCalendarView(storage, true) === readCalendarView(storage, false);
  return {
    // The default view depends on the screen, so only a stored choice is kept here.
    view: stored ? readCalendarView(storage, false) : undefined,
    hidden: readHiddenCalendars(storage),
    showTasks: readShowTasks(storage),
  };
}

function current(): Snapshot {
  return (snapshot ??= read());
}

function update(change: Partial<Snapshot>) {
  snapshot = { ...current(), ...change };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useCalendarPrefs() {
  const s = useSyncExternalStore(subscribe, current);
  const isPhone = useIsPhone();
  return {
    view: s.view ?? (isPhone ? 'agenda' : 'month'),
    hidden: s.hidden,
    showTasks: s.showTasks,
    setView(view: CalendarView) {
      saveCalendarView(browserStorage(), view);
      update({ view });
    },
    toggleCalendar(id: string) {
      const hidden = toggleHidden(current().hidden, id);
      saveHiddenCalendars(browserStorage(), hidden);
      update({ hidden });
    },
    setShowTasks(show: boolean) {
      saveShowTasks(browserStorage(), show);
      update({ showTasks: show });
    },
  };
}
