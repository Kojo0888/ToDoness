/** Read-only queries the screens use (wrapped in live queries). */
import Dexie from 'dexie';
import type { List, ListModule, Note, OutboxOp, Todo } from '@todoness/shared';
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
