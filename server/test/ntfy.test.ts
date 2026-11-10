import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { newId } from '@todoness/shared';
import { createNtfySender, type NtfySend } from '../src/push/ntfy';
import { sweepReminders, type PushPayload, type PushSend } from '../src/push/reminders';
import { testApp } from './helpers/app';
import { TestClient } from './helpers/client';
import { hlcAt, op, registerDevice, T0, type Device } from './helpers/sync';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NTFY_ENV = { NTFY_URL: 'http://ntfy.lan:8080' };

const PAYLOAD: PushPayload = {
  title: 'Dentist',
  body: 'Due in 2 hours',
  tag: 'task-1:100:day',
  url: '/l/list-1/t/task-1',
};

describe('the ntfy sender', () => {
  const ok = () => new Response('{}', { status: 200 });

  function setup(opts: { token?: string; publicUrl?: string; fetch?: typeof fetch } = {}) {
    const fetchFn = vi.fn<typeof fetch>(opts.fetch ?? (async () => ok()));
    const send = createNtfySender({
      url: 'http://ntfy.lan:8080',
      ...(opts.token ? { token: opts.token } : {}),
      ...(opts.publicUrl ? { publicUrl: opts.publicUrl } : {}),
      fetch: fetchFn,
    });
    return { send, fetchFn };
  }

  const request = (fetchFn: ReturnType<typeof setup>['fetchFn']) => {
    const [url, init] = fetchFn.mock.calls[0]!;
    return {
      url: String(url),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    };
  };

  it('publishes the reminder as JSON to the server address', async () => {
    const { send, fetchFn } = setup();
    expect(await send('my-topic', PAYLOAD)).toBe('ok');
    const r = request(fetchFn);
    expect(r.url).toBe('http://ntfy.lan:8080');
    expect(r.method).toBe('POST');
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(r.headers.get('authorization')).toBeNull();
    expect(r.body).toMatchObject({
      topic: 'my-topic',
      title: 'Dentist',
      message: 'Due in 2 hours',
    });
  });

  it('sends non-ASCII titles intact (JSON, not HTTP headers)', async () => {
    const { send, fetchFn } = setup();
    await send('t', { ...PAYLOAD, title: 'Zażółć gęślą jaźń ✓' });
    expect(request(fetchFn).body.title).toBe('Zażółć gęślą jaźń ✓');
  });

  it('adds a bearer token when one is configured', async () => {
    const { send, fetchFn } = setup({ token: 'tk_secret' });
    await send('t', PAYLOAD);
    expect(request(fetchFn).headers.get('authorization')).toBe('Bearer tk_secret');
  });

  it('makes the click open the task when the public address of the app is known', async () => {
    const { send, fetchFn } = setup({ publicUrl: 'https://todo.example' });
    await send('t', PAYLOAD);
    expect(request(fetchFn).body.click).toBe('https://todo.example/l/list-1/t/task-1');
  });

  it('leaves the click out when the public address is unknown', async () => {
    const { send, fetchFn } = setup();
    await send('t', PAYLOAD);
    expect(request(fetchFn).body).not.toHaveProperty('click');
  });

  it('is a high priority alarm, not a silent message', async () => {
    const { send, fetchFn } = setup();
    await send('t', PAYLOAD);
    const { priority, tags } = request(fetchFn).body;
    expect(priority).toBeGreaterThanOrEqual(4);
    expect(tags).toContain('alarm_clock');
  });

  it('says failed for any answer that is not a success, and for network errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const status of [400, 401, 403, 404, 429, 500, 502]) {
        const { send } = setup({ fetch: async () => new Response('no', { status }) });
        expect(await send('t', PAYLOAD), String(status)).toBe('failed');
      }
      const down = setup({
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
      });
      expect(await down.send('t', PAYLOAD)).toBe('failed');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('does not log the topic or the token when it fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { send } = setup({
        token: 'tk_secret',
        fetch: async () => new Response('no', { status: 500 }),
      });
      await send('very-private-topic', PAYLOAD);
      const logged = warn.mock.calls.flat().join(' ');
      expect(logged).toContain('ntfy.lan');
      expect(logged).not.toContain('very-private-topic');
      expect(logged).not.toContain('tk_secret');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('gives up on a server that never answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { send, fetchFn } = setup({
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      });
      vi.useFakeTimers();
      const result = send('t', PAYLOAD);
      await vi.advanceTimersByTimeAsync(5_000); // a dead server must not hold up the sweep
      expect(await result).toBe('failed');
      expect(fetchFn.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

describe('the ntfy sender over real HTTP', () => {
  it('delivers to a stub ntfy server exactly as ntfy expects it', async () => {
    const received: { method?: string; headers: IncomingHttpHeaders; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ method: req.method, headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const send = createNtfySender({ url, token: 'tk_x', publicUrl: 'https://todo.example' });
      expect(await send('real-topic', { ...PAYLOAD, title: 'Zażółć ✓' })).toBe('ok');
      expect(received).toHaveLength(1);
      expect(received[0]!.method).toBe('POST');
      expect(received[0]!.headers['authorization']).toBe('Bearer tk_x');
      expect(JSON.parse(received[0]!.body)).toMatchObject({
        topic: 'real-topic',
        title: 'Zażółć ✓',
        message: 'Due in 2 hours',
        click: 'https://todo.example/l/list-1/t/task-1',
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('says failed when nothing is listening', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const send = createNtfySender({ url: 'http://127.0.0.1:1' });
      expect(await send('t', PAYLOAD)).toBe('failed');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('ntfy routes', () => {
  async function setup(env: Record<string, string> = NTFY_ENV) {
    let clock = T0;
    const now = () => clock;
    const sent: { topic: string; payload: PushPayload }[] = [];
    let result: 'ok' | 'failed' = 'ok';
    const ntfySend: NtfySend = async (topic, payload) => {
      sent.push({ topic, payload });
      return result;
    };
    // Without NTFY_URL the server has no sender at all, whatever the test would inject.
    const t = testApp(env, env.NTFY_URL ? { ntfySend, now } : { now });
    const ann = await registerDevice(t.app, 'ann@corp.test');
    const bob = await registerDevice(t.app, 'bob@corp.test');
    const rows = () =>
      t.db.prepare('SELECT user_id, topic FROM ntfy_topics ORDER BY user_id').all() as {
        user_id: string;
        topic: string;
      }[];
    return {
      ...t,
      ann,
      bob,
      sent,
      rows,
      setResult: (r: typeof result) => (result = r),
      tick: (ms: number) => (clock += ms),
    };
  }

  it('everything needs a login', async () => {
    const { app } = await setup();
    const anon = new TestClient(app);
    expect((await anon.get('/api/ntfy')).status).toBe(401);
    expect((await anon.request('PUT', '/api/ntfy', { topic: 'abc' })).status).toBe(401);
    expect((await anon.delete('/api/ntfy')).status).toBe(401);
    expect((await anon.post('/api/ntfy/test')).status).toBe(401);
  });

  it('says it is off when the server has no NTFY_URL', async () => {
    const { ann } = await setup({});
    const res = await ann.device.http.get('/api/ntfy');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, url: null, topic: null });
  });

  it('says it is on, with the server address and no topic yet', async () => {
    const { ann } = await setup();
    expect(await (await ann.device.http.get('/api/ntfy')).json()).toEqual({
      enabled: true,
      url: 'http://ntfy.lan:8080',
      topic: null,
    });
  });

  it('never gives away the access token', async () => {
    const { ann } = await setup({ ...NTFY_ENV, NTFY_TOKEN: 'tk_secret' });
    expect(JSON.stringify(await (await ann.device.http.get('/api/ntfy')).json())).not.toContain(
      'tk_secret',
    );
  });

  it('stores the topic for the user and returns it', async () => {
    const { ann, rows } = await setup();
    expect(
      (await ann.device.http.request('PUT', '/api/ntfy', { topic: 'ann-tasks_01' })).status,
    ).toBe(204);
    expect(rows()).toEqual([{ user_id: ann.me.id, topic: 'ann-tasks_01' }]);
    expect((await (await ann.device.http.get('/api/ntfy')).json()).topic).toBe('ann-tasks_01');
  });

  it('changing the topic replaces it instead of adding a second one', async () => {
    const { ann, rows } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'first' });
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'second' });
    expect(rows()).toEqual([{ user_id: ann.me.id, topic: 'second' }]);
  });

  it('each user has their own topic and cannot see or remove the other’s', async () => {
    const { ann, bob, rows } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'ann-topic' });
    await bob.device.http.request('PUT', '/api/ntfy', { topic: 'bob-topic' });
    expect((await (await bob.device.http.get('/api/ntfy')).json()).topic).toBe('bob-topic');
    await bob.device.http.delete('/api/ntfy');
    expect(rows()).toEqual([{ user_id: ann.me.id, topic: 'ann-topic' }]);
  });

  it('two users cannot share a topic (it would leak reminders between them)', async () => {
    const { ann, bob, rows } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'same-topic' });
    const res = await bob.device.http.request('PUT', '/api/ntfy', { topic: 'same-topic' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('topic_taken');
    expect(rows()).toEqual([{ user_id: ann.me.id, topic: 'same-topic' }]);
  });

  it('keeping your own topic is not a conflict', async () => {
    const { ann } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'mine' });
    expect((await ann.device.http.request('PUT', '/api/ntfy', { topic: 'mine' })).status).toBe(204);
  });

  it('rejects topics ntfy would not accept', async () => {
    const { ann, rows } = await setup();
    for (const topic of [
      '',
      'has space',
      'slash/inside',
      'dot.dot',
      'ł',
      'x'.repeat(65),
      123,
      null,
    ]) {
      const res = await ann.device.http.request('PUT', '/api/ntfy', { topic });
      expect(res.status, String(topic)).toBe(400);
    }
    expect((await ann.device.http.request('PUT', '/api/ntfy', {})).status).toBe(400);
    expect(rows()).toEqual([]);
  });

  it('refuses to store a topic while ntfy is off on the server', async () => {
    const { ann, rows } = await setup({});
    const res = await ann.device.http.request('PUT', '/api/ntfy', { topic: 'abc' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ntfy_disabled');
    expect(rows()).toEqual([]);
  });

  it('removes the topic, and removing twice is fine', async () => {
    const { ann, rows } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'abc' });
    expect((await ann.device.http.delete('/api/ntfy')).status).toBe(204);
    expect(rows()).toEqual([]);
    expect((await ann.device.http.delete('/api/ntfy')).status).toBe(204);
  });

  it('deleting a user deletes their topic', async () => {
    const { bob, rows, db } = await setup();
    await bob.device.http.request('PUT', '/api/ntfy', { topic: 'bob-topic' });
    db.prepare('DELETE FROM users WHERE id = ?').run(bob.me.id);
    expect(rows()).toEqual([]);
  });

  it('sends a test notification to the caller’s own topic', async () => {
    const { ann, bob, sent } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'ann-topic' });
    await bob.device.http.request('PUT', '/api/ntfy', { topic: 'bob-topic' });
    expect((await ann.device.http.post('/api/ntfy/test')).status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.topic).toBe('ann-topic');
    expect(sent[0]!.payload.title).toMatch(/ToDoness/);
  });

  it('shows users the public ntfy address when the server reaches ntfy by another one', async () => {
    const { ann } = await setup({
      NTFY_URL: 'http://ntfy:80',
      NTFY_PUBLIC_URL: 'https://ntfy.example',
    });
    expect((await (await ann.device.http.get('/api/ntfy')).json()).url).toBe(
      'https://ntfy.example',
    );
  });

  it('allows one test notification per user every 10 seconds', async () => {
    const { ann, bob, sent, tick } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'ann-topic' });
    await bob.device.http.request('PUT', '/api/ntfy', { topic: 'bob-topic' });
    expect((await ann.device.http.post('/api/ntfy/test')).status).toBe(204);

    const again = await ann.device.http.post('/api/ntfy/test');
    expect(again.status).toBe(429);
    expect((await again.json()).error).toBe('too_many_requests');
    expect(Number(again.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await bob.device.http.post('/api/ntfy/test')).status).toBe(204); // others unaffected

    tick(10_000);
    expect((await ann.device.http.post('/api/ntfy/test')).status).toBe(204);
    expect(sent.map((x) => x.topic)).toEqual(['ann-topic', 'bob-topic', 'ann-topic']);
  });

  it('a failed test notification counts too, so a looping client cannot hammer ntfy', async () => {
    const { ann, sent, setResult } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'ann-topic' });
    setResult('failed');
    expect((await ann.device.http.post('/api/ntfy/test')).status).toBe(502);
    expect((await ann.device.http.post('/api/ntfy/test')).status).toBe(429);
    expect(sent).toHaveLength(1);
  });

  it('the test notification needs a topic', async () => {
    const { ann, sent } = await setup();
    const res = await ann.device.http.post('/api/ntfy/test');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('no_topic');
    expect(sent).toEqual([]);
  });

  it('the test notification says so when the ntfy server cannot be reached', async () => {
    const { ann, setResult } = await setup();
    await ann.device.http.request('PUT', '/api/ntfy', { topic: 'abc' });
    setResult('failed');
    const res = await ann.device.http.post('/api/ntfy/test');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('send_failed');
  });

  it('the test notification is refused while ntfy is off on the server', async () => {
    const { ann, sent } = await setup({});
    const res = await ann.device.http.post('/api/ntfy/test');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ntfy_disabled');
    expect(sent).toEqual([]);
  });
});

