import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import type { Config } from './config';
import { staticMiddleware } from './static';
import type { AppEnv } from './types';

export interface AppDeps {
  db: Database.Database;
  config: Config;
  /** Log every request to the console (off in tests). */
  log?: boolean;
}

/** Builds the HTTP app. Kept separate from `index.ts` so tests can call it directly. */
export function createApp({ db, config, log = false }: AppDeps) {
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
