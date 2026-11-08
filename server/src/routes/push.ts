/** Web push subscriptions (docs/v1/PRD.md FR-59, FR-60). */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { newId, pushSubscriptionSchema, pushUnsubscribeSchema } from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import type { AppEnv } from '../types';

export function pushRoutes({
  db,
  now,
  publicKey,
}: {
  db: Database.Database;
  now: () => number;
  publicKey: string;
}) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(db, now));

  app.get('/key', (c) => c.json({ publicKey }));

  /** Stores the subscription, or moves it to this user if another one had it. */
  app.post('/subscribe', async (c) => {
    const parsed = pushSubscriptionSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const { endpoint, keys } = parsed.data;
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run(newId(now()), c.get('user').id, endpoint, keys.p256dh, keys.auth, now());
    return c.body(null, 204);
  });

  /** Removes the caller's own subscription (logout, or push switched off). */
  app.post('/unsubscribe', async (c) => {
    const parsed = pushUnsubscribeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(
      parsed.data.endpoint,
      c.get('user').id,
    );
    return c.body(null, 204);
  });

  return app;
}
