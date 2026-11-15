/** Read-only queries the screens use (wrapped in live queries). */
import Dexie from 'dexie';
import {
  addDays,
  dayNumber,
  eventSpan,
  localDay,
  type Activity,
  type Calendar,
  type CalendarEvent,
  type List,
  type ListModule,
  type Note,
  type OutboxOp,
  type Plan,
  type Todo,
} from '@todoness/shared';
import type { PublicOp, TodonessDB } from './db';

/** A stored list's module; rows written before note lists have none (task lists). */
export const moduleOf = (l: Pick<List, 'module'>): ListModule => l.module ?? 'tasks';

const liveOf = (all: List[], module: ListModule) =>
  all.filter((l) => l.deletedAt === null && moduleOf(l) === module);

/** The task lists, Inbox first (it has the lowest key). */
export async function getLists(db: TodonessDB): Promise<List[]> {
  return liveOf(await db.lists.orderBy('orderKey').toArray(), 'tasks');
}

/**
 * The note lists, "My notes" first (docs/note-lists FR-126). "My notes" may not be here yet
 * (the server creates it at the first sync); callers show its default name then.
 */
export async function getNoteLists(db: TodonessDB): Promise<List[]> {
  const lists = liveOf(await db.lists.orderBy('orderKey').toArray(), 'notes');
  return [...lists.filter((l) => l.isInbox), ...lists.filter((l) => !l.isInbox)];
}

/** Number of open tasks of each task list that has any (FR-132). */
export async function countOpenTodosByList(db: TodonessDB): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const t of await db.todos.toArray()) {
    if (t.deletedAt !== null || t.done) continue;
    counts.set(t.listId, (counts.get(t.listId) ?? 0) + 1);
  }
  return counts;
}

/** Number of live notes in each note list (`null` = My notes). */
export async function countNotesByList(db: TodonessDB): Promise<Map<string | null, number>> {
  // Both tables in one await: live queries lose track of reads after nested awaits.
  const [lists, notes] = await Promise.all([db.lists.toArray(), db.notes.toArray()]);
  const key = noteListKey(lists);
  const counts = new Map<string | null, number>();
  for (const n of notes) {
    if (n.deletedAt === null) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1);
  }
  return counts;
}

/**
 * The list of a note, with "My notes" as `null`: this app writes `null` for it, but a note
 * may also name the list's id (both mean the same, decision L2).
 */
export function noteListKey(lists: readonly List[]): (n: Note) => string | null {
  const myNotes = lists.find(
    (l) => l.deletedAt === null && l.isInbox && moduleOf(l) === 'notes',
  )?.id;
  return (n) => (n.listId == null || n.listId === myNotes ? null : n.listId);
}

export async function getInbox(db: TodonessDB): Promise<List | undefined> {
  return (await getLists(db)).find((l) => l.isInbox);
}

async function todosOfList(db: TodonessDB, listId: string): Promise<Todo[]> {
  const rows = await db.todos
    .where('[listId+orderKey]')
    .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
    .toArray();
  return rows.filter((t) => t.deletedAt === null);
}

/** Open todos of a list, in the user's order (newest on top unless moved). */
export async function getOpenTodos(db: TodonessDB, listId: string): Promise<Todo[]> {
  return (await todosOfList(db, listId)).filter((t) => !t.done);
}

