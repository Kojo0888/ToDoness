/**
 * Public lists (docs/v1/PRD.md section 4.2). Read-only, for every logged-in user.
 * They are read on demand and are not part of anybody else's sync feed.
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  idSchema,
  type PublicListResponse,
  type PublicListsResponse,
  type PublicTodo,
} from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import type { AppEnv } from '../types';

export function publicRoutes({ db, now }: { db: Database.Database; now: () => number }) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(db, now));

  /** The public lists of other users. */
  app.get('/lists', (c) => {
    const rows = db
      .prepare(
        `SELECT l.id, l.name, u.email AS owner_email
           FROM lists l JOIN users u ON u.id = l.user_id
          WHERE l.is_public = 1 AND l.deleted_at IS NULL AND l.user_id != ?
          ORDER BY u.email COLLATE NOCASE, l.order_key, l.id`,
      )
      .all(c.get('user').id) as { id: string; name: string; owner_email: string }[];
    const body: PublicListsResponse = {
      lists: rows.map((r) => ({ id: r.id, name: r.name, ownerEmail: r.owner_email })),
    };
    return c.json(body);
  });

  /** One public list with its tasks and their attachments (any logged-in user). */
  app.get('/lists/:id', (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);

    const list = db
      .prepare(
        `SELECT l.id, l.name, u.email AS owner_email
           FROM lists l JOIN users u ON u.id = l.user_id
          WHERE l.id = ? AND l.is_public = 1 AND l.deleted_at IS NULL`,
      )
      .get(id.data) as { id: string; name: string; owner_email: string } | undefined;
    if (!list) return c.json({ error: 'not_found' }, 404);

    const todos = db
      .prepare(
        `SELECT id, title, notes, done, completed_at, due_at, priority
           FROM todos WHERE list_id = ? AND deleted_at IS NULL
          ORDER BY order_key, id`,
      )
      .all(id.data) as {
      id: string;
      title: string;
      notes: string;
      done: number;
      completed_at: number | null;
      due_at: number | null;
      priority: number;
    }[];

    const files = db
      .prepare(
        `SELECT a.id, a.todo_id, a.name, a.size, a.content_type, a.created_at
           FROM attachments a JOIN todos t ON t.id = a.todo_id
          WHERE t.list_id = ? AND t.deleted_at IS NULL
          ORDER BY a.created_at, a.rowid`,
      )
      .all(id.data) as {
      id: string;
      todo_id: string;
      name: string;
      size: number;
      content_type: string;
      created_at: number;
    }[];
    const byTodo = new Map<string, PublicTodo['attachments']>();
    for (const f of files) {
      const list = byTodo.get(f.todo_id) ?? [];
      list.push({
        id: f.id,
        name: f.name,
        size: f.size,
        contentType: f.content_type,
        createdAt: f.created_at,
      });
      byTodo.set(f.todo_id, list);
    }

    const body: PublicListResponse = {
      list: { id: list.id, name: list.name, ownerEmail: list.owner_email },
      todos: todos.map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        done: t.done === 1,
        completedAt: t.completed_at,
        dueAt: t.due_at,
        priority: t.priority,
        attachments: byTodo.get(t.id) ?? [],
      })),
    };
    return c.json(body);
  });

  return app;
}
