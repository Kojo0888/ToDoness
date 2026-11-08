import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, publicListResponseSchema, publicListsResponseSchema } from '@todoness/shared';
import { testApp } from './helpers/app';
import { TestClient } from './helpers/client';
import { hlcAt, op, registerDevice, type Device } from './helpers/sync';

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'todoness-files-'));
  const t = testApp({ ATTACHMENTS_DIR: dir });
  const ann = await registerDevice(t.app, 'ann@corp.test');
  const bob = await registerDevice(t.app, 'bob@corp.test');
  const cy = await registerDevice(t.app, 'cy@corp.test');

  let n = 10;
  const mkList = async (d: Device, name: string, extra: Record<string, unknown> = {}) => {
    const id = newId();
    await d.push([op('list', 'create', id, { name, orderKey: `a${n++}`, ...extra }, hlcAt(n))]);
    return id;
  };
  const mkTodo = async (d: Device, listId: string, title: string, extra = {}) => {
    const id = newId();
    await d.push([
      op('todo', 'create', id, { listId, title, orderKey: `a${n++}`, ...extra }, hlcAt(n)),
    ]);
    return id;
  };
  return { ...t, dir, ann, bob, cy, mkList, mkTodo };
}

const listsOf = async (c: TestClient) => {
  const res = await c.get('/api/public/lists');
  expect(res.status).toBe(200);
  return publicListsResponseSchema.parse(await res.json()).lists;
};

let s: Ctx;
beforeEach(async () => {
  s = await setup();
});

describe('GET /api/public/lists (FR-34)', () => {
  it('needs a login', async () => {
    expect((await new TestClient(s.app).get('/api/public/lists')).status).toBe(401);
    expect((await new TestClient(s.app).get(`/api/public/lists/${newId()}`)).status).toBe(401);
  });

  it('private lists never appear', async () => {
    await s.mkList(s.ann.device, 'Secret');
    expect(await listsOf(s.bob.device.http)).toEqual([]);
  });

  it('shows the public lists of other users, with the owner', async () => {
    const recipes = await s.mkList(s.ann.device, 'Recipes', { isPublic: true });
    const travel = await s.mkList(s.cy.device, 'Travel', { isPublic: true });
    await s.mkList(s.ann.device, 'Private');
    const lists = await listsOf(s.bob.device.http);
    expect(lists).toEqual([
      { id: recipes, name: 'Recipes', ownerEmail: 'ann@corp.test' },
      { id: travel, name: 'Travel', ownerEmail: 'cy@corp.test' },
    ]);
  });

  it('does not list the caller’s own lists (they are in the normal sidebar)', async () => {
    await s.mkList(s.ann.device, 'Recipes', { isPublic: true });
    expect(await listsOf(s.ann.device.http)).toEqual([]);
  });

  it('follows the owner’s order within one owner', async () => {
    const b = await s.mkList(s.ann.device, 'B', { isPublic: true });
    const a = await s.mkList(s.ann.device, 'A', { isPublic: true });
    await s.ann.device.push([op('list', 'update', a, { orderKey: 'a00' }, hlcAt(100))]);
    expect((await listsOf(s.bob.device.http)).map((l) => l.id)).toEqual([a, b]);
  });

  it('a list that becomes private or is deleted disappears (FR-36)', async () => {
    const id = await s.mkList(s.ann.device, 'Recipes', { isPublic: true });
    expect(await listsOf(s.bob.device.http)).toHaveLength(1);
    await s.ann.device.push([op('list', 'update', id, { isPublic: false }, hlcAt(200))]);
    expect(await listsOf(s.bob.device.http)).toHaveLength(0);
    await s.ann.device.push([op('list', 'update', id, { isPublic: true }, hlcAt(201))]);
    expect(await listsOf(s.bob.device.http)).toHaveLength(1);
    await s.ann.device.push([op('list', 'delete', id, {}, hlcAt(202))]);
    expect(await listsOf(s.bob.device.http)).toHaveLength(0);
  });
});

