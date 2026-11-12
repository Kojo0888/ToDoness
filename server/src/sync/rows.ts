/** Converting between database rows (snake_case, 0/1, JSON text) and shared types. */
import type Database from 'better-sqlite3';
import {
  normalizeRemindBefore,
  type Activity,
  type List,
  type ListModule,
  type Note,
  type Plan,
  type Todo,
} from '@todoness/shared';

interface TodoDb {
  id: string;
  list_id: string;
  title: string;
  notes: string;
  done: number;
  completed_at: number | null;
  due_at: number | null;
  priority: number;
  reminders: string;
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
  is_public: number;
  module: ListModule;
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
      remindBefore: normalizeRemindBefore(r.reminders ? r.reminders.split(',') : []),
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
                        reminders, order_key, field_hlc, created_at, updated_at, deleted_at)
     VALUES (@id, @userId, @listId, @title, @notes, @done, @completedAt, @dueAt, @priority,
             @reminders, @orderKey, @fieldHlc, @createdAt, @updatedAt, @deletedAt)
     ON CONFLICT(id) DO UPDATE SET
       list_id = excluded.list_id, title = excluded.title, notes = excluded.notes,
       done = excluded.done, completed_at = excluded.completed_at, due_at = excluded.due_at,
       priority = excluded.priority, reminders = excluded.reminders,
       order_key = excluded.order_key,
       field_hlc = excluded.field_hlc, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
  ).run({
    ...t,
    userId,
    done: t.done ? 1 : 0,
    reminders: normalizeRemindBefore(t.remindBefore).join(','),
    fieldHlc: JSON.stringify(t.fieldHlc),
  });
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
      isPublic: r.is_public === 1,
      module: r.module,
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
    `INSERT INTO lists (id, user_id, name, is_inbox, is_public, module, order_key, field_hlc, created_at, updated_at, deleted_at)
     VALUES (@id, @userId, @name, @isInbox, @isPublic, @module, @orderKey, @fieldHlc, @createdAt, @updatedAt, @deletedAt)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, is_public = excluded.is_public, order_key = excluded.order_key,
       field_hlc = excluded.field_hlc,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
  ).run({
    ...l,
    userId,
    isInbox: l.isInbox ? 1 : 0,
    isPublic: l.isPublic ? 1 : 0,
    fieldHlc: JSON.stringify(l.fieldHlc),
  });
}

/** The owner and module of a list, if it exists (deleted lists still count). */
export function listOwner(
  db: Database.Database,
  id: string,
): { userId: string; module: ListModule } | undefined {
  const r = db.prepare('SELECT user_id, module FROM lists WHERE id = ?').get(id) as
    { user_id: string; module: ListModule } | undefined;
  return r && { userId: r.user_id, module: r.module };
}

interface NoteDb {
  id: string;
  user_id: string;
  text: string;
  list_id: string | null;
  is_public: number;
  order_key: string;
  field_hlc: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export function getNote(db: Database.Database, id: string): Owned<Note> | undefined {
  const r = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteDb | undefined;
  if (!r) return undefined;
  return {
    userId: r.user_id,
    row: {
      id: r.id,
      text: r.text,
      listId: r.list_id,
      isPublic: r.is_public === 1,
      orderKey: r.order_key,
      fieldHlc: JSON.parse(r.field_hlc),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    },
  };
}

export function saveNote(db: Database.Database, userId: string, n: Note): void {
  db.prepare(
    `INSERT INTO notes (id, user_id, text, list_id, is_public, order_key, field_hlc, created_at, updated_at, deleted_at)
     VALUES (@id, @userId, @text, @listId, @isPublic, @orderKey, @fieldHlc, @createdAt, @updatedAt, @deletedAt)
     ON CONFLICT(id) DO UPDATE SET
       text = excluded.text, list_id = excluded.list_id, is_public = excluded.is_public, order_key = excluded.order_key,
       field_hlc = excluded.field_hlc,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
  ).run({
    ...n,
    userId,
    isPublic: n.isPublic ? 1 : 0,
    fieldHlc: JSON.stringify(n.fieldHlc),
  });
}

interface PlanDb {
  id: string;
  user_id: string;
  name: string;
  order_key: string;
  field_hlc: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export function getPlan(db: Database.Database, id: string): Owned<Plan> | undefined {
  const r = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanDb | undefined;
  if (!r) return undefined;
  return {
    userId: r.user_id,
    row: {
      id: r.id,
      name: r.name,
      orderKey: r.order_key,
      fieldHlc: JSON.parse(r.field_hlc),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    },
  };
}

export function savePlan(db: Database.Database, userId: string, p: Plan): void {
  db.prepare(
    `INSERT INTO plans (id, user_id, name, order_key, field_hlc, created_at, updated_at, deleted_at)
     VALUES (@id, @userId, @name, @orderKey, @fieldHlc, @createdAt, @updatedAt, @deletedAt)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, order_key = excluded.order_key, field_hlc = excluded.field_hlc,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
  ).run({ ...p, userId, fieldHlc: JSON.stringify(p.fieldHlc) });
}

/** The owner of a plan, if it exists (deleted plans still count). */
export function planOwner(db: Database.Database, id: string): string | undefined {
  const r = db.prepare('SELECT user_id FROM plans WHERE id = ?').get(id) as
    { user_id: string } | undefined;
  return r?.user_id;
}

interface ActivityDb {
  id: string;
  user_id: string;
  plan_id: string;
  name: string;
  start_day: string;
  days: number;
  depends_on: string;
  order_key: string;
  field_hlc: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export function getActivity(db: Database.Database, id: string): Owned<Activity> | undefined {
  const r = db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as ActivityDb | undefined;
  if (!r) return undefined;
  return {
    userId: r.user_id,
    row: {
      id: r.id,
      planId: r.plan_id,
      name: r.name,
      start: r.start_day,
      days: r.days,
      dependsOn: JSON.parse(r.depends_on),
      orderKey: r.order_key,
      fieldHlc: JSON.parse(r.field_hlc),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    },
  };
}

export function saveActivity(db: Database.Database, userId: string, a: Activity): void {
  db.prepare(
    `INSERT INTO activities (id, user_id, plan_id, name, start_day, days, depends_on, order_key,
                             field_hlc, created_at, updated_at, deleted_at)
     VALUES (@id, @userId, @planId, @name, @start, @days, @dependsOn, @orderKey,
             @fieldHlc, @createdAt, @updatedAt, @deletedAt)
     ON CONFLICT(id) DO UPDATE SET
       plan_id = excluded.plan_id, name = excluded.name, start_day = excluded.start_day,
       days = excluded.days, depends_on = excluded.depends_on, order_key = excluded.order_key,
       field_hlc = excluded.field_hlc, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
  ).run({
    ...a,
    userId,
    dependsOn: JSON.stringify(a.dependsOn),
    fieldHlc: JSON.stringify(a.fieldHlc),
  });
}
