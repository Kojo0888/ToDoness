import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, publicListResponseSchema } from '@todoness/shared';
import { testApp } from './helpers/app';
import { TestClient } from './helpers/client';
import { Device, hlcAt, op, registerDevice } from './helpers/sync';

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'todoness-files-'));
  const t = testApp({ ATTACHMENTS_DIR: dir });
  const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
  const bob = await registerDevice(t.app, 'bob@corp.test', 'bbbb');
  const cy = await registerDevice(t.app, 'cy@corp.test', 'cccc');

  const listId = newId();
  await ann.device.push([
    op(
      'list',
      'create',
      listId,
      { name: 'Shared', orderKey: 'a5', isPublic: true },
      hlcAt(1, 'aaaa'),
    ),
  ]);
  const todoId = newId();
  await ann.device.push([
    op('todo', 'create', todoId, { listId, title: 'Original', orderKey: 'a0' }, hlcAt(2, 'aaaa')),
  ]);
  const privateList = newId();
  await ann.device.push([
    op('list', 'create', privateList, { name: 'Mine', orderKey: 'a6' }, hlcAt(3, 'aaaa')),
  ]);
  const privateTodo = newId();
  await ann.device.push([
    op(
      'todo',
      'create',
      privateTodo,
      { listId: privateList, title: 'Secret', orderKey: 'a0' },
      hlcAt(4, 'aaaa'),
    ),
  ]);
  return { ...t, dir, ann, bob, cy, listId, todoId, privateList, privateTodo };
}

const todoRow = (c: Ctx, id: string) =>
  c.db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Record<string, unknown> | undefined;

/** Pushes as `d` into the public list. */
const editPush = (c: Ctx, d: Device, ops: unknown[], listId = c.listId, clientId = 'bbbb') =>
  d.http.post(`/api/public/lists/${listId}/push`, { clientId, ops });

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('POST /api/public/lists/:id/push (FR-33)', () => {
  it('needs a login', async () => {
    const res = await new TestClient(c.app).post(`/api/public/lists/${c.listId}/push`, {
      clientId: 'bbbb',
      ops: [op('todo', 'update', c.todoId, { title: 'x' }, hlcAt(10))],
    });
    expect(res.status).toBe(401);
  });

  it('another user can add a task; it belongs to the owner', async () => {
    const id = newId();
    const o = op(
      'todo',
      'create',
      id,
      { listId: c.listId, title: 'From Bob', orderKey: 'a1' },
      hlcAt(10, 'bbbb'),
    );
    const res = await editPush(c, c.bob.device, [o]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: [o.opId], rejected: [] });
    expect(todoRow(c, id)).toMatchObject({
      user_id: c.ann.me.id,
      list_id: c.listId,
      title: 'From Bob',
    });
  });

  it('another user can change, complete, delete and restore tasks', async () => {
    const id = c.todoId;
    await editPush(c, c.bob.device, [
      op(
        'todo',
        'update',
        id,
        { title: 'Renamed', notes: 'n', dueAt: 5, priority: 2 },
        hlcAt(10, 'bbbb'),
      ),
      op('todo', 'update', id, { done: true, completedAt: 9 }, hlcAt(11, 'bbbb')),
    ]);
    expect(todoRow(c, id)).toMatchObject({
      title: 'Renamed',
      notes: 'n',
      due_at: 5,
      priority: 2,
      done: 1,
    });
    await editPush(c, c.bob.device, [op('todo', 'delete', id, {}, hlcAt(12, 'bbbb'))]);
    expect(todoRow(c, id)!.deleted_at).not.toBeNull();
    await editPush(c, c.bob.device, [op('todo', 'restore', id, {}, hlcAt(13, 'bbbb'))]);
    expect(todoRow(c, id)!.deleted_at).toBeNull();
  });

  it('the owner receives the change through the normal pull', async () => {
    const before = (await c.ann.device.pull(0, 1000)).nextSeq;
    await editPush(c, c.bob.device, [
      op('todo', 'update', c.todoId, { title: 'By Bob' }, hlcAt(10, 'bbbb')),
    ]);
    const after = await c.ann.device.pull(before);
    expect(after.changes).toHaveLength(1);
    expect(after.changes[0]).toMatchObject({
      entity: 'todo',
      entityId: c.todoId,
      type: 'update',
      patch: { title: 'By Bob' },
    });
    // ...and not Bob's own feed
    expect((await c.bob.device.pullAll()).some((ch) => ch.entityId === c.todoId)).toBe(false);
  });

  it('merges with the owner’s edits per field, last write wins', async () => {
    await c.ann.device.push([
      op('todo', 'update', c.todoId, { title: 'Ann title', notes: 'Ann notes' }, hlcAt(20, 'aaaa')),
    ]);
    await editPush(c, c.bob.device, [
      op('todo', 'update', c.todoId, { title: 'Bob older title' }, hlcAt(15, 'bbbb')), // older: ignored
      op('todo', 'update', c.todoId, { priority: 3 }, hlcAt(16, 'bbbb')), // different field: kept
    ]);
    expect(todoRow(c, c.todoId)).toMatchObject({
      title: 'Ann title',
      notes: 'Ann notes',
      priority: 3,
    });
  });

  it('is safe to repeat', async () => {
    const o = op(
      'todo',
      'create',
      newId(),
      { listId: c.listId, title: 'Once', orderKey: 'a1' },
      hlcAt(10, 'bbbb'),
    );
    await editPush(c, c.bob.device, [o]);
    const again = await editPush(c, c.bob.device, [o]);
    expect((await again.json()).accepted).toEqual([o.opId]);
    const n = (
      c.db.prepare("SELECT COUNT(*) n FROM todos WHERE title = 'Once'").get() as { n: number }
    ).n;
    expect(n).toBe(1);
    const logs = (
      c.db.prepare('SELECT COUNT(*) n FROM change_log WHERE entity_id = ?').get(o.entityId) as {
        n: number;
      }
    ).n;
    expect(logs).toBe(1);
  });

  it('the same op id from two users does not clash', async () => {
    const shared = newId();
    const mk = (title: string, hlc: string) => ({
      ...op('todo', 'create', newId(), { listId: c.listId, title, orderKey: 'a1' }, hlc),
      opId: shared,
    });
    await editPush(c, c.bob.device, [mk('From Bob', hlcAt(10, 'bbbb'))]);
    const res = await editPush(
      c,
      c.cy.device,
      [mk('From Cy', hlcAt(11, 'cccc'))],
      c.listId,
      'cccc',
    );
    expect((await res.json()).accepted).toEqual([shared]);
    expect(todoRow(c, 'x')).toBeUndefined();
    const titles = (
      c.db.prepare('SELECT title FROM todos WHERE list_id = ? ORDER BY title').all(c.listId) as {
        title: string;
      }[]
    ).map((r) => r.title);
    expect(titles).toEqual(['From Bob', 'From Cy', 'Original']);
  });

  it('the owner can use it too', async () => {
    const res = await editPush(
      c,
      c.ann.device,
      [op('todo', 'update', c.todoId, { title: 'Ann via public' }, hlcAt(10, 'aaaa'))],
      c.listId,
      'aaaa',
    );
    expect(res.status).toBe(200);
    expect(todoRow(c, c.todoId)!.title).toBe('Ann via public');
  });
});

