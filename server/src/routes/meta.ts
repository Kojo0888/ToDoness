import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import type { ConfigResponse } from '@todoness/shared';
import type { Config } from '../config';
import type { AppEnv } from '../http/types';

/** Health check and the settings the client needs (no login required). */
export function metaRoutes({ db, config }: { db: Database.Database; config: Config }) {
  const app = new Hono<AppEnv>();

  app.get('/health', (c) => {
    try {
      db.prepare('SELECT 1').get();
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'error' }, 503);
    }
  });

  app.get('/config', (c) =>
    c.json({ maxAttachmentBytes: config.maxAttachmentBytes } satisfies ConfigResponse),
  );

  return app;
}
