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
import { createNtfySender, type NtfySend } from './push/ntfy';
import { adminRoutes } from './routes/admin';
import { attachmentRoutes } from './routes/attachments';
import { authRoutes, meRoute } from './routes/auth';
import { metaRoutes } from './routes/meta';
import { ntfyRoutes } from './routes/ntfy';
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
  /** Sends reminders through ntfy. Default: built from `config.ntfyUrl`, if it is set. */
  ntfySend?: NtfySend;
}

/** The ntfy sender the config asks for, or undefined when ntfy is off. */
export function ntfySenderFor(config: Config): NtfySend | undefined {
  if (!config.ntfyUrl) return undefined;
  return createNtfySender({
    url: config.ntfyUrl,
    ...(config.ntfyToken ? { token: config.ntfyToken } : {}),
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
  });
}

/** Builds the HTTP app. Kept separate from `index.ts` so tests can call it directly. */
export function createApp({ db, config, log = false, now = Date.now, ntfySend }: AppDeps) {
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
  app.route('/api/sync', syncRoutes({ db, now, serverClock }));
  app.route('/api/public', publicRoutes({ db, now }));
  app.route('/api/ntfy', ntfyRoutes({ db, now, config, send: ntfySend ?? ntfySenderFor(config) }));
  app.route('/api/push', pushRoutes({ db, now, publicKey: getVapidKeys(db, config).publicKey }));

  if (config.clientDir) app.use('*', staticMiddleware(config.clientDir));

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
