/** Converting between database rows (snake_case, 0/1, JSON text) and shared types. */
import type Database from 'better-sqlite3';
import type { List, Todo } from '@todoness/shared';

interface TodoDb {
  id: string;
  list_id: string;
  title: string;
  notes: string;
  done: number;
  completed_at: number | null;
  due_at: number | null;
  priority: number;
  order_key: string;
  field_hlc: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface ListDb {
  id: string;
  name: string;
  is_inbox: number;
  order_key: string;
  field_hlc: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Row plus the owner, for ownership checks. */
export interface Owned<T> {
  row: T;
  userId: string;
}

export function getTodo(db: Database.Database, id: string): Owned<Todo> | undefined {
  const r = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as
    (TodoDb & { user_id: string }) | undefined;
  if (!r) return undefined;
  return {
    userId: r.user_id,
    row: {
      id: r.id,
      listId: r.list_id,
      title: r.title,
      notes: r.notes,
      done: r.done === 1,
      completedAt: r.completed_at,
      dueAt: r.due_at,
      priority: r.priority as Todo['priority'],
      orderKey: r.order_key,
      fieldHlc: JSON.parse(r.field_hlc),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    },
  };
}

export function saveTodo(db: Database.Database, userId: string, t: Todo): void {
  db.prepare(
    `INSERT INTO todos (id, user_id, list_id, title, notes, done, completed_at, due_at, priority,
                        order_key, field_hlc, created_at, updated_at, deleted_at)
     VALUES (@id, @userId, @listId, @title, @notes, @done, @completedAt, @dueAt, @priority,
             @orderKey, @fieldHlc, @createdAt, @updatedAt, @deletedAt)
     ON CONFLICT(id) DO UPDATE SET
       list_id = excluded.list_id, title = excluded.title, notes = excluded.notes,
       done = excluded.done, completed_at = excluded.completed_at, due_at = excluded.due_at,
       priority = excluded.priority, order_key = excluded.order_key,
       field_hlc = excluded.field_hlc, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
  ).run({ ...t, userId, done: t.done ? 1 : 0, fieldHlc: JSON.stringify(t.fieldHlc) });
}

export function getList(db: Database.Database, id: string): Owned<List> | undefined {
  const r = db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as
    (ListDb & { user_id: string }) | undefined;
  if (!r) return undefined;
  return {
    userId: r.user_id,
    row: {
      id: r.id,
      name: r.name,
      isInbox: r.is_inbox === 1,
      orderKey: r.order_key,
      fieldHlc: JSON.parse(r.field_hlc),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    },
  };
}

export function saveList(db: Database.Database, userId: string, l: List): void {
  db.prepare(
    `INSERT INTO lists (id, user_id, name, is_inbox, order_key, field_hlc, created_at, updated_at, deleted_at)
     VALUES (@id, @userId, @name, @isInbox, @orderKey, @fieldHlc, @createdAt, @updatedAt, @deletedAt)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, order_key = excluded.order_key, field_hlc = excluded.field_hlc,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
  ).run({ ...l, userId, isInbox: l.isInbox ? 1 : 0, fieldHlc: JSON.stringify(l.fieldHlc) });
}

/** The owner of a list, if it exists (deleted lists still count). */
export function listOwner(db: Database.Database, id: string): string | undefined {
  const r = db.prepare('SELECT user_id FROM lists WHERE id = ?').get(id) as
    { user_id: string } | undefined;
  return r?.user_id;
}
