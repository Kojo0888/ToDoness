/**
 * Public lists (docs/v1/PRD.md section 4.2) and public notes (docs/notes/PRD.md section 4.3),
 * for every logged-in user. They are read on demand and are not part of anybody else's sync
 * feed; edits go through a restricted push into the owner's data.
 */
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  idSchema,
  pushEnvelopeSchema,
  type PublicListResponse,
  type PublicListsResponse,
  type PublicNotesResponse,
  type PublicTodo,
} from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import { applyPush } from '../sync/apply-ops';
import type { AppEnv } from '../http/types';

/**
 * Answers with an ETag (a hash of the body), and with 304 when the client already has it.
 * The public data is polled every few seconds; this keeps unchanged answers tiny, and the
 * client does not rewrite its copy (docs/notes/ImplementationPlan.md, review fixes).
 */
/**
 * Does If-None-Match name this ETag? Compared weakly, as RFC 9110 asks for If-None-Match: a
 * compressing proxy turns `"x"` into `W/"x"`. Also takes a list of tags, and `*`.
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === opaque(etag));
}

function jsonWithEtag(c: Context<AppEnv>, body: unknown) {
  const text = JSON.stringify(body);
  const etag = `"${createHash('sha1').update(text).digest('base64url')}"`;
  c.header('ETag', etag);
  c.header('Cache-Control', 'no-cache');
  if (etagMatches(c.req.header('if-none-match'), etag)) return c.body(null, 304);
  return c.body(text, 200, { 'content-type': 'application/json; charset=UTF-8' });
}

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
    return jsonWithEtag(c, body);
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
    return jsonWithEtag(c, body);
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

  /** The public notes of other users, newest change first (FR-95). */
  app.get('/notes', (c) => {
    const rows = db
      .prepare(
        `SELECT n.id, n.text, n.updated_at, u.email AS owner_email
           FROM notes n JOIN users u ON u.id = n.user_id
          WHERE n.is_public = 1 AND n.deleted_at IS NULL AND n.user_id != ?
          ORDER BY n.updated_at DESC, n.id`,
      )
      .all(c.get('user').id) as {
      id: string;
      text: string;
      updated_at: number;
      owner_email: string;
    }[];
    const body: PublicNotesResponse = {
      notes: rows.map((r) => ({
        id: r.id,
        text: r.text,
        ownerEmail: r.owner_email,
        updatedAt: r.updated_at,
      })),
    };
    return jsonWithEtag(c, body);
  });

  /** Change the text of a public note (FR-96): only text updates of this one note. */
  app.post(
    '/notes/:id/push',
    bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      const id = idSchema.safeParse(c.req.param('id'));
      const note = id.success
        ? (db
            .prepare(
              'SELECT user_id FROM notes WHERE id = ? AND is_public = 1 AND deleted_at IS NULL',
            )
            .get(id.data) as { user_id: string } | undefined)
        : undefined;
      if (!id.success || !note) return c.json({ error: 'not_found' }, 404);

      const parsed = pushEnvelopeSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
      const { clientId, ops } = parsed.data;
      return c.json(
        applyPush(db, note.user_id, clientId, ops, now(), {
          actorId: c.get('user').id,
          onlyNoteId: id.data,
        }),
      );
    },
  );

  return app;
}
