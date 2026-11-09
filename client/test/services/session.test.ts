import { describe, expect, it, vi } from 'vitest';
import { createRepo } from '../../src/data/repo';
import { createSyncEngine } from '../../src/sync/engine';
import { createSession, type SessionState } from '../../src/services/session';
import { fakeNow, seedInbox, testDb } from '../helpers/db';
import { fakeFetch, json, pullBody, type Call } from '../helpers/fetch';

const ANN = {
  id: '0192f0c1-0000-7000-8000-00000000000a',
  email: 'ann@corp.test',
  role: 'user' as const,
};
const BOB = {
  id: '0192f0c1-0000-7000-8000-00000000000b',
  email: 'bob@corp.test',
  role: 'user' as const,
};

type Router = Record<string, (call: Call) => Response | 'network-error'>;

function setup(
  routes: Router,
  opts: {
    confirm?: boolean;
    beforeLogout?: () => Promise<void>;
    beforeLogoutTimeoutMs?: number;
  } = {},
) {
  const db = testDb();
  const f = fakeFetch((call) => {
    const key = `${call.method} ${call.url.split('?')[0]}`;
    const handler = routes[key];
    if (!handler) return json(404, { error: 'not_found' });
    return handler(call);
  });
  const engine = createSyncEngine({ db, fetch: f });
  const deps = {
    db,
    engine,
    fetch: f,
    resumeSync: vi.fn(),
    stopSync: vi.fn(),
    confirm: vi.fn(() => opts.confirm ?? true),
    ...(opts.beforeLogout ? { beforeLogout: opts.beforeLogout } : {}),
    ...(opts.beforeLogoutTimeoutMs ? { beforeLogoutTimeoutMs: opts.beforeLogoutTimeoutMs } : {}),
  };
  const session = createSession(deps);
  const states: SessionState['status'][] = [];
  session.subscribe(() => states.push(session.getState().status));
  return { db, f, engine, session, deps, states };
}

const okSync: Router = {
  'POST /api/sync/push': () => json(200, { accepted: [], rejected: [] }),
  'GET /api/sync/pull': () => json(200, pullBody([])),
};

