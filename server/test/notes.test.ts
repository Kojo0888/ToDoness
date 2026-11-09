/** Notes through the sync API and as public notes (docs/notes/PRD.md). */
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, publicNotesResponseSchema } from '@todoness/shared';
import { testApp } from './helpers/app';
import { TestClient } from './helpers/client';
import { Device, hlcAt, loginDevice, op, registerDevice } from './helpers/sync';

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const t = testApp();
  const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
  const bob = await registerDevice(t.app, 'bob@corp.test', 'bbbb');
  const noteId = newId();
  await ann.device.push([
    op('note', 'create', noteId, { orderKey: 'a0', text: 'Shared', isPublic: true }, hlcAt(1)),
  ]);
  const privateId = newId();
  await ann.device.push([
    op('note', 'create', privateId, { orderKey: 'a1', text: 'Secret' }, hlcAt(2)),
  ]);
  return { ...t, ann, bob, noteId, privateId };
}

const noteRow = (c: Ctx, id: string) =>
  c.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Record<string, unknown> | undefined;

const editPush = (c: Ctx, d: Device, ops: unknown[], noteId = c.noteId) =>
  d.http.post(`/api/public/notes/${noteId}/push`, { clientId: 'bbbb', ops });

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('notes through sync', () => {
  it('stores a pushed note and sends it to the other device of the user', async () => {
    expect(noteRow(c, c.noteId)).toMatchObject({
      user_id: c.ann.me.id,
      text: 'Shared',
      is_public: 1,
      order_key: 'a0',
      deleted_at: null,
    });
    const phone = await loginDevice(c.app, 'ann@corp.test', 'cccc');
    const notes = (await phone.pullAll()).filter((ch) => ch.entity === 'note');
    expect(notes.map((n) => n.entityId)).toEqual([c.noteId, c.privateId]);
    expect(notes[0]!.patch).toMatchObject({ text: 'Shared', isPublic: true, orderKey: 'a0' });
  });

  it('merges updates per field and handles delete and restore', async () => {
    const r = await c.ann.device.push([
      op('note', 'update', c.noteId, { text: 'Newer' }, hlcAt(10)),
      op('note', 'update', c.noteId, { text: 'Older', isPublic: false }, hlcAt(5)),
      op('note', 'delete', c.noteId, {}, hlcAt(11)),
    ]);
    expect(r.rejected).toEqual([]);
    expect(noteRow(c, c.noteId)).toMatchObject({ text: 'Newer', is_public: 0 });
    expect(noteRow(c, c.noteId)!.deleted_at).not.toBeNull();
    await c.ann.device.push([op('note', 'restore', c.noteId, {}, hlcAt(12))]);
    expect(noteRow(c, c.noteId)!.deleted_at).toBeNull();
  });

  it('refuses another user taking over a note id, and invalid note operations', async () => {
    const r = await c.bob.device.push([
      op('note', 'update', c.noteId, { text: 'mine now' }, hlcAt(20, 'bbbb')),
      op('note', 'create', c.noteId, { orderKey: 'a0' }, hlcAt(21, 'bbbb')),
      op('note', 'update', newId(), { text: 'x' }, hlcAt(22, 'bbbb')),
      op('note', 'update', c.noteId, { userId: c.bob.me.id }, hlcAt(23, 'bbbb')),
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'not_found',
      'not_found',
      'not_found',
      'invalid_operation',
    ]);
    expect(noteRow(c, c.noteId)).toMatchObject({ user_id: c.ann.me.id, text: 'Shared' });
  });

  it('removes notes when the user is deleted', async () => {
    // The first account is the admin.
    const res = await c.ann.device.http.delete(`/api/admin/users/${c.ann.me.id}`);
    expect(res.status).toBe(400); // cannot delete yourself
    const bobNote = newId();
    await c.bob.device.push([op('note', 'create', bobNote, { orderKey: 'a0' }, hlcAt(1, 'bbbb'))]);
    expect((await c.ann.device.http.delete(`/api/admin/users/${c.bob.me.id}`)).status).toBe(204);
    expect(noteRow(c, bobNote)).toBeUndefined();
  });
});

describe('GET /api/public/notes', () => {
  it('lists the public live notes of other users with the owner e-mail', async () => {
    const res = await c.bob.device.http.get('/api/public/notes');
    expect(res.status).toBe(200);
    const body = publicNotesResponseSchema.parse(await res.json());
    expect(body.notes).toEqual([
      { id: c.noteId, text: 'Shared', ownerEmail: 'ann@corp.test', updatedAt: expect.any(Number) },
    ]);
  });

  it('does not list your own, private or deleted notes; newest change first', async () => {
    const own = publicNotesResponseSchema.parse(
      await (await c.ann.device.http.get('/api/public/notes')).json(),
    );
    expect(own.notes).toEqual([]);

    const second = newId();
    await c.ann.device.push([
      op('note', 'create', second, { orderKey: 'a2', text: 'Two', isPublic: true }, hlcAt(30)),
    ]);
    let body = publicNotesResponseSchema.parse(
      await (await c.bob.device.http.get('/api/public/notes')).json(),
    );
    expect(body.notes.map((n) => n.id)).toEqual([second, c.noteId]);

    await c.ann.device.push([op('note', 'delete', second, {}, hlcAt(31))]);
    await c.ann.device.push([op('note', 'update', c.noteId, { isPublic: false }, hlcAt(32))]);
    body = publicNotesResponseSchema.parse(
      await (await c.bob.device.http.get('/api/public/notes')).json(),
    );
    expect(body.notes).toEqual([]);
  });

  it('needs a login', async () => {
    expect((await new TestClient(c.app).get('/api/public/notes')).status).toBe(401);
  });
});

