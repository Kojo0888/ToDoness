/** Attachments on tasks (docs/v1/PRD.md section 4.5). */
import type Database from 'better-sqlite3';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { idSchema, newId, type Attachment } from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import {
  FileTooLargeError,
  fileSize,
  filePath,
  removeFile,
  saveUpload,
} from '../attachments/storage';
import type { Config } from '../config';
import type { AppEnv } from '../types';

interface Deps {
  db: Database.Database;
  config: Config;
  now: () => number;
}

type Access = 'owner' | 'reader' | 'none';

interface TodoAccess {
  access: Access;
  /** The task itself is deleted (only its owner may still reach it, for Undo). */
  deleted: boolean;
  ownerId: string;
}

/** What may this user do with this task? Readers: everyone, if its list is public. */
export function todoAccess(
  db: Database.Database,
  todoId: string,
  userId: string,
): TodoAccess | undefined {
  const row = db
    .prepare(
      `SELECT t.user_id, t.deleted_at AS todo_deleted, l.is_public, l.deleted_at AS list_deleted
         FROM todos t JOIN lists l ON l.id = t.list_id
        WHERE t.id = ?`,
    )
    .get(todoId) as
    | {
        user_id: string;
        todo_deleted: number | null;
        is_public: number;
        list_deleted: number | null;
      }
    | undefined;
  if (!row) return undefined;

  const deleted = row.todo_deleted !== null;
  if (row.user_id === userId) return { access: 'owner', deleted, ownerId: row.user_id };
  const visible = row.is_public === 1 && !deleted && row.list_deleted === null;
  return { access: visible ? 'reader' : 'none', deleted, ownerId: row.user_id };
}

interface AttachmentRow {
  id: string;
  user_id: string;
  todo_id: string;
  name: string;
  size: number;
  content_type: string;
  created_at: number;
}

const toApi = (r: AttachmentRow): Attachment => ({
  id: r.id,
  name: r.name,
  size: r.size,
  contentType: r.content_type,
  createdAt: r.created_at,
});

/** Only the file name: no folders, no control characters, 1–255 characters. */
export function cleanFileName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const last = raw.split(/[\\/]/).pop() ?? '';
  const base = [...last]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim();
  return base.length >= 1 && base.length <= 255 ? base : undefined;
}

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** `text/plain; charset=utf-8` → `text/plain`; anything odd → a generic type. */
export function cleanContentType(raw: string | undefined): string {
  const base = (raw ?? '').split(';')[0]!.trim().toLowerCase();
  return base.length <= 100 && MEDIA_TYPE.test(base) ? base : 'application/octet-stream';
}

/** RFC 6266: a plain ASCII fallback plus the real name in `filename*`. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^A-Za-z0-9._ -]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function attachmentRoutes({ db, config, now }: Deps) {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(db, now);
  app.use('/todos/*', auth);
  app.use('/attachments/*', auth);

  const listOf = db.prepare(
    'SELECT * FROM attachments WHERE todo_id = ? ORDER BY created_at, rowid',
  );
  const getRow = (id: string) =>
    db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;

  app.get('/todos/:todoId/attachments', (c) => {
    const todoId = idSchema.safeParse(c.req.param('todoId'));
    const a = todoId.success ? todoAccess(db, todoId.data, c.get('user').id) : undefined;
    if (!todoId.success || !a || a.access === 'none') return c.json({ error: 'not_found' }, 404);
    const rows = listOf.all(todoId.data) as AttachmentRow[];
    return c.json({ attachments: rows.map(toApi) });
  });

  app.post('/todos/:todoId/attachments', async (c) => {
    const user = c.get('user');
    const todoId = idSchema.safeParse(c.req.param('todoId'));
    const a = todoId.success ? todoAccess(db, todoId.data, user.id) : undefined;
    if (!todoId.success || !a || a.access === 'none' || (a.access === 'owner' && a.deleted)) {
      return c.json({ error: 'not_found' }, 404);
    }
    // Owner, or anyone for a task in a public list (FR-53).

    const name = cleanFileName(c.req.query('name'));
    if (!name) return c.json({ error: 'invalid_name' }, 400);

    // Refuse early when the sender says the file is too big (and again while receiving).
    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > config.maxAttachmentBytes) {
      return c.json({ error: 'file_too_large' }, 413);
    }
    const body = c.req.raw.body;
    if (!body) return c.json({ error: 'empty_file' }, 400);

    const id = newId(now());
    let size: number;
    try {
      size = await saveUpload(config.attachmentsDir, user.id, id, body, config.maxAttachmentBytes);
    } catch (err) {
      if (err instanceof FileTooLargeError) return c.json({ error: 'file_too_large' }, 413);
      return c.json({ error: 'upload_failed' }, 400);
    }
    if (size === 0) {
      await removeFile(config.attachmentsDir, user.id, id);
      return c.json({ error: 'empty_file' }, 400);
    }

    const row: AttachmentRow = {
      id,
      user_id: user.id,
      todo_id: todoId.data,
      name,
      size,
      content_type: cleanContentType(c.req.header('content-type')),
      created_at: now(),
    };
    try {
      db.prepare(
        `INSERT INTO attachments (id, user_id, todo_id, name, size, content_type, created_at)
         VALUES (@id, @user_id, @todo_id, @name, @size, @content_type, @created_at)`,
      ).run(row);
    } catch (err) {
      await removeFile(config.attachmentsDir, user.id, id); // e.g. the user was deleted meanwhile
      throw err;
    }
    return c.json(toApi(row), 201);
  });

  /** The row and what the caller may do with it, or a ready 404. */
  function find(userId: string, rawId: string) {
    const id = idSchema.safeParse(rawId);
    const row = id.success ? getRow(id.data) : undefined;
    const a = row ? todoAccess(db, row.todo_id, userId) : undefined;
    if (!row || !a || a.access === 'none') return undefined;
    return { row, access: a.access };
  }

  app.get('/attachments/:id', async (c) => {
    const found = find(c.get('user').id, c.req.param('id'));
    if (!found) return c.json({ error: 'not_found' }, 404);
    const { row } = found;

    const path = filePath(config.attachmentsDir, row.user_id, row.id);
    if ((await fileSize(path)) === undefined) return c.json({ error: 'not_found' }, 404);

    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        'content-type': row.content_type,
        'content-length': String(row.size),
        // Never shown inline and never sniffed, so an uploaded HTML or SVG file
        // cannot run in the app's origin (FR-52).
        'content-disposition': contentDisposition(row.name),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, no-store',
      },
    });
  });

  app.delete('/attachments/:id', async (c) => {
    const found = find(c.get('user').id, c.req.param('id'));
    if (!found) return c.json({ error: 'not_found' }, 404);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(found.row.id);
    await removeFile(config.attachmentsDir, found.row.user_id, found.row.id);
    return c.body(null, 204);
  });

  return app;
}
