import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { HlcClock } from '@todoness/shared';
import { createPresence } from './auth/presence';
import type { Config } from './config';
import { notFound, onError } from './http/errors';
import { trackPresence } from './http/presence';
import { staticMiddleware } from './http/static';
import type { AppEnv } from './http/types';
import { getVapidKeys } from './push/keys';
import { adminRoutes } from './routes/admin';
import { attachmentRoutes } from './routes/attachments';
import { authRoutes, meRoute } from './routes/auth';
import { metaRoutes } from './routes/meta';
import { publicRoutes } from './routes/public';
import { pushRoutes } from './routes/push';
import { syncRoutes } from './routes/sync';

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
  const presence = createPresence(db, config.onlineWindowMs);
  const serverClock = new HlcClock('server', now);

  if (log) app.use('*', logger());
  app.use('/api/*', trackPresence(presence, now));

  app.route('/api', metaRoutes({ db, config }));
  app.route('/api/auth', authRoutes({ db, config, now, serverClock, presence }));
  app.route('/api/me', meRoute({ db, now }));
  app.route('/api/admin', adminRoutes({ db, now, presence, config }));
  app.route('/api', attachmentRoutes({ db, config, now }));
  app.route('/api/sync', syncRoutes({ db, now }));
  app.route('/api/public', publicRoutes({ db, now }));
  app.route('/api/push', pushRoutes({ db, now, publicKey: getVapidKeys(db, config).publicKey }));

  if (config.clientDir) app.use('*', staticMiddleware(config.clientDir));

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