describe('boot', () => {
  it('a fresh device with a valid session does the first sync, then is ready', async () => {
    const { session, db, deps, states } = setup({ 'GET /api/me': () => json(200, ANN), ...okSync });
    await session.boot();
    expect(session.getState()).toMatchObject({ status: 'ready', user: ANN });
    expect(states).toContain('initial_sync');
    expect(await db.getMeta('user')).toEqual(ANN);
    expect(await db.getMeta('initialSyncDone')).toBe(true);
    expect(deps.resumeSync).toHaveBeenCalled();
  });

  it('skips the first sync when it was already done', async () => {
    const { session, db, states } = setup({ 'GET /api/me': () => json(200, ANN), ...okSync });
    await db.setMeta('user', ANN);
    await db.setMeta('initialSyncDone', true);
    await session.boot();
    expect(session.getState().status).toBe('ready');
    expect(states).not.toContain('initial_sync');
  });

  it('offline with a remembered user: opens the app from local data', async () => {
    const { session, db, deps } = setup({ 'GET /api/me': () => 'network-error' });
    await db.setMeta('user', ANN);
    await db.setMeta('initialSyncDone', true);
    await session.boot();
    expect(session.getState()).toMatchObject({ status: 'ready', user: ANN });
    expect(deps.resumeSync).toHaveBeenCalled();
  });

  it('offline on a device that never logged in: asks for a connection', async () => {
    const { session } = setup({ 'GET /api/me': () => 'network-error' });
    await session.boot();
    expect(session.getState().status).toBe('offline_no_session');
  });

  it('a server error behaves like offline', async () => {
    const { session, db } = setup({ 'GET /api/me': () => json(502, {}) });
    await db.setMeta('user', ANN);
    await db.setMeta('initialSyncDone', true);
    await session.boot();
    expect(session.getState().status).toBe('ready');
  });

  it('an expired session shows the login screen and keeps the local data', async () => {
    const { session, db } = setup({ 'GET /api/me': () => json(401, { error: 'unauthorized' }) });
    await db.setMeta('user', ANN);
    await db.setMeta('initialSyncDone', true);
    const inbox = await seedInbox(db);
    await createRepo(db, { now: fakeNow() }).createTodo({ listId: inbox.id, title: 'unsent' });

    await session.boot();
    expect(session.getState()).toMatchObject({
      status: 'login',
      email: ANN.email,
      reason: 'expired',
    });
    expect(await db.todos.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('no session and no local user: plain login screen', async () => {
    const { session } = setup({ 'GET /api/me': () => json(401, {}) });
    await session.boot();
    expect(session.getState()).toEqual({ status: 'login' });
  });

  it('a different user on the same device: local data is cleared', async () => {
    const { session, db } = setup({ 'GET /api/me': () => json(200, BOB), ...okSync });
    await db.setMeta('user', ANN);
    await db.setMeta('initialSyncDone', true);
    await seedInbox(db);
    await session.boot();
    expect(await db.lists.count()).toBe(0);
    expect(await db.getMeta('user')).toEqual(BOB);
  });

  it('shows a retry state when the first sync cannot reach the server', async () => {
    let up = false;
    const routes: Router = {
      'GET /api/me': () => json(200, ANN),
      'POST /api/sync/push': () =>
        up ? json(200, { accepted: [], rejected: [] }) : 'network-error',
      'GET /api/sync/pull': () => (up ? json(200, pullBody([])) : 'network-error'),
    };
    const { session } = setup(routes);
    await session.boot();
    expect(session.getState()).toMatchObject({ status: 'initial_sync', error: 'offline' });

    up = true;
    await session.retryInitialSync();
    expect(session.getState().status).toBe('ready');
  });
});

describe('login and register', () => {
  const loginRoutes = (user = ANN): Router => ({
    'GET /api/me': () => json(401, {}),
    'POST /api/auth/login': () => json(200, user),
    'POST /api/auth/register': () => json(201, user),
    ...okSync,
  });

  it('login sends the e-mail and password, then syncs and is ready', async () => {
    const { session, f } = setup(loginRoutes());
    await session.boot();
    const r = await session.login('ann@corp.test', 'secret pass');
    expect(r).toEqual({ ok: true });
    expect(f.calls.find((c) => c.url === '/api/auth/login')!.body).toEqual({
      email: 'ann@corp.test',
      password: 'secret pass',
    });
    expect(session.getState()).toMatchObject({ status: 'ready', user: ANN });
  });

  it('register works the same way', async () => {
    const { session, f } = setup(loginRoutes());
    await session.boot();
    expect(await session.register('ann@corp.test', 'secret pass')).toEqual({ ok: true });
    expect(f.calls.some((c) => c.url === '/api/auth/register')).toBe(true);
    expect(session.getState().status).toBe('ready');
  });

  it('maps server answers to clear errors and stays on the login screen', async () => {
    const cases: [Response | 'network-error', unknown][] = [
      [json(401, { error: 'invalid_credentials' }), { ok: false, error: 'invalid_credentials' }],
      [json(400, { error: 'invalid_request' }), { ok: false, error: 'invalid_request' }],
      [json(409, { error: 'email_taken' }), { ok: false, error: 'email_taken' }],
      [
        new Response('{}', { status: 429, headers: { 'retry-after': '120' } }),
        { ok: false, error: 'too_many_attempts', retryAfterSec: 120 },
      ],
      [json(500, {}), { ok: false, error: 'server' }],
      ['network-error', { ok: false, error: 'network' }],
    ];
    for (const [reply, expected] of cases) {
      const { session } = setup({ ...loginRoutes(), 'POST /api/auth/login': () => reply });
      await session.boot();
      expect(await session.login('ann@corp.test', 'whatever pass')).toEqual(expected);
      expect(session.getState().status).toBe('login');
    }
  });

  it('after an expired session, the same user logging in keeps data and resumes sync', async () => {
    const { session, db, deps } = setup(loginRoutes());
    await db.setMeta('user', ANN);
    await db.setMeta('initialSyncDone', true);
    const inbox = await seedInbox(db);
    await createRepo(db, { now: fakeNow() }).createTodo({ listId: inbox.id, title: 'unsent' });

    await session.requireLogin();
    expect(session.getState()).toMatchObject({
      status: 'login',
      reason: 'expired',
      email: ANN.email,
    });
    await session.login(ANN.email, 'new password');
    expect(session.getState().status).toBe('ready');
    expect(await db.todos.count()).toBe(1);
    expect(deps.resumeSync).toHaveBeenCalled();
  });

  it('a different user with unsent changes on the device must confirm', async () => {
    const declined = setup(loginRoutes(BOB), { confirm: false });
    await declined.db.setMeta('user', ANN);
    await declined.db.setMeta('initialSyncDone', true);
    const inbox = await seedInbox(declined.db);
    await createRepo(declined.db, { now: fakeNow() }).createTodo({
      listId: inbox.id,
      title: 'ann unsent',
    });
    await declined.session.requireLogin();

    expect(await declined.session.login(BOB.email, 'bobs password')).toEqual({
      ok: false,
      error: 'cancelled',
    });
    expect(declined.deps.confirm).toHaveBeenCalled();
    expect(await declined.db.todos.count()).toBe(1); // Ann's data is untouched
    expect(declined.f.calls.some((c) => c.url === '/api/auth/logout')).toBe(true); // Bob's session is dropped
    expect(declined.session.getState().status).toBe('login');

    const accepted = setup(loginRoutes(BOB), { confirm: true });
    await accepted.db.setMeta('user', ANN);
    await accepted.db.setMeta('initialSyncDone', true);
    const inbox2 = await seedInbox(accepted.db);
    await createRepo(accepted.db, { now: fakeNow() }).createTodo({
      listId: inbox2.id,
      title: 'ann unsent',
    });
    await accepted.session.requireLogin();
    expect(await accepted.session.login(BOB.email, 'bobs password')).toEqual({ ok: true });
    expect(await accepted.db.todos.count()).toBe(0);
    expect(await accepted.db.getMeta('user')).toEqual(BOB);
  });

  it('a different user without unsent changes does not need to confirm', async () => {
    const { session, db, deps } = setup(loginRoutes(BOB));
    await db.setMeta('user', ANN);
    await db.setMeta('initialSyncDone', true);
    await seedInbox(db);
    await session.requireLogin();
    await session.login(BOB.email, 'bobs password');
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(await db.lists.count()).toBe(0);
  });
});

describe('logout', () => {
  async function loggedIn(extra: Router = {}) {
    const ctx = setup({
      'GET /api/me': () => json(200, ANN),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
      ...okSync,
      ...extra,
    });
    await ctx.session.boot();
    return ctx;
  }

  it('clears all local data, stops syncing and shows the login screen', async () => {
    const { session, db, deps, f } = await loggedIn();
    await seedInbox(db);
    expect(await session.logout()).toBe(true);
    expect(f.calls.some((c) => c.url === '/api/auth/logout')).toBe(true);
    expect(deps.stopSync).toHaveBeenCalled();
    expect(await db.lists.count()).toBe(0);
    expect(await db.getMeta('user')).toBeUndefined();
    expect(session.getState()).toEqual({ status: 'login', reason: 'logged_out' });
  });

  it('warns first when changes are still pending, and does nothing if declined', async () => {
    const { session, db, deps } = await loggedIn();
    const inbox = await seedInbox(db);
    await createRepo(db, { now: fakeNow() }).createTodo({ listId: inbox.id, title: 'unsent' });
    deps.confirm.mockReturnValueOnce(false);

    expect(await session.logout()).toBe(false);
    expect(deps.confirm).toHaveBeenCalledWith(expect.stringMatching(/1 change/));
    expect(await db.todos.count()).toBe(1);
    expect(session.getState().status).toBe('ready');
  });

  it('logs out locally even when the server cannot be reached', async () => {
    const { session, db } = await loggedIn({ 'POST /api/auth/logout': () => 'network-error' });
    await seedInbox(db);
    expect(await session.logout()).toBe(true);
    expect(await db.lists.count()).toBe(0);
    expect(session.getState().status).toBe('login');
  });
});

describe('logout and push (FR-60)', () => {
  it('releases push for this device before the server session ends', async () => {
    const order: string[] = [];
    const { session } = setup(
      {
        'GET /api/me': () => json(200, ANN),
        ...okSync,
        'POST /api/auth/logout': () => {
          order.push('server logout');
          return new Response(null, { status: 204 });
        },
      },
      { beforeLogout: async () => void order.push('release push') },
    );
    await session.boot();
    await session.logout();
    expect(order).toEqual(['release push', 'server logout']);
  });

  it('logs out even if releasing push fails or hangs', async () => {
    for (const beforeLogout of [
      () => Promise.reject(new Error('boom')),
      () => new Promise<void>(() => {}), // never finishes
    ]) {
      const { session } = setup(
        { 'GET /api/me': () => json(200, ANN), ...okSync },
        { beforeLogout, beforeLogoutTimeoutMs: 20 },
      );
      await session.boot();
      expect(await session.logout()).toBe(true);
      expect(session.getState().status).toBe('login');
    }
  });
});

describe('logging out while offline', () => {
  it('does not silently log the user back in at the next start', async () => {
    const first = setup({
      'GET /api/me': () => json(200, ANN),
      'POST /api/auth/logout': () => 'network-error',
      ...okSync,
    });
    await first.session.boot();
    expect(await first.session.logout()).toBe(true);
    expect(first.session.getState()).toEqual({ status: 'login', reason: 'logged_out' });
    expect(await first.db.getMeta('pendingLogout')).toBe(true);

    // Later, online again: the server session from before is still valid.
    const routes: Router = {
      'GET /api/me': () => json(200, ANN),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
      ...okSync,
    };
    const f = fakeFetch((call) => routes[`${call.method} ${call.url.split('?')[0]}`]!(call));
    const second = createSession({
      db: first.db,
      engine: createSyncEngine({ db: first.db, fetch: f }),
      fetch: f,
      resumeSync: vi.fn(),
      stopSync: vi.fn(),
      confirm: () => true,
    });
    await second.boot();

    expect(f.calls.map((c) => c.url)).toEqual(['/api/auth/logout']); // finished the logout, never asked /api/me
    expect(second.getState()).toEqual({ status: 'login', reason: 'logged_out' });
    expect(await first.db.getMeta('pendingLogout')).toBeUndefined();
  });

  it('still shows the login screen if the server cannot be reached yet', async () => {
    const { session, db } = setup({ 'POST /api/auth/logout': () => 'network-error' });
    await db.setMeta('pendingLogout', true);
    await session.boot();
    expect(session.getState()).toEqual({ status: 'login', reason: 'logged_out' });
    expect(await db.getMeta('pendingLogout')).toBe(true); // try again next time
  });

  it('an online logout leaves no flag behind', async () => {
    const { session, db } = setup({
      'GET /api/me': () => json(200, ANN),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
      ...okSync,
    });
    await session.boot();
    await session.logout();
    expect(await db.getMeta('pendingLogout')).toBeUndefined();
  });

  it('logging in again removes the flag', async () => {
    const { session, db } = setup({
      'POST /api/auth/login': () => json(200, ANN),
      ...okSync,
    });
    await db.setMeta('pendingLogout', true);
    await session.login(ANN.email, 'secret pass');
    expect(await db.getMeta('pendingLogout')).toBeUndefined();
  });
});

describe('changePassword (FR-29, FR-31)', () => {
  async function ready(routes: Router) {
    const t = setup({ 'GET /api/me': () => json(200, ANN), ...okSync, ...routes });
    await t.session.boot();
    return t;
  }

  it('sends both passwords and reports success', async () => {
    const { session, f } = await ready({
      'POST /api/auth/change-password': () => new Response(null, { status: 204 }),
    });
    const result = await session.changePassword('old password', 'new password!');
    expect(result).toEqual({ ok: true });
    const call = f.calls.find((c) => c.url === '/api/auth/change-password')!;
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({
      currentPassword: 'old password',
      newPassword: 'new password!',
    });
    expect(session.getState().status).toBe('ready');
  });

  it('maps server answers to clear errors', async () => {
    const answers: [() => Response | 'network-error', string][] = [
      [() => json(403, { error: 'wrong_password' }), 'wrong_password'],
      [() => json(400, { error: 'invalid_request' }), 'invalid_request'],
      [() => json(500, {}), 'server'],
      [() => 'network-error', 'network'],
    ];
    for (const [answer, error] of answers) {
      const { session } = await ready({ 'POST /api/auth/change-password': answer });
      expect(await session.changePassword('a', 'new password!')).toMatchObject({
        ok: false,
        error,
      });
    }
  });

  it('reports how long to wait after too many attempts', async () => {
    const { session } = await ready({
      'POST /api/auth/change-password': () =>
        new Response('{}', { status: 429, headers: { 'retry-after': '120' } }),
    });
    expect(await session.changePassword('a', 'new password!')).toEqual({
      ok: false,
      error: 'too_many_attempts',
      retryAfterSec: 120,
    });
  });

  it('an expired login (401) sends the user to the login screen', async () => {
    const { session } = await ready({ 'POST /api/auth/change-password': () => json(401, {}) });
    expect(await session.changePassword('a', 'new password!')).toMatchObject({
      ok: false,
      error: 'unauthorized',
    });
    expect(session.getState().status).toBe('login');
  });
});

describe('subscribe', () => {
  it('notifies listeners and supports unsubscribing', async () => {
    const { session } = setup({ 'GET /api/me': () => json(401, {}) });
    const seen: string[] = [];
    const off = session.subscribe(() => seen.push(session.getState().status));
    await session.boot();
    expect(seen).toEqual(['loading', 'login']);
    off();
    await session.requireLogin();
    expect(seen).toEqual(['loading', 'login']);
  });
});
