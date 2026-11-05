import { describe, expect, it } from 'vitest';
import { verify } from '@node-rs/argon2';
import { testApp } from './helpers/app';
import { TestClient } from './helpers/client';

const PW = 'correct horse';

type Row = Record<string, string>;

async function register(c: TestClient, email = 'ann@corp.test', password = PW) {
  return c.post('/api/auth/register', { email, password });
}

describe('POST /api/auth/register', () => {
  it('creates the first user as admin and logs them in', async () => {
    const { app } = testApp();
    const c = new TestClient(app);
    const res = await register(c);
    expect(res.status).toBe(201);
    const me = await res.json();
    expect(me).toMatchObject({ email: 'ann@corp.test', role: 'admin' });
    expect(me.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('makes later users normal users', async () => {
    const { app } = testApp();
    await register(new TestClient(app));
    const res = await register(new TestClient(app), 'bob@corp.test');
    expect((await res.json()).role).toBe('user');
  });

  it('stores an argon2id hash, never the password', async () => {
    const { app, db } = testApp();
    await register(new TestClient(app));
    const row = db.prepare('SELECT password_hash h FROM users').get() as { h: string };
    expect(row.h).toMatch(/^\$argon2id\$/);
    expect(row.h).not.toContain(PW);
    expect(await verify(row.h, PW)).toBe(true);
  });

  it('rejects a duplicate e-mail, ignoring case', async () => {
    const { app } = testApp();
    await register(new TestClient(app));
    const res = await register(new TestClient(app), 'ANN@corp.test');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'email_taken' });
  });

  it('rejects invalid input', async () => {
    const { app } = testApp();
    const c = new TestClient(app);
    for (const body of [
      { email: 'nope', password: PW },
      { email: 'a@b.co', password: 'short' },
      { email: 'a@b.co' },
      {},
    ]) {
      const res = await c.post('/api/auth/register', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toBe('invalid_request');
    }
  });

  it('cannot be used to choose the role', async () => {
    const { app } = testApp();
    await register(new TestClient(app));
    const c = new TestClient(app);
    const res = await c.post('/api/auth/register', {
      email: 'eve@corp.test',
      password: PW,
      role: 'admin',
    });
    expect((await res.json()).role).toBe('user');
  });

  it('creates exactly one Inbox and a change-log entry so it syncs', async () => {
    const { app, db } = testApp();
    const me = await (await register(new TestClient(app))).json();
    const lists = db.prepare('SELECT * FROM lists WHERE user_id = ?').all(me.id) as Row[];
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'Inbox', is_inbox: 1, deleted_at: null });
    const log = db.prepare('SELECT * FROM change_log WHERE user_id = ?').all(me.id) as Row[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity: 'list', entity_id: lists[0]!.id, op_type: 'create' });
    expect(JSON.parse(log[0]!.patch)).toEqual({ name: 'Inbox', orderKey: 'a0', isInbox: true });
    expect(Object.keys(JSON.parse(lists[0]!.field_hlc)).sort()).toEqual([
      'isInbox',
      'name',
      'orderKey',
    ]);
  });

  it('sets a safe session cookie', async () => {
    const { app } = testApp({ COOKIE_SECURE: 'true' });
    const res = await register(new TestClient(app));
    const cookie = res.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^todoness_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Max-Age=7776000/i);
  });

  it('omits Secure when COOKIE_SECURE is off', async () => {
    const { app } = testApp();
    const res = await register(new TestClient(app));
    expect(res.headers.getSetCookie()[0]).not.toMatch(/Secure/i);
  });

  it('stores only a hash of the session token', async () => {
    const { app, db } = testApp();
    const c = new TestClient(app);
    await register(c);
    const token = c.cookies.get('todoness_session')!;
    const row = db.prepare('SELECT id FROM sessions').get() as { id: string };
    expect(row.id).not.toBe(token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with the right password, ignoring e-mail case', async () => {
    const { app } = testApp();
    await register(new TestClient(app));
    const c = new TestClient(app);
    const res = await c.post('/api/auth/login', { email: 'ANN@Corp.test', password: PW });
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe('ann@corp.test');
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown e-mail', async () => {
    const { app } = testApp();
    await register(new TestClient(app));
    const c = new TestClient(app);
    const wrong = await c.post('/api/auth/login', {
      email: 'ann@corp.test',
      password: 'wrong password',
    });
    const unknown = await c.post('/api/auth/login', {
      email: 'who@corp.test',
      password: 'wrong password',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect((await c.get('/api/me')).status).toBe(401);
  });

  it('rejects malformed input with 400', async () => {
    const { app } = testApp();
    const res = await new TestClient(app).post('/api/auth/login', { email: 'x' });
    expect(res.status).toBe(400);
  });

  it('blocks an e-mail after 10 failures, even with the right password', async () => {
    const { app } = testApp();
    await register(new TestClient(app));
    const c = new TestClient(app);
    for (let i = 0; i < 10; i++) {
      expect(
        (await c.post('/api/auth/login', { email: 'ann@corp.test', password: 'wrong password' }))
          .status,
      ).toBe(401);
    }
    const res = await c.post('/api/auth/login', { email: 'ann@corp.test', password: PW });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('allows logging in again after the window has passed', async () => {
    let t = 1_700_000_000_000;
    const { app } = testApp({}, { now: () => t });
    await register(new TestClient(app));
    const c = new TestClient(app);
    for (let i = 0; i < 10; i++)
      await c.post('/api/auth/login', { email: 'ann@corp.test', password: 'wrong password' });
    expect((await c.post('/api/auth/login', { email: 'ann@corp.test', password: PW })).status).toBe(
      429,
    );
    t += 16 * 60_000;
    expect((await c.post('/api/auth/login', { email: 'ann@corp.test', password: PW })).status).toBe(
      200,
    );
  });

  it('does not let one e-mail block another', async () => {
    const { app } = testApp();
    await register(new TestClient(app));
    await register(new TestClient(app), 'bob@corp.test');
    const c = new TestClient(app);
    for (let i = 0; i < 10; i++)
      await c.post('/api/auth/login', { email: 'ann@corp.test', password: 'wrong password' });
    const res = await c.post('/api/auth/login', { email: 'bob@corp.test', password: PW });
    expect(res.status).toBe(200);
  });

  it('limits one IP across many e-mails when TRUST_PROXY is on', async () => {
    const { app } = testApp({ TRUST_PROXY: 'true' });
    const attacker = new TestClient(app, '10.0.0.9');
    let last = 0;
    for (let i = 0; i < 60; i++) {
      last = (
        await attacker.post('/api/auth/login', {
          email: `u${i}@corp.test`,
          password: 'wrong password',
        })
      ).status;
    }
    expect(last).toBe(429);
    const other = new TestClient(app, '10.0.0.10');
    expect(
      (await other.post('/api/auth/login', { email: 'u1@corp.test', password: 'wrong password' }))
        .status,
    ).toBe(401);
  });
});

describe('sessions', () => {
  it('logout ends the session', async () => {
    const { app, db } = testApp();
    const c = new TestClient(app);
    await register(c);
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/me')).status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('logout without a session is fine', async () => {
    const { app } = testApp();
    expect((await new TestClient(app).post('/api/auth/logout')).status).toBe(204);
  });

  it('expires after 90 days', async () => {
    let t = 1_700_000_000_000;
    const { app } = testApp({}, { now: () => t });
    const c = new TestClient(app);
    await register(c);
    t += 89 * 86_400_000;
    expect((await c.get('/api/me')).status).toBe(200);
    t += 2 * 86_400_000;
    expect((await c.get('/api/me')).status).toBe(401);
  });

  it('GET /api/me is 401 without or with a bad cookie', async () => {
    const { app } = testApp();
    const c = new TestClient(app);
    expect((await c.get('/api/me')).status).toBe(401);
    c.cookies.set('todoness_session', 'garbage');
    const res = await c.get('/api/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('keeps sessions of other devices when one logs out', async () => {
    const { app } = testApp();
    const a = new TestClient(app);
    await register(a);
    const b = new TestClient(app);
    await b.post('/api/auth/login', { email: 'ann@corp.test', password: PW });
    await a.post('/api/auth/logout');
    expect((await b.get('/api/me')).status).toBe(200);
  });
});

describe('admin', () => {
  async function setup() {
    const t = testApp();
    const admin = new TestClient(t.app);
    const adminMe = await (await register(admin)).json();
    const user = new TestClient(t.app);
    const userMe = await (await register(user, 'bob@corp.test')).json();
    return { ...t, admin, adminMe, user, userMe };
  }

  it('requires login and the admin role', async () => {
    const { app, user, userMe } = await setup();
    const anon = new TestClient(app);
    expect((await anon.get('/api/admin/users')).status).toBe(401);
    expect((await user.get('/api/admin/users')).status).toBe(403);
    expect((await user.post(`/api/admin/users/${userMe.id}/reset-password`)).status).toBe(403);
    expect((await user.delete(`/api/admin/users/${userMe.id}`)).status).toBe(403);
  });

  it('lists users', async () => {
    const { admin, adminMe, userMe } = await setup();
    const res = await admin.get('/api/admin/users');
    expect(res.status).toBe(200);
    const { users } = await res.json();
    expect(users.map((u: { email: string }) => u.email)).toEqual([
      'ann@corp.test',
      'bob@corp.test',
    ]);
    expect(users[0]).toMatchObject({ id: adminMe.id, role: 'admin', passwordReset: false });
    expect(users[1]).toMatchObject({ id: userMe.id, role: 'user', passwordReset: false });
    expect(JSON.stringify(users)).not.toContain('argon2');
  });

  it('reset clears the password and logs the user out everywhere', async () => {
    const { app, admin, user, userMe, db } = await setup();
    const phone = new TestClient(app);
    await phone.post('/api/auth/login', { email: 'bob@corp.test', password: PW });
    const res = await admin.post(`/api/admin/users/${userMe.id}/reset-password`);
    expect(res.status).toBe(204);
    expect((await user.get('/api/me')).status).toBe(401);
    expect((await phone.get('/api/me')).status).toBe(401);
    expect(db.prepare('SELECT password_hash h FROM users WHERE id = ?').get(userMe.id)).toEqual({
      h: null,
    });
    const { users } = await (await admin.get('/api/admin/users')).json();
    expect(users.find((u: { id: string }) => u.id === userMe.id).passwordReset).toBe(true);
  });

  it('after a reset, the next login sets the typed password', async () => {
    const { app, admin, userMe } = await setup();
    await admin.post(`/api/admin/users/${userMe.id}/reset-password`);
    const c = new TestClient(app);
    const res = await c.post('/api/auth/login', {
      email: 'bob@corp.test',
      password: 'brand new pass',
    });
    expect(res.status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
    // From now on it is a normal password.
    const again = new TestClient(app);
    expect(
      (await again.post('/api/auth/login', { email: 'bob@corp.test', password: 'brand new pass' }))
        .status,
    ).toBe(200);
    expect(
      (await again.post('/api/auth/login', { email: 'bob@corp.test', password: PW })).status,
    ).toBe(401);
    const { users } = await (await admin.get('/api/admin/users')).json();
    expect(users.find((u: { id: string }) => u.id === userMe.id).passwordReset).toBe(false);
  });

  it('a too-short password does not set anything after a reset', async () => {
    const { app, admin, userMe, db } = await setup();
    await admin.post(`/api/admin/users/${userMe.id}/reset-password`);
    const res = await new TestClient(app).post('/api/auth/login', {
      email: 'bob@corp.test',
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT password_hash h FROM users WHERE id = ?').get(userMe.id)).toEqual({
      h: null,
    });
  });

  it('keeps the user data when the password is reset', async () => {
    const { admin, userMe, db } = await setup();
    await admin.post(`/api/admin/users/${userMe.id}/reset-password`);
    expect(db.prepare('SELECT COUNT(*) n FROM lists WHERE user_id = ?').get(userMe.id)).toEqual({
      n: 1,
    });
  });

  it('refuses to reset the admin’s own password, and unknown users', async () => {
    const { admin, adminMe } = await setup();
    expect((await admin.post(`/api/admin/users/${adminMe.id}/reset-password`)).status).toBe(400);
    expect(
      (await admin.post('/api/admin/users/00000000-0000-7000-8000-000000000000/reset-password'))
        .status,
    ).toBe(404);
    expect((await admin.post('/api/admin/users/not-an-id/reset-password')).status).toBe(404);
  });

  it('deletes a user and everything they own', async () => {
    const { admin, userMe, user, db } = await setup();
    const res = await admin.delete(`/api/admin/users/${userMe.id}`);
    expect(res.status).toBe(204);
    expect((await user.get('/api/me')).status).toBe(401);
    for (const table of ['users', 'sessions', 'lists', 'change_log']) {
      const col = table === 'users' ? 'id' : 'user_id';
      expect(
        db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col} = ?`).get(userMe.id),
        table,
      ).toEqual({ n: 0 });
    }
  });

  it('refuses to delete the admin themself, and unknown users', async () => {
    const { admin, adminMe } = await setup();
    expect((await admin.delete(`/api/admin/users/${adminMe.id}`)).status).toBe(400);
    expect(
      (await admin.delete('/api/admin/users/00000000-0000-7000-8000-000000000000')).status,
    ).toBe(404);
  });
});
