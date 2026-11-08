import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { HlcClock } from '@todoness/shared';
import { logger } from 'hono/logger';
import { createPresence } from './auth/presence';
import type { Config } from './config';
import { adminRoutes } from './routes/admin';
import { authRoutes, meRoute } from './routes/auth';
import { syncRoutes } from './routes/sync';
import { staticMiddleware } from './static';
import type { AppEnv } from './types';

export interface AppDeps {
  db: Database.Database;
  config: Config;
  /** Log every request to the console (off in tests). */
  log?: boolean;
  /** Current time in epoch ms; replaceable in tests. */
  now?: () => number;
}

/** Builds the HTTP app. Kept separate from `index.ts` so tests can call it directly. */
export function createApp({ db, config, log = false, now = Date.now }: AppDeps) {
  const app = new Hono<AppEnv>();

  if (log) app.use('*', logger());

  app.get('/api/health', (c) => {
    try {
      db.prepare('SELECT 1').get();
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'error' }, 503);
    }
  });

  const presence = createPresence(db, config.onlineWindowMs);
  // Whoever made an authenticated request is online (FR-56). Runs after the route.
  app.use('/api/*', async (c, next) => {
    await next();
    const user = c.get('user');
    if (user) presence.touch(user.id, now());
  });

  const serverClock = new HlcClock('server', now);
  app.route('/api/auth', authRoutes({ db, config, now, serverClock, presence }));
  app.route('/api/me', meRoute({ db, now }));
  app.route('/api/admin', adminRoutes({ db, now, presence }));
  app.route('/api/sync', syncRoutes({ db, now }));

  if (config.clientDir) app.use('*', staticMiddleware(config.clientDir));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.status === 400 ? 'bad_request' : err.message }, err.status);
    }
    if (err instanceof SyntaxError) return c.json({ error: 'bad_request' }, 400); // malformed JSON
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
