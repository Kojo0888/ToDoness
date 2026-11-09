import type Database from 'better-sqlite3';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../http/types';
import { getUserBySession, SESSION_COOKIE } from './sessions';

/** Rejects requests without a valid session and puts the user on the context. */
export function requireAuth(db: Database.Database, now: () => number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? getUserBySession(db, token, now()) : undefined;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    c.set('user', user);
    await next();
  };
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
};
