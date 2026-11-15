/** What the views draw: events and, read-only, tasks with a due date (docs/calendar/PRD.md). */
import type { CalendarColor, CalendarEvent, Calendar, EventTime } from '@todoness/shared';
import type { DueTask } from '../../data/queries';
import { t } from '../../app/strings';
import { eventPath } from './paths';
import { timeText } from './format';

export interface CalItem extends EventTime {
  /** Unique among the items shown. */
  key: string;
  kind: 'event' | 'task';
  href: string;
  color: CalendarColor | null;
  /** Place of an event, or the list of a task. */
  detail: string;
  /** The accessible name: title and when. */
  label: string;
}

export function eventItems(
  events: readonly CalendarEvent[],
  calendars: readonly Calendar[],
  hidden: ReadonlySet<string>,
): CalItem[] {
  const colours = new Map(calendars.map((c) => [c.id, c.color]));
  return events
    .filter((e) => !hidden.has(e.calendarId) && colours.has(e.calendarId))
    .map((e) => ({
      key: `event:${e.id}`,
      kind: 'event' as const,
      title: e.title,
      start: e.start,
      days: e.days,
      startTime: e.startTime,
      endTime: e.endTime,
      href: eventPath(e.id),
      color: colours.get(e.calendarId) ?? 'blue',
      detail: e.place,
      label: t.calendar.eventLabel(e.title, `${e.start}, ${timeText(e)}`),
    }));
}

export function taskItems(tasks: readonly DueTask[]): CalItem[] {
  return tasks.map((task) => ({
    key: `task:${task.id}`,
    kind: 'task' as const,
    title: task.title,
    start: task.day,
    days: 1,
    startTime: null,
    endTime: null,
    href: `/l/${task.listId}/t/${task.id}`,
    color: null,
    detail: t.calendar.taskDue(task.listName),
    label: t.calendar.taskLabel(task.title, task.day),
  }));
}