describe('reminder sweep with ntfy', () => {
  const due = T0 + 10 * DAY;

  async function setup() {
    const t = testApp(NTFY_ENV);
    const ann = await registerDevice(t.app, 'ann@corp.test');
    const bob = await registerDevice(t.app, 'bob@corp.test');
    const inbox = await ann.device.inboxId();
    const web: { endpoint: string; payload: PushPayload }[] = [];
    const ntfy: { topic: string; payload: PushPayload }[] = [];
    let webResult: 'ok' | 'gone' | 'failed' = 'ok';
    let ntfyResult: 'ok' | 'failed' = 'ok';
    const send: PushSend = async (target, payload) => {
      web.push({ endpoint: target.endpoint, payload });
      return webResult;
    };
    const sendNtfy: NtfySend = async (topic, payload) => {
      ntfy.push({ topic, payload });
      return ntfyResult;
    };
    let n = 10;
    const mk = async (d: Device, extra: Record<string, unknown> = {}, title = 'Dentist') => {
      const id = newId();
      await d.push([
        op(
          'todo',
          'create',
          id,
          {
            listId: await d.inboxId(),
            title,
            orderKey: `a${n}`,
            dueAt: due,
            remindBefore: 'day',
            ...extra,
          },
          hlcAt(n++),
        ),
      ]);
      return id;
    };
    const topic = (d: Device, name: string) => d.http.request('PUT', '/api/ntfy', { topic: name });
    const webSub = (d: Device, k = 1) =>
      d.http.post('/api/push/subscribe', {
        endpoint: `https://push.example/device-${k}`,
        keys: { p256dh: 'p', auth: 'a' },
      });
    const sweep = (now: number, deps: { sendNtfy?: NtfySend } = { sendNtfy }) =>
      sweepReminders({ db: t.db, send, now, ...deps });
    return {
      ...t,
      ann,
      bob,
      inbox,
      web,
      ntfy,
      mk,
      topic,
      webSub,
      sweep,
      setWeb: (r: typeof webResult) => (webResult = r),
      setNtfy: (r: typeof ntfyResult) => (ntfyResult = r),
    };
  }

  it('sends the reminder to the owner’s topic, with the same content as a web push', async () => {
    const s = await setup();
    const id = await s.mk(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    const r = await s.sweep(due - 2 * HOUR);
    expect(r.sent).toBe(1);
    expect(s.ntfy).toEqual([
      {
        topic: 'ann-topic',
        payload: {
          title: 'Dentist',
          body: 'Due in 2 hours',
          tag: `${id}:${due}:day`,
          url: `/l/${s.inbox}/t/${id}`,
        },
      },
    ]);
  });

  it('works without any web push device', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    expect((await s.sweep(due - HOUR)).sent).toBe(1);
    expect(s.web).toEqual([]);
  });

  it('sends to web push devices and to the topic when the user has both', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.webSub(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    const r = await s.sweep(due - HOUR);
    expect(r.sent).toBe(1); // one reminder
    expect(s.web).toHaveLength(1);
    expect(s.ntfy).toHaveLength(1);
  });

  it('sends each reminder to ntfy only once', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    await s.sweep(due - 5 * HOUR);
    await s.sweep(due - 4 * HOUR);
    await s.sweep(due - 1);
    expect(s.ntfy).toHaveLength(1);
  });

  it('never sends one user’s reminder to another user’s topic', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.topic(s.bob.device, 'bob-topic');
    expect((await s.sweep(due - HOUR)).sent).toBe(0);
    expect(s.ntfy).toEqual([]);
  });

  it('does not use the reminder up while the user has no topic and no device', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    expect((await s.sweep(due - 5 * HOUR)).sent).toBe(0);
    await s.topic(s.ann.device, 'ann-topic'); // sets it up later, still before the due time
    expect((await s.sweep(due - 4 * HOUR)).sent).toBe(1);
  });

  it('retries on the next sweep if ntfy was the only way and it was down', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    s.setNtfy('failed');
    expect((await s.sweep(due - 3 * HOUR)).sent).toBe(0);
    s.setNtfy('ok');
    expect((await s.sweep(due - 2 * HOUR)).sent).toBe(1);
    expect(s.ntfy).toHaveLength(2);
  });

  it('a failing ntfy server does not lose a reminder that a web push device got', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.webSub(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    s.setNtfy('failed');
    expect((await s.sweep(due - 3 * HOUR)).sent).toBe(1);
    expect((await s.sweep(due - 2 * HOUR)).sent).toBe(0); // done, not resent to the web device
    expect(s.web).toHaveLength(1);
  });

  it('a failing web push does not lose a reminder that ntfy delivered', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.webSub(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    s.setWeb('failed');
    expect((await s.sweep(due - 3 * HOUR)).sent).toBe(1);
    expect((await s.sweep(due - 2 * HOUR)).sent).toBe(0);
    expect(s.ntfy).toHaveLength(1);
  });

  it('a throwing ntfy sender is treated as a failure and does not stop web push', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.webSub(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    const r = await s.sweep(due - HOUR, {
      sendNtfy: async () => {
        throw new Error('network down');
      },
    });
    expect(r.sent).toBe(1);
    expect(s.web).toHaveLength(1);
  });

  it('ignores stored topics while ntfy is not configured, and keeps the reminder for later', async () => {
    const s = await setup();
    await s.mk(s.ann.device);
    await s.topic(s.ann.device, 'ann-topic');
    expect((await s.sweep(due - 3 * HOUR, {})).sent).toBe(0); // no sender given
    expect((await s.sweep(due - 2 * HOUR)).sent).toBe(1); // ntfy switched on later: still delivered
    expect(s.ntfy).toHaveLength(1);
  });

  it('sends several reminders at once, so a slow ntfy server cannot hold up the others', async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++) await s.mk(s.ann.device, {}, `Task ${i}`);
    await s.topic(s.ann.device, 'ann-topic');
    let inFlight = 0;
    let most = 0;
    const slow: NtfySend = async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return 'ok';
    };
    expect((await s.sweep(due - HOUR, { sendNtfy: slow })).sent).toBe(20);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(8); // capped, so ntfy is not flooded
  });

  it('ends only after every send has finished, even when the database fails midway', async () => {
    const s = await setup();
    for (let i = 0; i < 4; i++) await s.mk(s.ann.device, {}, `Task ${i}`);
    await s.topic(s.ann.device, 'ann-topic');
    let inFlight = 0;
    let first = true;
    const closing: NtfySend = async () => {
      inFlight++;
      if (first) {
        first = false;
        s.db.close(); // every later database call throws
        await new Promise((r) => setTimeout(r, 30)); // this send is still running...
      } else await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return 'ok';
    };
    const sweep = sweepReminders({
      db: s.db,
      send: async () => 'ok',
      sendNtfy: closing,
      now: due - HOUR,
    });
    await expect(sweep).rejects.toThrow();
    expect(inFlight).toBe(0); // ...and the sweep waited for it before reporting the error
  });

  it('skips completed, deleted, undated and reminder-less tasks, like web push does', async () => {
    const s = await setup();
    await s.mk(s.ann.device, { done: true, completedAt: 1 });
    const del = await s.mk(s.ann.device);
    await s.ann.device.push([op('todo', 'delete', del, {}, hlcAt(100))]);
    await s.mk(s.ann.device, { dueAt: null });
    await s.mk(s.ann.device, { remindBefore: null });
    await s.topic(s.ann.device, 'ann-topic');
    expect((await s.sweep(due - HOUR)).sent).toBe(0);
    expect(s.ntfy).toEqual([]);
  });
});