describe('what others may not do', () => {
  it('private, deleted and unknown lists are 404', async () => {
    const o = op(
      'todo',
      'create',
      newId(),
      { listId: c.privateList, title: 'x', orderKey: 'a1' },
      hlcAt(10),
    );
    expect((await editPush(c, c.bob.device, [o], c.privateList)).status).toBe(404);
    expect((await editPush(c, c.bob.device, [o], newId())).status).toBe(404);
    expect((await editPush(c, c.bob.device, [o], 'nope')).status).toBe(404);
    await c.ann.device.push([op('list', 'delete', c.listId, {}, hlcAt(30, 'aaaa'))]);
    expect((await editPush(c, c.bob.device, [o])).status).toBe(404);
  });

  it('stops working when the list becomes private', async () => {
    await c.ann.device.push([
      op('list', 'update', c.listId, { isPublic: false }, hlcAt(30, 'aaaa')),
    ]);
    const res = await editPush(c, c.bob.device, [
      op('todo', 'update', c.todoId, { title: 'x' }, hlcAt(31, 'bbbb')),
    ]);
    expect(res.status).toBe(404);
    expect(todoRow(c, c.todoId)!.title).toBe('Original');
  });

  it('rejects list operations', async () => {
    const ops = [
      op('list', 'update', c.listId, { name: 'Hacked' }, hlcAt(10, 'bbbb')),
      op('list', 'update', c.listId, { isPublic: false }, hlcAt(11, 'bbbb')),
      op('list', 'delete', c.listId, {}, hlcAt(12, 'bbbb')),
      op('list', 'create', newId(), { name: 'Mine now', orderKey: 'a9' }, hlcAt(13, 'bbbb')),
    ];
    const body = await (await editPush(c, c.bob.device, ops)).json();
    expect(body.accepted).toEqual([]);
    expect(body.rejected.map((r: { opId: string }) => r.opId)).toEqual(ops.map((o) => o.opId));
    expect(c.db.prepare('SELECT name, is_public FROM lists WHERE id = ?').get(c.listId)).toEqual({
      name: 'Shared',
      is_public: 1,
    });
  });

  it('cannot create a task in, or move a task to, another list', async () => {
    const create = op(
      'todo',
      'create',
      newId(),
      { listId: c.privateList, title: 'Sneaky', orderKey: 'a1' },
      hlcAt(10, 'bbbb'),
    );
    const move = op('todo', 'update', c.todoId, { listId: c.privateList }, hlcAt(11, 'bbbb'));
    const bobList = await c.bob.device.inboxId();
    const intoBob = op('todo', 'update', c.todoId, { listId: bobList }, hlcAt(12, 'bbbb'));
    const body = await (await editPush(c, c.bob.device, [create, move, intoBob])).json();
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toHaveLength(3);
    expect(todoRow(c, c.todoId)!.list_id).toBe(c.listId);
    expect(todoRow(c, create.entityId)).toBeUndefined();
  });

  it('cannot touch tasks of the owner’s private lists, or of other users', async () => {
    const bobTodo = newId();
    await c.bob.device.push([
      op(
        'todo',
        'create',
        bobTodo,
        { listId: await c.bob.device.inboxId(), title: 'Bobs', orderKey: 'a0' },
        hlcAt(5, 'bbbb'),
      ),
    ]);
    const ops = [
      op('todo', 'update', c.privateTodo, { title: 'Pwned' }, hlcAt(10, 'cccc')),
      op('todo', 'delete', c.privateTodo, {}, hlcAt(11, 'cccc')),
      op('todo', 'update', bobTodo, { title: 'Pwned' }, hlcAt(12, 'cccc')),
      // re-creating an existing id that lives elsewhere must not hijack it
      op(
        'todo',
        'create',
        c.privateTodo,
        { listId: c.listId, title: 'Hijack', orderKey: 'a1' },
        hlcAt(13, 'cccc'),
      ),
    ];
    const body = await (await editPush(c, c.cy.device, ops, c.listId, 'cccc')).json();
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toHaveLength(4);
    expect(todoRow(c, c.privateTodo)).toMatchObject({
      title: 'Secret',
      list_id: c.privateList,
      deleted_at: null,
    });
    expect(todoRow(c, bobTodo)!.title).toBe('Bobs');
  });

  it('rejects invalid operations one by one and keeps the valid ones', async () => {
    const good = op('todo', 'update', c.todoId, { title: 'Fine' }, hlcAt(10, 'bbbb'));
    const bad = op('todo', 'update', c.todoId, { id: 'x' }, hlcAt(11, 'bbbb'));
    const missing = op('todo', 'update', newId(), { title: 'x' }, hlcAt(12, 'bbbb'));
    const body = await (await editPush(c, c.bob.device, [good, bad, missing])).json();
    expect(body.accepted).toEqual([good.opId]);
    expect(body.rejected.map((r: { opId: string }) => r.opId)).toEqual([bad.opId, missing.opId]);
  });

  it('rejects a malformed body with 400', async () => {
    for (const body of [{}, { clientId: 'x', ops: [] }, { clientId: 'bbbb', ops: [{ nope: 1 }] }]) {
      const res = await c.bob.device.http.post(`/api/public/lists/${c.listId}/push`, body);
      expect(res.status).toBe(400);
    }
  });
});

