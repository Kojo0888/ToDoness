import type { MiddlewareHandler } from 'hono';
import type { Presence } from '../auth/presence';
import type { AppEnv } from './types';

/** Whoever made an authenticated request is online (FR-56). Runs after the route. */
export function trackPresence(presence: Presence, now: () => number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const user = c.get('user');
    if (user) presence.touch(user.id, now());
  };
}
