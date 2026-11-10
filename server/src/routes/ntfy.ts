/** Reminders through ntfy: each user picks the topic their reminders are published to. */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ntfyTopicBodySchema, type NtfyStatus } from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import { createRateLimiter } from '../auth/rate-limit';
import type { Config } from '../config';
import type { AppEnv } from '../http/types';
import type { NtfySend } from '../push/ntfy';

export function ntfyRoutes({
  db,
  now,
  config,
  send,
}: {
  db: Database.Database;
  now: () => number;
  config: Config;
  /** Undefined when the server has no NTFY_URL. */
  send: NtfySend | undefined;
}) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(db, now));

  // One test per user every 10 s: a looping client must not get the server's IP rate
  // limited or banned by a shared ntfy server, which would stop everyone's reminders.
  const testLimiter = createRateLimiter({ max: 1, windowMs: 10_000, now });

  const topicOf = (userId: string) =>
    (
      db.prepare('SELECT topic FROM ntfy_topics WHERE user_id = ?').get(userId) as
        { topic: string } | undefined
    )?.topic ?? null;

  app.get('/', (c) => {
    const status: NtfyStatus = send
      ? {
          enabled: true,
          // What the phone can reach, which is not always what the server uses.
          url: config.ntfyPublicUrl ?? config.ntfyUrl ?? null,
          topic: topicOf(c.get('user').id),
        }
      : { enabled: false, url: null, topic: null };
    return c.json(status);
  });

  app.put('/', async (c) => {
    if (!send) return c.json({ error: 'ntfy_disabled' }, 409);
    const parsed = ntfyTopicBodySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const userId = c.get('user').id;
    const { topic } = parsed.data;
    // A topic is readable by anyone who knows it, so it must belong to one user only.
    const owner = db.prepare('SELECT user_id FROM ntfy_topics WHERE topic = ?').get(topic) as
      { user_id: string } | undefined;
    if (owner && owner.user_id !== userId) return c.json({ error: 'topic_taken' }, 409);
    db.prepare(
      `INSERT INTO ntfy_topics (user_id, topic, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET topic = excluded.topic`,
    ).run(userId, topic, now());
    return c.body(null, 204);
  });

  app.delete('/', (c) => {
    db.prepare('DELETE FROM ntfy_topics WHERE user_id = ?').run(c.get('user').id);
    return c.body(null, 204);
  });

  /** So the user can check the whole chain without waiting for a reminder. */
  app.post('/test', async (c) => {
    if (!send) return c.json({ error: 'ntfy_disabled' }, 409);
    const topic = topicOf(c.get('user').id);
    if (!topic) return c.json({ error: 'no_topic' }, 409);
    const userId = c.get('user').id;
    const limit = testLimiter.check(userId);
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfterSec));
      return c.json({ error: 'too_many_requests' }, 429);
    }
    testLimiter.fail(userId); // every attempt counts, also a failed one
    const outcome = await send(topic, {
      title: 'ToDoness test',
      body: 'Reminders through ntfy work.',
      tag: 'todoness-test',
      url: '/',
    }).catch(() => 'failed' as const);
    if (outcome !== 'ok') return c.json({ error: 'send_failed' }, 502);
    return c.body(null, 204);
  });

  return app;
}
