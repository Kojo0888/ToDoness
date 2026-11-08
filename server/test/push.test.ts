import { describe, expect, it, vi } from 'vitest';
import { newId } from '@todoness/shared';
import { getVapidKeys } from '../src/push/keys';
import { sweepReminders, type PushPayload, type PushSend } from '../src/push/reminders';
import { loadConfig } from '../src/config';
import { testApp, testDb } from './helpers/app';
import { TestClient } from './helpers/client';
import { hlcAt, op, registerDevice, T0, type Device } from './helpers/sync';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const SUB = (n = 1) => ({
  endpoint: `https://push.example/device-${n}`,
  expirationTime: null,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

describe('VAPID keys (FR-64)', () => {
  const generate = () => ({ publicKey: 'GENERATED-PUB', privateKey: 'GENERATED-PRIV' });

  it('are generated once and then kept in the database', () => {
    const db = testDb();
    const gen = vi.fn(generate);
    const first = getVapidKeys(db, loadConfig({}), gen);
    expect(first).toEqual({ publicKey: 'GENERATED-PUB', privateKey: 'GENERATED-PRIV' });
    expect(getVapidKeys(db, loadConfig({}), gen)).toEqual(first);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('the environment wins over the database', () => {
    const db = testDb();
    getVapidKeys(db, loadConfig({}), generate);
    const cfg = loadConfig({ VAPID_PUBLIC_KEY: 'ENV-PUB', VAPID_PRIVATE_KEY: 'ENV-PRIV' });
    expect(getVapidKeys(db, cfg, generate)).toEqual({
      publicKey: 'ENV-PUB',
      privateKey: 'ENV-PRIV',
    });
  });

  it('real keys have the shape web push needs', () => {
    const k = getVapidKeys(testDb(), loadConfig({}));
    expect(k.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(k.privateKey).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });
});

describe('push routes (FR-59, FR-60)', () => {
  async function setup() {
    const t = testApp();
    const ann = await registerDevice(t.app, 'ann@corp.test');
    const bob = await registerDevice(t.app, 'bob@corp.test');
    const subs = () =>
      t.db
        .prepare('SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions ORDER BY endpoint')
        .all() as {
        user_id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }[];
    return { ...t, ann, bob, subs };
  }

  it('everything needs a login', async () => {
    const { app } = await setup();
    const anon = new TestClient(app);
    expect((await anon.get('/api/push/key')).status).toBe(401);
    expect((await anon.post('/api/push/subscribe', SUB())).status).toBe(401);
    expect((await anon.post('/api/push/unsubscribe', { endpoint: SUB().endpoint })).status).toBe(
      401,
    );
  });

  it('gives the public key, the same one each time', async () => {
    const { ann, db } = await setup();
    const res = await ann.device.http.get('/api/push/key');
    expect(res.status).toBe(200);
    const { publicKey } = await res.json();
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(publicKey).toBe(getVapidKeys(db, loadConfig({})).publicKey);
  });

  it('stores a subscription for the user', async () => {
    const { ann, subs } = await setup();
    expect((await ann.device.http.post('/api/push/subscribe', SUB())).status).toBe(204);
    expect(subs()).toEqual([
      { user_id: ann.me.id, endpoint: SUB().endpoint, p256dh: 'p256dh-1', auth: 'auth-1' },
    ]);
  });

  it('subscribing again updates it instead of duplicating', async () => {
    const { ann, subs } = await setup();
    await ann.device.http.post('/api/push/subscribe', SUB());
    await ann.device.http.post('/api/push/subscribe', {
      ...SUB(),
      keys: { p256dh: 'new', auth: 'new' },
    });
    expect(subs()).toHaveLength(1);
    expect(subs()[0]).toMatchObject({ p256dh: 'new', auth: 'new' });
  });

  it('the subscription moves to whoever subscribes last on the same browser', async () => {
    const { ann, bob, subs } = await setup();
    await ann.device.http.post('/api/push/subscribe', SUB());
    await bob.device.http.post('/api/push/subscribe', SUB());
    expect(subs()).toEqual([expect.objectContaining({ user_id: bob.me.id })]);
  });

  it('a user can have several devices', async () => {
    const { ann, subs } = await setup();
    await ann.device.http.post('/api/push/subscribe', SUB(1));
    await ann.device.http.post('/api/push/subscribe', SUB(2));
    expect(subs()).toHaveLength(2);
  });

  it('unsubscribing removes only the caller’s own subscription', async () => {
    const { ann, bob, subs } = await setup();
    await ann.device.http.post('/api/push/subscribe', SUB(1));
    await bob.device.http.post('/api/push/subscribe', SUB(2));
    expect(
      (await bob.device.http.post('/api/push/unsubscribe', { endpoint: SUB(1).endpoint })).status,
    ).toBe(204);
    expect(subs()).toHaveLength(2); // bob cannot remove ann's
    expect(
      (await ann.device.http.post('/api/push/unsubscribe', { endpoint: SUB(1).endpoint })).status,
    ).toBe(204);
    expect(subs().map((s) => s.endpoint)).toEqual([SUB(2).endpoint]);
    expect(
      (await ann.device.http.post('/api/push/unsubscribe', { endpoint: SUB(1).endpoint })).status,
    ).toBe(204); // idempotent
  });

  it('rejects bad input with 400', async () => {
    const { ann, subs } = await setup();
    for (const body of [
      {},
      { endpoint: 'http://insecure/x', keys: { p256dh: 'a', auth: 'b' } },
      { endpoint: SUB().endpoint },
    ]) {
      expect((await ann.device.http.post('/api/push/subscribe', body)).status).toBe(400);
    }
    expect((await ann.device.http.post('/api/push/unsubscribe', {})).status).toBe(400);
    expect(subs()).toEqual([]);
  });

  it('deleting a user deletes their subscriptions', async () => {
    const { ann, bob, subs, db } = await setup();
    await bob.device.http.post('/api/push/subscribe', SUB());
    db.prepare('DELETE FROM users WHERE id = ?').run(bob.me.id);
    expect(subs()).toEqual([]);
    void ann;
  });
});

describe('reminder sweep (FR-61 – FR-63)', () => {
  async function setup() {
    const t = testApp();
    const ann = await registerDevice(t.app, 'ann@corp.test');
    const inbox = await ann.device.inboxId();
    const sent: { endpoint: string; payload: PushPayload }[] = [];
    let result: 'ok' | 'gone' | 'failed' = 'ok';
    const failFor = new Map<string, 'gone' | 'failed'>();
    const send: PushSend = async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload });
      return failFor.get(sub.endpoint) ?? result;
    };
    let n = 10;
    const mk = async (d: Device, extra: Record<string, unknown>, title = 'Dentist') => {
      const id = newId();
      await d.push([
        op('todo', 'create', id, { listId: inbox, title, orderKey: `a${n}`, ...extra }, hlcAt(n++)),
      ]);
      return id;
    };
    const subscribe = (n = 1) => ann.device.http.post('/api/push/subscribe', SUB(n));
    const sweep = (now: number) => sweepReminders({ db: t.db, send, now });
    return {
      ...t,
      ann,
      inbox,
      sent,
      send,
      mk,
      subscribe,
      sweep,
      setResult: (r: typeof result) => (result = r),
      failFor,
    };
  }

  const due = T0 + 10 * DAY;

  it('sends one push, with title, text, tag and link, when the time has come', async () => {
    const s = await setup();
    const id = await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe();
    const r = await s.sweep(due - 2 * HOUR);
    expect(r.sent).toBe(1);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.endpoint).toBe(SUB().endpoint);
    expect(s.sent[0]!.payload).toEqual({
      title: 'Dentist',
      body: 'Due in 2 hours',
      tag: `${id}:${due}:day`,
      url: `/l/${s.inbox}/t/${id}`,
    });
  });

  it('waits for the reminder time, for week, day and hour', async () => {
    for (const [choice, ms] of [
      ['week', 7 * DAY],
      ['day', DAY],
      ['hour', HOUR],
    ] as const) {
      const s = await setup();
      await s.mk(s.ann.device, { dueAt: due, remindBefore: choice });
      await s.subscribe();
      expect((await s.sweep(due - ms - 1)).sent, choice).toBe(0);
      expect((await s.sweep(due - ms)).sent, choice).toBe(1);
    }
  });

  it('sends each reminder only once', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe();
    await s.sweep(due - 5 * HOUR);
    await s.sweep(due - 4 * HOUR);
    await s.sweep(due - 1);
    expect(s.sent).toHaveLength(1);
  });

  it('is not sent once the due moment has come, and catches up before it', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'week' });
    await s.subscribe();
    expect((await s.sweep(due)).sent).toBe(0); // too late
    expect((await s.sweep(due - 2 * DAY)).sent).toBe(1); // server was down for days: catch up
  });

  it('changing the due date or the choice sends it again', async () => {
    const s = await setup();
    const id = await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe();
    await s.sweep(due - HOUR);
    await s.ann.device.push([op('todo', 'update', id, { dueAt: due + 3 * HOUR }, hlcAt(100))]);
    await s.sweep(due - HOUR);
    await s.ann.device.push([op('todo', 'update', id, { remindBefore: 'hour' }, hlcAt(101))]);
    await s.sweep(due + 2 * HOUR + 1); // inside the last hour before the new due date
    expect(s.sent.map((x) => x.payload.tag)).toEqual([
      `${id}:${due}:day`,
      `${id}:${due + 3 * HOUR}:day`,
      `${id}:${due + 3 * HOUR}:hour`,
    ]);
  });

  it('skips completed, deleted, undated and reminder-less tasks', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day', done: true, completedAt: 1 });
    const del = await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.ann.device.push([op('todo', 'delete', del, {}, hlcAt(100))]);
    await s.mk(s.ann.device, { remindBefore: 'day' });
    await s.mk(s.ann.device, { dueAt: due });
    await s.subscribe();
    expect((await s.sweep(due - HOUR)).sent).toBe(0);
    expect(s.sent).toEqual([]);
  });

  it('sends to every device of the owner, and to nobody else', async () => {
    const s = await setup();
    const bob = await registerDevice(s.app, 'bob@corp.test');
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe(1);
    await s.subscribe(2);
    await bob.device.http.post('/api/push/subscribe', SUB(3));
    const r = await s.sweep(due - HOUR);
    expect(r.sent).toBe(1); // one reminder...
    expect(s.sent.map((x) => x.endpoint).sort()).toEqual([SUB(1).endpoint, SUB(2).endpoint]); // ...two devices
  });

  it('sends nothing, and does not use the reminder up, while the user has no device', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    expect((await s.sweep(due - 5 * HOUR)).sent).toBe(0);
    await s.subscribe(); // subscribes later, still before the task is due
    expect((await s.sweep(due - 4 * HOUR)).sent).toBe(1);
  });

  it('removes a subscription the push service says is gone, and still sends to the others', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe(1);
    await s.subscribe(2);
    s.failFor.set(SUB(1).endpoint, 'gone');
    await s.sweep(due - HOUR);
    expect(s.sent).toHaveLength(2);
    const left = (
      s.db.prepare('SELECT endpoint FROM push_subscriptions').all() as { endpoint: string }[]
    ).map((r) => r.endpoint);
    expect(left).toEqual([SUB(2).endpoint]);
  });

  it('retries on the next sweep if no device could be reached', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe();
    s.setResult('failed');
    expect((await s.sweep(due - 3 * HOUR)).sent).toBe(0);
    s.setResult('ok');
    expect((await s.sweep(due - 2 * HOUR)).sent).toBe(1);
  });

  it('one failing device does not stop the others or lose the reminder', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe(1);
    await s.subscribe(2);
    s.failFor.set(SUB(1).endpoint, 'failed');
    expect((await s.sweep(due - 3 * HOUR)).sent).toBe(1);
    expect(s.sent).toHaveLength(2);
    expect((await s.sweep(due - 2 * HOUR)).sent).toBe(0); // done: not resent to the other device
  });

  it('a throwing sender is treated as a failure', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe();
    const r = await sweepReminders({
      db: s.db,
      now: due - HOUR,
      send: async () => {
        throw new Error('network down');
      },
    });
    expect(r.sent).toBe(0);
    expect((await s.sweep(due - HOUR + 1000)).sent).toBe(1); // retried
  });

  it('forgets reminders of tasks that were due long ago', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { dueAt: due, remindBefore: 'day' });
    await s.subscribe();
    await s.sweep(due - HOUR);
    const count = () =>
      (s.db.prepare('SELECT COUNT(*) n FROM sent_reminders').get() as { n: number }).n;
    expect(count()).toBe(1);
    await s.sweep(due + 30 * DAY);
    expect(count()).toBe(1);
    await s.sweep(due + 61 * DAY);
    expect(count()).toBe(0);
  });

  it('a public-list task edited by someone else is still sent to the owner', async () => {
    const s = await setup();
    const bob = await registerDevice(s.app, 'bob@corp.test', 'bbbb');
    const list = newId();
    await s.ann.device.push([
      op('list', 'create', list, { name: 'Shared', orderKey: 'a9', isPublic: true }, hlcAt(5)),
    ]);
    const id = newId();
    await s.ann.device.push([
      op(
        'todo',
        'create',
        id,
        { listId: list, title: 'Shared task', orderKey: 'a0', dueAt: due },
        hlcAt(6),
      ),
    ]);
    await bob.device.http.post(`/api/public/lists/${list}/push`, {
      clientId: 'bbbb',
      ops: [op('todo', 'update', id, { remindBefore: 'hour' }, hlcAt(50, 'bbbb'))],
    });
    await s.subscribe();
    expect((await s.sweep(due - 30 * 60_000)).sent).toBe(1);
    expect(s.sent[0]!.payload.title).toBe('Shared task');
  });
});

