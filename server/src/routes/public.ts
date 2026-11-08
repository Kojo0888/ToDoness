/**
 * Public lists (docs/v1/PRD.md section 4.2). Read-only, for every logged-in user.
 * They are read on demand and are not part of anybody else's sync feed.
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  idSchema,
  pushEnvelopeSchema,
  type PublicListResponse,
  type PublicListsResponse,
  type PublicTodo,
} from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import { applyPush } from '../sync/apply-ops';
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
        `SELECT id, title, notes, done, completed_at, due_at, priority, order_key
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
      order_key: string;
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
        orderKey: t.order_key,
        attachments: byTodo.get(t.id) ?? [],
      })),
    };
    return c.json(body);
  });

  /**
   * Edit a public list (FR-33): the same operations as the normal push, but only task
   * operations inside this list. The rows belong to the owner, so the change reaches the
   * owner's devices through their normal pull.
   */
  app.post(
    '/lists/:id/push',
    bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      const id = idSchema.safeParse(c.req.param('id'));
      const list = id.success
        ? (db
            .prepare(
              'SELECT user_id FROM lists WHERE id = ? AND is_public = 1 AND deleted_at IS NULL',
            )
            .get(id.data) as { user_id: string } | undefined)
        : undefined;
      if (!id.success || !list) return c.json({ error: 'not_found' }, 404);

      const parsed = pushEnvelopeSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
      const { clientId, ops } = parsed.data;
      return c.json(
        applyPush(db, list.user_id, clientId, ops, now(), {
          actorId: c.get('user').id,
          onlyListId: id.data,
        }),
      );
    },
  );

  return app;
}