/** Finished todos of a list, most recently completed first. */
export async function getDoneTodos(db: TodonessDB, listId: string): Promise<Todo[]> {
  return (await todosOfList(db, listId))
    .filter((t) => t.done)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export async function getTodoById(db: TodonessDB, id: string): Promise<Todo | undefined> {
  const t = await db.todos.get(id);
  return t && t.deletedAt === null ? t : undefined;
}

/** Changes waiting to be sent: own ones and those to other users' public data. */
export async function countPending(db: TodonessDB): Promise<number> {
  return (await db.outbox.count()) + (await db.publicOutbox.count());
}

/** Both queues of changes not yet accepted by the server, raw and oldest first (admin). */
export async function getQueuedChanges(
  db: TodonessDB,
): Promise<{ outbox: OutboxOp[]; publicOutbox: PublicOp[] }> {
  return {
    outbox: await db.outbox.orderBy('hlc').toArray(),
    publicOutbox: await db.publicOutbox.orderBy('hlc').toArray(),
  };
}

/** Live notes, newest first (a new note gets a key before all others). */
export async function getNotes(db: TodonessDB): Promise<Note[]> {
  const all = await db.notes.orderBy('orderKey').toArray();
  return all.filter((n) => n.deletedAt === null);
}

/** Live notes of one note list (`null` = My notes), newest first. */
export async function getNotesOfList(db: TodonessDB, listId: string | null): Promise<Note[]> {
  const [lists, notes] = await Promise.all([
    db.lists.toArray(),
    db.notes.orderBy('orderKey').toArray(),
  ]);
  const key = noteListKey(lists);
  return notes.filter((n) => n.deletedAt === null && key(n) === listId);
}

export async function getNoteById(db: TodonessDB, id: string): Promise<Note | undefined> {
  const n = await db.notes.get(id);
  return n && n.deletedAt === null ? n : undefined;
}

/** Live plans, oldest first (a new plan goes to the end, like a new list). */
export async function getPlans(db: TodonessDB): Promise<Plan[]> {
  const all = await db.plans.orderBy('orderKey').toArray();
  return all.filter((p) => p.deletedAt === null);
}

export async function getPlanById(db: TodonessDB, id: string): Promise<Plan | undefined> {
  const p = await db.plans.get(id);
  return p && p.deletedAt === null ? p : undefined;
}

/** Number of live activities in each plan, done ones included (sidebar, FR-160). */
export async function countActivitiesByPlan(db: TodonessDB): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const a of await db.activities.toArray()) {
    if (a.deletedAt === null) counts.set(a.planId, (counts.get(a.planId) ?? 0) + 1);
  }
  return counts;
}

/** The live activities of a plan, in row order (a new one goes to the bottom). */
export async function getActivities(db: TodonessDB, planId: string): Promise<Activity[]> {
  const rows = await db.activities
    .where('[planId+orderKey]')
    .between([planId, Dexie.minKey], [planId, Dexie.maxKey])
    .toArray();
  return rows.filter((a) => a.deletedAt === null);
}

/** Live calendars in their order (a new one goes last). */
export async function getCalendars(db: TodonessDB): Promise<Calendar[]> {
  return (await db.calendars.orderBy('orderKey').toArray()).filter((c) => c.deletedAt === null);
}

export async function getEventById(db: TodonessDB, id: string): Promise<CalendarEvent | undefined> {
  const e = await db.events.get(id);
  return e && e.deletedAt === null ? e : undefined;
}

/** The longest an event can last: it bounds how far back an event can start and still reach in. */
const LOOKBACK_DAYS = 366;

/**
 * Live events of live calendars that touch the days `from` … `to` (both included): they start
 * inside, or start earlier and run into it (all-day events of several days).
 */
export async function getEventsInRange(
  db: TodonessDB,
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const liveCalendars = new Set((await getCalendars(db)).map((c) => c.id));
  const candidates = await db.events
    .where('start')
    .between(addDays(from, -LOOKBACK_DAYS), to, true, true)
    .toArray();
  return candidates.filter(
    (e) =>
      e.deletedAt === null &&
      liveCalendars.has(e.calendarId) &&
      dayNumber(eventSpan(e).endDay) >= dayNumber(from),
  );
}

/** A task with a due date, as the calendar shows it (docs/calendar/PRD.md FR-215). */
export interface DueTask {
  id: string;
  title: string;
  listId: string;
  listName: string;
  /** The due day on this device's calendar. */
  day: string;
}

/** Open tasks of live task lists whose due day (local time) is within `from` … `to`. */
export async function getDueTasks(db: TodonessDB, from: string, to: string): Promise<DueTask[]> {
  const lists = new Map(
    (await db.lists.toArray())
      .filter((l) => l.deletedAt === null && moduleOf(l) === 'tasks')
      .map((l) => [l.id, l.name]),
  );
  const out: DueTask[] = [];
  for (const t of await db.todos.toArray()) {
    if (t.deletedAt !== null || t.done || t.dueAt === null) continue;
    const listName = lists.get(t.listId);
    if (listName === undefined) continue;
    const day = localDay(t.dueAt);
    if (day < from || day > to) continue;
    out.push({ id: t.id, title: t.title, listId: t.listId, listName, day });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
}
