import type Database from 'better-sqlite3';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import {
  changePasswordSchema,
  credentialsSchema,
  type HlcClock,
  type MeResponse,
} from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import type { Presence } from '../auth/presence';
import { hashPassword, verifyDummy, verifyPassword } from '../auth/password';
import { createRateLimiter } from '../auth/rate-limit';
import {
  createSession,
  deleteOtherUserSessions,
  deleteSession,
  SESSION_COOKIE,
  SESSION_MS,
} from '../auth/sessions';
import { createUserWithInbox } from '../auth/users';
import type { Config } from '../config';
import type { AppEnv } from '../http/types';

interface Deps {
  db: Database.Database;
  config: Config;
  now: () => number;
  serverClock: HlcClock;
  presence: Presence;
}

const MIN = 60_000;

/** The caller's IP: from the proxy header when behind Caddy, otherwise the socket. */
function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // no socket (tests)
  }
}

export function authRoutes({ db, config, now, serverClock, presence }: Deps) {
  const app = new Hono<AppEnv>();
  const emailLimiter = createRateLimiter({ max: 10, windowMs: 15 * MIN, now });
  const ipLimiter = createRateLimiter({ max: 50, windowMs: 15 * MIN, now });
  const signupLimiter = createRateLimiter({ max: 20, windowMs: 60 * MIN, now });
  const changeLimiter = createRateLimiter({ max: 10, windowMs: 15 * MIN, now });

  function startSession(c: Context, userId: string) {
    presence.touch(userId, now());
    const token = createSession(db, userId, now());
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_MS / 1000,
      secure: config.cookieSecure,
    });
  }

  function tooMany(c: Context, retryAfterSec: number) {
    c.header('Retry-After', String(retryAfterSec));
    return c.json({ error: 'too_many_attempts' }, 429);
  }

  app.post('/register', async (c) => {
    const parsed = credentialsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const { email, password } = parsed.data;

    const ip = `ip:${clientIp(c, config.trustProxy)}`;
    const limit = signupLimiter.check(ip);
    if (!limit.allowed) return tooMany(c, limit.retryAfterSec);
    signupLimiter.fail(ip); // every attempt counts

    const passwordHash = await hashPassword(password);
    try {
      const user = createUserWithInbox(db, {
        email,
        passwordHash,
        now: now(),
        hlc: serverClock.now(),
      });
      startSession(c, user.id);
      return c.json(user satisfies MeResponse, 201);
    } catch (err) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return c.json({ error: 'email_taken' }, 409);
      }
      throw err;
    }
  });

  app.post('/login', async (c) => {
    const parsed = credentialsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const { email, password } = parsed.data;

    const ipKey = `ip:${clientIp(c, config.trustProxy)}`;
    const emailKey = `email:${email}`;
    for (const [limiter, key] of [
      [ipLimiter, ipKey],
      [emailLimiter, emailKey],
    ] as const) {
      const r = limiter.check(key);
      if (!r.allowed) return tooMany(c, r.retryAfterSec);
    }

    const reject = () => {
      ipLimiter.fail(ipKey);
      emailLimiter.fail(emailKey);
      return c.json({ error: 'invalid_credentials' }, 401);
    };

    type Row = { id: string; email: string; role: 'admin' | 'user'; password_hash: string | null };
    const find = () =>
      db.prepare('SELECT id, email, role, password_hash FROM users WHERE email = ?').get(email) as
        Row | undefined;

    let user = find();
    if (!user) {
      await verifyDummy(password);
      return reject();
    }

    let authenticated = false;
    if (user.password_hash === null) {
      // An admin reset this account: the password typed now becomes the new one.
      const newHash = await hashPassword(password);
      const set = db
        .prepare(
          'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND password_hash IS NULL',
        )
        .run(newHash, now(), user.id);
      if (set.changes > 0) authenticated = true;
      else user = find(); // someone else set it first: check it normally below
    }

    if (!authenticated) {
      if (!user || user.password_hash === null) return reject();
      authenticated = await verifyPassword(user.password_hash, password);
    }
    if (!user || !authenticated) return reject();

    emailLimiter.reset(emailKey);
    startSession(c, user.id);
    const me: MeResponse = { id: user.id, email: user.email, role: user.role };
    return c.json(me);
  });

  /** A logged-in user changes their own password (FR-29, FR-30). */
  app.post('/change-password', requireAuth(db, now), async (c) => {
    const parsed = changePasswordSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const { currentPassword, newPassword } = parsed.data;

    const me = c.get('user');
    const key = `user:${me.id}`;
    const limit = changeLimiter.check(key);
    if (!limit.allowed) return tooMany(c, limit.retryAfterSec);

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as
      { password_hash: string | null } | undefined;
    const valid =
      row?.password_hash != null && (await verifyPassword(row.password_hash, currentPassword));
    if (!valid) {
      changeLimiter.fail(key);
      return c.json({ error: 'wrong_password' }, 403);
    }

    const newHash = await hashPassword(newPassword);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        newHash,
        now(),
        me.id,
      );
      deleteOtherUserSessions(db, me.id, getCookie(c, SESSION_COOKIE) ?? '');
    })();
    changeLimiter.reset(key);
    return c.body(null, 204);
  });

  app.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  return app;
}

export function meRoute({ db, now }: Pick<Deps, 'db' | 'now'>) {
  const app = new Hono<AppEnv>();
  app.get('/', requireAuth(db, now), (c) => c.json(c.get('user') satisfies MeResponse));
  return app;
}
