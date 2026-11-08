import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { testApp } from './helpers/app';
import { TestClient } from './helpers/client';
import { hlcAt, op, registerDevice, type Device } from './helpers/sync';

const MB = 1024 * 1024;

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'todoness-files-'));
  const t = testApp({ ATTACHMENTS_DIR: dir, MAX_ATTACHMENT_MB: '1', ...env });
  const ann = await registerDevice(t.app, 'ann@corp.test');
  const bob = await registerDevice(t.app, 'bob@corp.test');
  const annInbox = await ann.device.inboxId();

  async function createTodo(d: Device, listId: string, title = 'Task') {
    const id = newId();
    await d.push([op('todo', 'create', id, { listId, title, orderKey: 'a0' }, hlcAt(1))]);
    return id;
  }
  const todoId = await createTodo(ann.device, annInbox);

  return { ...t, dir, ann, bob, annInbox, todoId, createTodo };
}

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const upload = (
  c: TestClient,
  todoId: string,
  body: Uint8Array,
  name = 'notes.txt',
  type = 'text/plain',
) =>
  c.upload(`/api/todos/${todoId}/attachments?name=${encodeURIComponent(name)}`, body, {
    'content-type': type,
  });

let s: Ctx;
beforeEach(async () => {
  s = await setup();
});

