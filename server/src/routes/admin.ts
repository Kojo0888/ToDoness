import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { idSchema, type AdminUsersResponse } from '@todoness/shared';
import { requireAdmin, requireAuth } from '../auth/middleware';
import type { Presence } from '../auth/presence';
import { deleteUserSessions } from '../auth/sessions';
import { removeUserFiles } from '../attachments/storage';
import type { Config } from '../config';
import type { AppEnv } from '../types';

export function adminRoutes({
  db,
  now,
  presence,
  config,
}: {
  db: Database.Database;
  now: () => number;
  presence: Presence;
  config: Config;
}) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(db, now), requireAdmin);

  app.get('/users', (c) => {
    const rows = db
      .prepare(
        `SELECT id, email, role, created_at, password_hash IS NULL AS reset, last_seen_at
           FROM users ORDER BY rowid`,
      )
      .all() as {
      id: string;
      email: string;
      role: 'admin' | 'user';
      created_at: number;
      reset: number;
      last_seen_at: number | null;
    }[];
    const body: AdminUsersResponse = {
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        createdAt: r.created_at,
        passwordReset: r.reset === 1,
        online: presence.isOnline(r.last_seen_at, now()),
        lastSeenAt: r.last_seen_at,
      })),
    };
    return c.json(body);
  });

  /** Clears the password. The user's next login sets the new one. */
  app.post('/users/:id/reset-password', (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    if (id.data === c.get('user').id) return c.json({ error: 'cannot_reset_self' }, 400);

    const reset = db.transaction(() => {
      const r = db
        .prepare('UPDATE users SET password_hash = NULL, updated_at = ? WHERE id = ?')
        .run(now(), id.data);
      if (r.changes === 0) return false;
      deleteUserSessions(db, id.data);
      return true;
    });
    return reset() ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
  });

  /** Deletes the user; sessions, lists, todos and the change log go with them. */
  app.delete('/users/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    if (id.data === c.get('user').id) return c.json({ error: 'cannot_delete_self' }, 400);
    const r = db.prepare('DELETE FROM users WHERE id = ?').run(id.data);
    if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
    await removeUserFiles(config.attachmentsDir, id.data); // attachments (FR-54)
    return c.body(null, 204);
  });

  return app;
}
