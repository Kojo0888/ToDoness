import { describe, expect, it } from 'vitest';
import {
  ntfySubscribeUrl,
  randomNtfyTopic,
  removeNtfyTopic,
  saveNtfyTopic,
  sendNtfyTest,
  loadNtfyStatus,
} from '../../src/services/ntfy';
import { fakeFetch, json } from '../helpers/fetch';

const status = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  url: 'http://ntfy.lan:8080',
  topic: null,
  ...over,
});

describe('loadNtfyStatus', () => {
  it('reads what the server says', async () => {
    const f = fakeFetch(() => json(200, status({ topic: 'abc' })));
    expect(await loadNtfyStatus(f)).toEqual(status({ topic: 'abc' }));
    expect(f.calls[0]).toMatchObject({ url: '/api/ntfy', method: 'GET' });
  });

  it('knows when the server has ntfy switched off', async () => {
    const off = { enabled: false, url: null, topic: null };
    expect(await loadNtfyStatus(fakeFetch(() => json(200, off)))).toEqual(off);
  });

  it('gives undefined, not an exception, when the server cannot be reached or answers wrongly', async () => {
    expect(await loadNtfyStatus(fakeFetch(() => 'network-error'))).toBeUndefined();
    expect(await loadNtfyStatus(fakeFetch(() => json(500, {})))).toBeUndefined();
    expect(await loadNtfyStatus(fakeFetch(() => json(200, { nonsense: true })))).toBeUndefined();
    expect(await loadNtfyStatus(fakeFetch(() => new Response('<html>', { status: 200 })))).toBe(
      undefined,
    );
  });
});

describe('saveNtfyTopic', () => {
  it('sends the topic and says ok', async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }));
    expect(await saveNtfyTopic('my-topic', f)).toBe('ok');
    expect(f.calls[0]).toMatchObject({
      url: '/api/ntfy',
      method: 'PUT',
      body: { topic: 'my-topic' },
    });
  });

  it('trims the topic before checking and sending it', async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }));
    expect(await saveNtfyTopic('  my-topic  ', f)).toBe('ok');
    expect(f.calls[0]!.body).toEqual({ topic: 'my-topic' });
  });

  it('does not even ask the server about a topic that is not valid', async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }));
    for (const bad of ['', 'has space', 'a/b', 'x'.repeat(65)]) {
      expect(await saveNtfyTopic(bad, f), bad).toBe('invalid');
    }
    expect(f.calls).toEqual([]);
  });

  it('tells the reasons apart', async () => {
    const reply = (status: number, error: string) => fakeFetch(() => json(status, { error }));
    expect(await saveNtfyTopic('abc', reply(400, 'invalid_request'))).toBe('invalid');
    expect(await saveNtfyTopic('abc', reply(409, 'topic_taken'))).toBe('taken');
    expect(await saveNtfyTopic('abc', reply(409, 'ntfy_disabled'))).toBe('disabled');
    expect(await saveNtfyTopic('abc', reply(500, 'internal'))).toBe('failed');
    expect(
      await saveNtfyTopic(
        'abc',
        fakeFetch(() => 'network-error'),
      ),
    ).toBe('failed');
  });
});

describe('removeNtfyTopic', () => {
  it('asks the server to forget the topic', async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }));
    expect(await removeNtfyTopic(f)).toBe(true);
    expect(f.calls[0]).toMatchObject({ url: '/api/ntfy', method: 'DELETE' });
  });

  it('says false when it did not work', async () => {
    expect(await removeNtfyTopic(fakeFetch(() => json(500, {})))).toBe(false);
    expect(await removeNtfyTopic(fakeFetch(() => 'network-error'))).toBe(false);
  });
});

describe('sendNtfyTest', () => {
  it('asks the server to send a test notification', async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }));
    expect(await sendNtfyTest(f)).toBe('ok');
    expect(f.calls[0]).toMatchObject({ url: '/api/ntfy/test', method: 'POST' });
  });

  it('tells the reasons apart', async () => {
    expect(await sendNtfyTest(fakeFetch(() => json(409, { error: 'no_topic' })))).toBe('no_topic');
    expect(await sendNtfyTest(fakeFetch(() => json(409, { error: 'ntfy_disabled' })))).toBe(
      'disabled',
    );
    expect(await sendNtfyTest(fakeFetch(() => json(502, { error: 'send_failed' })))).toBe('failed');
    expect(await sendNtfyTest(fakeFetch(() => 'network-error'))).toBe('failed');
    expect(await sendNtfyTest(fakeFetch(() => json(429, { error: 'too_many_requests' })))).toBe(
      'rate_limited',
    );
  });
});

describe('randomNtfyTopic', () => {
  it('makes a valid topic that is hard to guess, because on a shared ntfy server the name is the password', () => {
    const topic = randomNtfyTopic();
    expect(topic).toMatch(/^ToDoness_[a-z0-9]{24}$/);
  });

  it('is different every time', () => {
    const all = new Set(Array.from({ length: 50 }, () => randomNtfyTopic()));
    expect(all.size).toBe(50);
  });
});

describe('ntfySubscribeUrl', () => {
  it('is the address to open in the ntfy app', () => {
    expect(ntfySubscribeUrl('http://ntfy.lan:8080', 'abc')).toBe('http://ntfy.lan:8080/abc');
    expect(ntfySubscribeUrl('https://ntfy.sh/', 'abc')).toBe('https://ntfy.sh/abc');
  });
});