describe('GET /api/config', () => {
  it('tells the app the size limit, without a login', async () => {
    const res = await new TestClient(s.app).get('/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ maxAttachmentBytes: MB });
  });

  it('reports the default of 100 MB', async () => {
    const t = testApp({ ATTACHMENTS_DIR: s.dir });
    const res = await new TestClient(t.app).get('/api/config');
    expect(await res.json()).toEqual({ maxAttachmentBytes: 100 * MB });
  });
});

describe('uploading (FR-48 – FR-51)', () => {
  it('stores the file and lists it', async () => {
    const data = new TextEncoder().encode('hello attachment');
    const res = await upload(s.ann.device.http, s.todoId, data, 'hello.txt');
    expect(res.status).toBe(201);
    const meta = await res.json();
    expect(meta).toMatchObject({ name: 'hello.txt', size: data.length, contentType: 'text/plain' });
    expect(meta.id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await s.ann.device.http.get(`/api/todos/${s.todoId}/attachments`);
    expect(list.status).toBe(200);
    expect((await list.json()).attachments).toEqual([meta]);

    expect(readdirSync(join(s.dir, s.ann.me.id))).toEqual([meta.id]);
  });

  it('keeps the original bytes (download is identical)', async () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
    const meta = await (
      await upload(s.ann.device.http, s.todoId, data, 'blob.bin', 'application/octet-stream')
    ).json();
    const res = await s.ann.device.http.get(`/api/attachments/${meta.id}`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
  });

  it('accepts a file exactly at the limit', async () => {
    const res = await upload(s.ann.device.http, s.todoId, bytes(MB));
    expect(res.status).toBe(201);
    expect((await res.json()).size).toBe(MB);
  });

  it('refuses a file above the limit by its declared size, storing nothing', async () => {
    const res = await upload(s.ann.device.http, s.todoId, bytes(MB + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'file_too_large' });
    expect(count(s)).toBe(0);
    expect(filesOnDisk(s)).toEqual([]);
  });

  it('refuses a body that grows beyond the limit while streaming, and leaves no file', async () => {
    // No Content-Length is sent, and the stream keeps going past the limit.
    const chunk = bytes(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= MB + 3 * chunk.length) return controller.close();
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const res = await s.ann.device.http.upload(
      `/api/todos/${s.todoId}/attachments?name=big.bin`,
      stream,
    );
    expect(res.status).toBe(413);
    expect(count(s)).toBe(0);
    expect(filesOnDisk(s)).toEqual([]);
  });

  it('refuses a body that lies about its length', async () => {
    const res = await s.ann.device.http.upload(
      `/api/todos/${s.todoId}/attachments?name=liar.bin`,
      bytes(MB + 100),
      { 'content-length': '10' },
    );
    expect([413, 400]).toContain(res.status);
    expect(count(s)).toBe(0);
    expect(filesOnDisk(s)).toEqual([]);
  });

  it('honours a custom MAX_ATTACHMENT_MB', async () => {
    const t = await setup({ MAX_ATTACHMENT_MB: '3' });
    expect((await upload(t.ann.device.http, t.todoId, bytes(2 * MB))).status).toBe(201);
    expect((await upload(t.ann.device.http, t.todoId, bytes(3 * MB + 1))).status).toBe(413);
  });

  it('refuses an empty file and a missing or bad name', async () => {
    const c = s.ann.device.http;
    expect((await upload(c, s.todoId, new Uint8Array(0))).status).toBe(400);
    expect((await c.upload(`/api/todos/${s.todoId}/attachments`, bytes(3))).status).toBe(400);
    expect((await upload(c, s.todoId, bytes(3), '   ')).status).toBe(400);
    expect((await upload(c, s.todoId, bytes(3), 'x'.repeat(256))).status).toBe(400);
    expect(count(s)).toBe(0);
  });

  it('keeps only the file name of a path, and never uses it on disk', async () => {
    const res = await upload(s.ann.device.http, s.todoId, bytes(3), '../../etc/passwd');
    expect(res.status).toBe(201);
    const meta = await res.json();
    expect(meta.name).toBe('passwd');
    expect(filesOnDisk(s)).toEqual([meta.id]);
  });

  it('falls back to a generic type when the content type looks wrong', async () => {
    const bad = await upload(s.ann.device.http, s.todoId, bytes(3), 'a.bin', 'nonsense');
    expect((await bad.json()).contentType).toBe('application/octet-stream');
    const params = await upload(
      s.ann.device.http,
      s.todoId,
      bytes(3),
      'b.txt',
      'Text/Plain; charset=utf-8',
    );
    expect((await params.json()).contentType).toBe('text/plain');
  });

  it('works for several files on one task', async () => {
    for (const n of ['a.txt', 'b.txt', 'c.txt'])
      await upload(s.ann.device.http, s.todoId, bytes(2), n);
    const list = (await (await s.ann.device.http.get(`/api/todos/${s.todoId}/attachments`)).json())
      .attachments;
    expect(list.map((a: { name: string }) => a.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });
});

describe('who may do what (FR-53)', () => {
  it('needs a login', async () => {
    const anon = new TestClient(s.app);
    expect((await upload(anon, s.todoId, bytes(3))).status).toBe(401);
    expect((await anon.get(`/api/todos/${s.todoId}/attachments`)).status).toBe(401);
    expect((await anon.get(`/api/attachments/${newId()}`)).status).toBe(401);
  });

  it('an unknown task is 404', async () => {
    expect((await upload(s.ann.device.http, newId(), bytes(3))).status).toBe(404);
    expect((await upload(s.ann.device.http, 'not-an-id', bytes(3))).status).toBe(404);
  });

  it('another user cannot see, upload to or download from a private task', async () => {
    const meta = await (await upload(s.ann.device.http, s.todoId, bytes(3))).json();
    const bob = s.bob.device.http;
    expect((await upload(bob, s.todoId, bytes(3))).status).toBe(404);
    expect((await bob.get(`/api/todos/${s.todoId}/attachments`)).status).toBe(404);
    expect((await bob.get(`/api/attachments/${meta.id}`)).status).toBe(404);
    expect((await bob.delete(`/api/attachments/${meta.id}`)).status).toBe(404);
  });

  it('in a public list others can list, download, add and remove', async () => {
    const meta = await (await upload(s.ann.device.http, s.todoId, bytes(3))).json();
    await s.ann.device.push([op('list', 'update', s.annInbox, { isPublic: true }, hlcAt(5))]);

    const bob = s.bob.device.http;
    const list = await bob.get(`/api/todos/${s.todoId}/attachments`);
    expect(list.status).toBe(200);
    expect((await list.json()).attachments).toHaveLength(1);
    expect((await bob.get(`/api/attachments/${meta.id}`)).status).toBe(200);
    // everyone can edit a public list, so they can add and remove files too
    const added = await upload(bob, s.todoId, bytes(3), 'bobs.txt');
    expect(added.status).toBe(201);
    expect((await bob.delete(`/api/attachments/${(await added.json()).id}`)).status).toBe(204);

    // back to private: gone again
    await s.ann.device.push([op('list', 'update', s.annInbox, { isPublic: false }, hlcAt(6))]);
    expect((await bob.get(`/api/attachments/${meta.id}`)).status).toBe(404);
    expect((await bob.get(`/api/todos/${s.todoId}/attachments`)).status).toBe(404);
  });

  it('a deleted task in a public list is hidden from others, but not from its owner', async () => {
    const meta = await (await upload(s.ann.device.http, s.todoId, bytes(3))).json();
    await s.ann.device.push([op('list', 'update', s.annInbox, { isPublic: true }, hlcAt(5))]);
    await s.ann.device.push([op('todo', 'delete', s.todoId, {}, hlcAt(6))]);
    expect((await s.bob.device.http.get(`/api/attachments/${meta.id}`)).status).toBe(404);
    expect((await s.ann.device.http.get(`/api/attachments/${meta.id}`)).status).toBe(200); // Undo keeps working
    expect((await upload(s.ann.device.http, s.todoId, bytes(3))).status).toBe(404); // but no new files
  });
});

describe('downloading safely (FR-52)', () => {
  it('is always an attachment, never inline, and cannot be sniffed', async () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    const meta = await (
      await upload(s.ann.device.http, s.todoId, html, 'evil.html', 'text/html')
    ).json();
    const res = await s.ann.device.http.get(`/api/attachments/${meta.id}`);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; /);
    expect(res.headers.get('content-disposition')).toContain('evil.html');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('content-length')).toBe(String(html.length));
  });

  it('encodes unusual file names in the header', async () => {
    const meta = await (
      await upload(s.ann.device.http, s.todoId, bytes(3), 'zażółć "gęślą".txt')
    ).json();
    const res = await s.ann.device.http.get(`/api/attachments/${meta.id}`);
    const header = res.headers.get('content-disposition')!;
    expect(header).toContain(
      "filename*=UTF-8''" +
        encodeURIComponent('zażółć "gęślą".txt').replace(
          /['()*]/g,
          (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
        ),
    );
    expect(header).not.toMatch(/[^\x20-\x7e]/); // header stays plain ASCII
    expect(header).not.toMatch(/filename="[^"]*"[^;]*"/); // no unescaped quote breaks the header
  });

  it('answers 404 for an unknown id or a missing file', async () => {
    expect((await s.ann.device.http.get(`/api/attachments/${newId()}`)).status).toBe(404);
    const meta = await (await upload(s.ann.device.http, s.todoId, bytes(3))).json();
    const { rmSync } = await import('node:fs');
    rmSync(join(s.dir, s.ann.me.id, meta.id));
    expect((await s.ann.device.http.get(`/api/attachments/${meta.id}`)).status).toBe(404);
  });
});

describe('removing', () => {
  it('the owner removes the file and its record', async () => {
    const meta = await (await upload(s.ann.device.http, s.todoId, bytes(3))).json();
    expect((await s.ann.device.http.delete(`/api/attachments/${meta.id}`)).status).toBe(204);
    expect(count(s)).toBe(0);
    expect(filesOnDisk(s)).toEqual([]);
    expect((await s.ann.device.http.delete(`/api/attachments/${meta.id}`)).status).toBe(404);
  });
});

describe('clean-up (FR-54)', () => {
  it('deleting a user removes their files and records, and nobody else’s', async () => {
    await upload(s.ann.device.http, s.todoId, bytes(3));
    const bobInbox = await s.bob.device.inboxId();
    const bobTodo = await s.createTodo(s.bob.device, bobInbox);
    await upload(s.bob.device.http, bobTodo, bytes(3));
    expect(existsSync(join(s.dir, s.ann.me.id))).toBe(true);

    // ann is the first user, so the admin; she deletes bob
    const res = await s.ann.device.http.delete(`/api/admin/users/${s.bob.me.id}`);
    expect(res.status).toBe(204);
    expect(existsSync(join(s.dir, s.bob.me.id))).toBe(false);
    expect(existsSync(join(s.dir, s.ann.me.id))).toBe(true);
    expect(count(s)).toBe(1);
  });

  it('deleting a task keeps its attachments so Undo works', async () => {
    const meta = await (await upload(s.ann.device.http, s.todoId, bytes(3))).json();
    await s.ann.device.push([op('todo', 'delete', s.todoId, {}, hlcAt(5))]);
    expect(count(s)).toBe(1);
    await s.ann.device.push([op('todo', 'restore', s.todoId, {}, hlcAt(6))]);
    const list = await (await s.ann.device.http.get(`/api/todos/${s.todoId}/attachments`)).json();
    expect(list.attachments[0].id).toBe(meta.id);
  });
});

function count(c: Ctx) {
  return (c.db.prepare('SELECT COUNT(*) n FROM attachments').get() as { n: number }).n;
}

/** Names of the files stored for all users (temporary `.part` files count too). */
function filesOnDisk(c: Ctx): string[] {
  if (!existsSync(c.dir)) return [];
  return readdirSync(c.dir).flatMap((u) => readdirSync(join(c.dir, u)));
}