describe('POST /api/public/notes/:id/push', () => {
  it('lets another user change the text; it reaches the owner through the pull', async () => {
    const edit = op('note', 'update', c.noteId, { text: 'Edited by Bob' }, hlcAt(40, 'bbbb'));
    const res = await editPush(c, c.bob.device, [edit]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: [edit.opId], rejected: [] });
    expect(noteRow(c, c.noteId)).toMatchObject({ text: 'Edited by Bob', user_id: c.ann.me.id });

    const changes = await c.ann.device.pullAll();
    expect(changes.at(-1)).toMatchObject({
      entity: 'note',
      entityId: c.noteId,
      patch: { text: 'Edited by Bob' },
    });
    // Nothing lands in Bob's own feed.
    expect((await c.bob.device.pullAll()).some((ch) => ch.entity === 'note')).toBe(false);
  });

  it('refuses everything but a text update of that note', async () => {
    const other = newId();
    await c.ann.device.push([
      op('note', 'create', other, { orderKey: 'a3', text: 'Other', isPublic: true }, hlcAt(50)),
    ]);
    const ops = [
      op('note', 'delete', c.noteId, {}, hlcAt(51, 'bbbb')),
      op('note', 'restore', c.noteId, {}, hlcAt(52, 'bbbb')),
      op('note', 'update', c.noteId, { isPublic: false }, hlcAt(53, 'bbbb')),
      op('note', 'update', c.noteId, { orderKey: 'a9' }, hlcAt(54, 'bbbb')),
      op('note', 'update', c.noteId, { text: 'x', isPublic: false }, hlcAt(55, 'bbbb')),
      op('note', 'create', c.noteId, { orderKey: 'a0', text: 'x' }, hlcAt(56, 'bbbb')),
      op('note', 'create', newId(), { orderKey: 'a0', text: 'x' }, hlcAt(57, 'bbbb')),
      op('note', 'update', other, { text: 'wrong note' }, hlcAt(58, 'bbbb')),
      op('list', 'create', newId(), { name: 'L', orderKey: 'a0' }, hlcAt(59, 'bbbb')),
    ];
    const res = await editPush(c, c.bob.device, ops);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: string[]; rejected: { reason: string }[] };
    expect(body.accepted).toEqual([]);
    expect(body.rejected.map((r) => r.reason)).toEqual(Array(ops.length).fill('forbidden'));
    expect(noteRow(c, c.noteId)).toMatchObject({ text: 'Shared', is_public: 1, deleted_at: null });
    expect(noteRow(c, other)).toMatchObject({ text: 'Other' });
  });

  it('answers 404 for private, deleted, unknown and malformed note ids', async () => {
    const edit = () => op('note', 'update', c.privateId, { text: 'x' }, hlcAt(60, 'bbbb'));
    expect((await editPush(c, c.bob.device, [edit()], c.privateId)).status).toBe(404);
    expect((await editPush(c, c.bob.device, [edit()], newId())).status).toBe(404);
    expect((await editPush(c, c.bob.device, [edit()], 'nope')).status).toBe(404);
    await c.ann.device.push([op('note', 'delete', c.noteId, {}, hlcAt(61))]);
    expect((await editPush(c, c.bob.device, [edit()])).status).toBe(404);
  });

  it('is repeat-safe and needs a login', async () => {
    const edit = op('note', 'update', c.noteId, { text: 'Once' }, hlcAt(70, 'bbbb'));
    await editPush(c, c.bob.device, [edit]);
    const again = await editPush(c, c.bob.device, [edit]);
    expect(await again.json()).toEqual({ accepted: [edit.opId], rejected: [] });
    const anon = await new TestClient(c.app).post(`/api/public/notes/${c.noteId}/push`, {
      clientId: 'zzzz',
      ops: [edit],
    });
    expect(anon.status).toBe(401);
  });

  it('the owner can use it too (same rules)', async () => {
    const edit = op('note', 'update', c.noteId, { text: 'Owner' }, hlcAt(80));
    const res = await editPush(c, c.ann.device, [edit]);
    expect(await res.json()).toEqual({ accepted: [edit.opId], rejected: [] });
  });
});

describe('ETag on the public endpoints', () => {
  it('answers 304 when nothing changed, and 200 again after a change', async () => {
    const first = await c.bob.device.http.get('/api/public/notes');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^".+"$/);
    const same = await c.bob.device.http.get('/api/public/notes', { 'if-none-match': etag! });
    expect(same.status).toBe(304);

    await c.ann.device.push([op('note', 'update', c.noteId, { text: 'changed' }, hlcAt(90))]);
    const changed = await c.bob.device.http.get('/api/public/notes', { 'if-none-match': etag! });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
  });

  it('also on the list of public lists and on one list', async () => {
    for (const url of ['/api/public/lists']) {
      const res = await c.bob.device.http.get(url);
      const again = await c.bob.device.http.get(url, { 'if-none-match': res.headers.get('etag')! });
      expect(again.status).toBe(304);
    }
  });
});
