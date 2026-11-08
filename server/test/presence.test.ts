import { describe, expect, it } from 'vitest';
import { testApp } from './helpers/app';
import { TestClient } from './helpers/client';

const PW = 'correct horse';
const T0 = 1_730_822_400_000;

async function setup() {
  const clock = { t: T0 };
  const t = testApp({}, { now: () => clock.t });
  const admin = new TestClient(t.app);
  await admin.post('/api/auth/register', { email: 'admin@corp.test', password: PW });
  const bob = new TestClient(t.app);
  const bobMe = await (
    await bob.post('/api/auth/register', { email: 'bob@corp.test', password: PW })
  ).json();
  const users = async () => {
    const res = await admin.get('/api/admin/users');
    expect(res.status).toBe(200);
    const body = await res.json();
    return Object.fromEntries(body.users.map((u: { email: string }) => [u.email, u]));
  };
  return { ...t, clock, admin, bob, bobMe, users };
}

describe('who is online (FR-56 – FR-58)', () => {
  it('a user who just registered or logged in is online', async () => {
    const s = await setup();
    const u = await s.users();
    expect(u['bob@corp.test']).toMatchObject({ online: true, lastSeenAt: T0 });
  });

  it('a user the server never heard from is offline with no last-seen time', async () => {
    const s = await setup();
    s.db
      .prepare(
        "INSERT INTO users (id, email, password_hash, role, created_at, updated_at) VALUES ('0192f0c1-0000-7000-8000-0000000000aa','new@corp.test',NULL,'user',1,1)",
      )
      .run();
    expect((await s.users())['new@corp.test']).toMatchObject({ online: false, lastSeenAt: null });
  });

  it('stays online while the user keeps talking to the server', async () => {
    const s = await setup();
    for (let i = 0; i < 12; i++) {
      s.clock.t += 5_000; // the app syncs about every 5 seconds
      expect((await s.bob.get('/api/sync/pull')).status).toBe(200);
    }
    expect((await s.users())['bob@corp.test'].online).toBe(true);
  });

  it('goes offline after ONLINE_WINDOW_SECONDS without a request', async () => {
    const s = await setup();
    await s.bob.get('/api/me');
    s.clock.t += 29_000;
    expect((await s.users())['bob@corp.test'].online).toBe(true);
    s.clock.t += 2_000; // 31 s since the last request
    const bob = (await s.users())['bob@corp.test'];
    expect(bob.online).toBe(false);
    expect(bob.lastSeenAt).toBe(T0);
  });

  it('comes back online with the next request', async () => {
    const s = await setup();
    s.clock.t += 120_000;
    expect((await s.users())['bob@corp.test'].online).toBe(false);
    await s.bob.get('/api/sync/pull');
    expect((await s.users())['bob@corp.test'].online).toBe(true);
  });

  it('honours a custom window', async () => {
    const clock = { t: T0 };
    const t = testApp({ ONLINE_WINDOW_SECONDS: '60' }, { now: () => clock.t });
    const admin = new TestClient(t.app);
    await admin.post('/api/auth/register', { email: 'admin@corp.test', password: PW });
    const bob = new TestClient(t.app);
    await bob.post('/api/auth/register', { email: 'bob@corp.test', password: PW });
    clock.t += 50_000;
    await admin.get('/api/me'); // keeps the admin itself online
    const list = async () =>
      (await (await admin.get('/api/admin/users')).json()).users.find(
        (u: { email: string }) => u.email === 'bob@corp.test',
      );
    expect((await list()).online).toBe(true);
    clock.t += 20_000;
    expect((await list()).online).toBe(false);
  });

  it('does not write on every request (at most about once per 5 seconds)', async () => {
    const s = await setup();
    const seen = () =>
      (
        s.db.prepare("SELECT last_seen_at v FROM users WHERE email = 'bob@corp.test'").get() as {
          v: number;
        }
      ).v;
    expect(seen()).toBe(T0);
    s.clock.t += 2_000;
    await s.bob.get('/api/me');
    expect(seen()).toBe(T0); // throttled
    s.clock.t += 3_000;
    await s.bob.get('/api/me');
    expect(seen()).toBe(T0 + 5_000);
  });

  it('failed requests do not count as being online', async () => {
    const s = await setup();
    s.clock.t += 60_000;
    expect((await new TestClient(s.app).get('/api/sync/pull')).status).toBe(401);
    expect((await s.users())['bob@corp.test'].online).toBe(false);
  });

  it('only admins see the list', async () => {
    const s = await setup();
    expect((await s.bob.get('/api/admin/users')).status).toBe(403);
  });
});