describe('the real web push sender (FR-63, FR-64)', () => {
  /** A subscription like a browser creates: a P-256 key pair and a 16 byte secret. */
  async function browserSubscription() {
    const { createECDH, randomBytes } = await import('node:crypto');
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const b64 = (b: Buffer) => b.toString('base64url');
    return {
      endpoint: 'https://push.example/real-device',
      keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(randomBytes(16)) },
    };
  }

  it('the generated keys sign a valid request and the payload is encrypted', async () => {
    const { webpush } = await import('../src/push/webpush');
    const keys = getVapidKeys(testDb(), loadConfig({}));
    const sub = await browserSubscription();
    const details = webpush.generateRequestDetails(sub, JSON.stringify({ title: 'T' }), {
      vapidDetails: { subject: 'mailto:todoness@localhost', ...keys },
      TTL: 60,
    });
    expect(details.endpoint).toBe(sub.endpoint);
    expect(details.headers['Authorization']).toMatch(/^vapid t=.+, k=.+$/);
    expect(details.headers['Content-Encoding']).toBe('aes128gcm');
    expect(Buffer.isBuffer(details.body) && details.body.length > 50).toBe(true);
    expect(details.body.toString('utf8')).not.toContain('"title"'); // not readable on the wire
  });

  it('maps the push service’s answers: ok, gone (404, 410), failed (everything else)', async () => {
    const { createWebPushSender } = await import('../src/push/sender');
    const keys = getVapidKeys(testDb(), loadConfig({}));
    const deliver = vi.fn();
    const send = createWebPushSender(keys, 'mailto:todoness@localhost', deliver);
    const target = { endpoint: 'https://push.example/x', p256dh: 'p', auth: 'a' };
    const payload = { title: 'T', body: 'B', tag: 'k', url: '/l/1/t/2' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      deliver.mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} });
      expect(await send(target, payload)).toBe('ok');
      expect(deliver.mock.calls[0]![0]).toEqual({
        endpoint: target.endpoint,
        keys: { p256dh: 'p', auth: 'a' },
      });
      expect(JSON.parse(deliver.mock.calls[0]![1] as string)).toEqual(payload);

      for (const [status, expected] of [
        [404, 'gone'],
        [410, 'gone'],
        [429, 'failed'],
        [500, 'failed'],
        [undefined, 'failed'],
      ] as const) {
        deliver.mockRejectedValueOnce(Object.assign(new Error('nope'), { statusCode: status }));
        expect(await send(target, payload), String(status)).toBe(expected);
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});
