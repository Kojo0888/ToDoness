/** Read-only queries the screens use (wrapped in live queries). */
import Dexie from 'dexie';
import type { Activity, List, Note, OutboxOp, Plan, Todo } from '@todoness/shared';
import type { PublicOp, TodonessDB } from './db';

export async function getLists(db: TodonessDB): Promise<List[]> {
  const all = await db.lists.orderBy('orderKey').toArray();
  return all.filter((l) => l.deletedAt === null);
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

/** The live activities of a plan, in row order (a new one goes to the bottom). */
export async function getActivities(db: TodonessDB, planId: string): Promise<Activity[]> {
  const rows = await db.activities
    .where('[planId+orderKey]')
    .between([planId, Dexie.minKey], [planId, Dexie.maxKey])
    .toArray();
  return rows.filter((a) => a.deletedAt === null);
}