describe('what the visitor sees', () => {
  it('the public page shows the edit and the order keys', async () => {
    await editPush(c, c.bob.device, [
      op(
        'todo',
        'create',
        newId(),
        { listId: c.listId, title: 'New on top', orderKey: 'Zz' },
        hlcAt(10, 'bbbb'),
      ),
    ]);
    const page = publicListResponseSchema.parse(
      await (await c.bob.device.http.get(`/api/public/lists/${c.listId}`)).json(),
    );
    expect(page.todos.map((t) => [t.title, t.orderKey])).toEqual([
      ['New on top', 'Zz'],
      ['Original', 'a0'],
    ]);
  });
});

describe('attachments in a public list (FR-53)', () => {
  const up = (d: Device, todoId: string, name = 'f.txt') =>
    d.http.upload(`/api/todos/${todoId}/attachments?name=${name}`, new Uint8Array(4).fill(1), {
      'content-type': 'text/plain',
    });

  it('others can add and remove files on tasks of a public list', async () => {
    const res = await up(c.bob.device, c.todoId);
    expect(res.status).toBe(201);
    const meta = await res.json();
    // the owner sees and can download it
    const list = await c.ann.device.http.get(`/api/todos/${c.todoId}/attachments`);
    expect((await list.json()).attachments).toHaveLength(1);
    expect((await c.ann.device.http.get(`/api/attachments/${meta.id}`)).status).toBe(200);
    // another visitor can remove it
    expect((await c.cy.device.http.delete(`/api/attachments/${meta.id}`)).status).toBe(204);
  });

  it('tasks of private lists stay closed', async () => {
    expect((await up(c.bob.device, c.privateTodo)).status).toBe(404);
  });

  it('a deleted task takes no new files from others', async () => {
    await c.ann.device.push([op('todo', 'delete', c.todoId, {}, hlcAt(30, 'aaaa'))]);
    expect((await up(c.bob.device, c.todoId)).status).toBe(404);
  });
});