describe('GET /api/public/lists/:id (FR-33)', () => {
  const read = async (c: TestClient, id: string) => c.get(`/api/public/lists/${id}`);

  it('returns the list with its tasks in order, including done ones', async () => {
    const id = await s.mkList(s.ann.device, 'Recipes', { isPublic: true });
    const t1 = await s.mkTodo(s.ann.device, id, 'Soup', { notes: 'salt', dueAt: 5, priority: 2 });
    const t2 = await s.mkTodo(s.ann.device, id, 'Bread');
    await s.ann.device.push([
      op('todo', 'update', t2, { done: true, completedAt: 9 }, hlcAt(300)),
      op('todo', 'update', t1, { orderKey: 'a00' }, hlcAt(301)),
    ]);

    const res = await read(s.bob.device.http, id);
    expect(res.status).toBe(200);
    const body = publicListResponseSchema.parse(await res.json());
    expect(body.list).toEqual({ id, name: 'Recipes', ownerEmail: 'ann@corp.test' });
    expect(body.todos.map((t) => t.title)).toEqual(['Soup', 'Bread']);
    expect(body.todos[0]).toMatchObject({
      id: t1,
      notes: 'salt',
      done: false,
      dueAt: 5,
      priority: 2,
      completedAt: null,
      attachments: [],
    });
    expect(body.todos[1]).toMatchObject({ done: true, completedAt: 9 });
  });

  it('leaves out deleted tasks, and includes attachment details', async () => {
    const id = await s.mkList(s.ann.device, 'Recipes', { isPublic: true });
    const keep = await s.mkTodo(s.ann.device, id, 'Keep');
    const gone = await s.mkTodo(s.ann.device, id, 'Gone');
    await s.ann.device.push([op('todo', 'delete', gone, {}, hlcAt(300))]);
    await s.ann.device.http.upload(
      `/api/todos/${keep}/attachments?name=menu.pdf`,
      new Uint8Array(4),
      {
        'content-type': 'application/pdf',
      },
    );

    const body = publicListResponseSchema.parse(await (await read(s.bob.device.http, id)).json());
    expect(body.todos.map((t) => t.title)).toEqual(['Keep']);
    expect(body.todos[0]!.attachments).toMatchObject([
      { name: 'menu.pdf', size: 4, contentType: 'application/pdf' },
    ]);
  });

  it('is 404 for private, deleted, unknown and malformed ids', async () => {
    const priv = await s.mkList(s.ann.device, 'Private');
    const del = await s.mkList(s.ann.device, 'Del', { isPublic: true });
    await s.ann.device.push([op('list', 'delete', del, {}, hlcAt(300))]);
    for (const id of [priv, del, newId(), 'nope']) {
      expect((await read(s.bob.device.http, id)).status, id).toBe(404);
    }
  });

  it('the owner can read their own public list through the same page', async () => {
    const id = await s.mkList(s.ann.device, 'Recipes', { isPublic: true });
    expect((await read(s.ann.device.http, id)).status).toBe(200);
  });

  it('the owner’s private list is not readable by the owner here either', async () => {
    const id = await s.mkList(s.ann.device, 'Private');
    expect((await read(s.ann.device.http, id)).status).toBe(404);
  });
});

describe('public lists and sync', () => {
  it('the switch travels through the normal sync, so the owner’s other device sees it', async () => {
    const id = await s.mkList(s.ann.device, 'Recipes');
    await s.ann.device.push([op('list', 'update', id, { isPublic: true }, hlcAt(400))]);
    const changes = await s.ann.device.pullAll();
    expect(
      changes.some((c) => c.entityId === id && 'isPublic' in c.patch && c.patch.isPublic),
    ).toBe(true);
  });

  it('other users never receive someone else’s lists through sync', async () => {
    await s.mkList(s.ann.device, 'Recipes', { isPublic: true });
    const bobChanges = await s.bob.device.pullAll();
    expect(bobChanges.every((c) => c.entity !== 'list' || 'isInbox' in c.patch)).toBe(true);
    expect(bobChanges.some((c) => 'name' in c.patch && c.patch.name === 'Recipes')).toBe(false);
  });
});
