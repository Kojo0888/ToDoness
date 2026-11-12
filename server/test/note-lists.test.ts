/** Note lists through the sync API (docs/note-lists/PRD.md FR-124 – FR-131). */
import { beforeEach, describe, expect, it } from 'vitest';
import { formatHlc, newId, pullResponseSchema } from '@todoness/shared';
import { testApp } from './helpers/app';
import { Device, hlcAt, loginDevice, op, registerDevice } from './helpers/sync';

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const t = testApp();
  const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
  return { ...t, ann };
}

const listRow = (c: Ctx, id: string) =>
  c.db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as Record<string, unknown> | undefined;
const noteRow = (c: Ctx, id: string) =>
  c.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Record<string, unknown> | undefined;

async function notesDefault(d: Device) {
  const changes = await d.pullAll();
  const ch = changes.find(
    (x) => x.entity === 'list' && x.type === 'create' && x.patch.module === 'notes',
  );
  return ch;
}

/** A pull like an app from before note lists (no `lists=modules`). */
async function legacyPull(d: Device) {
  const res = await d.http.get('/api/sync/pull?since=0&limit=1000&reminders=list');
  return pullResponseSchema.parse(await res.json()).changes;
}

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('My notes (FR-124, FR-129)', () => {
  it('is created at sign-up as the default note list', async () => {
    const ch = await notesDefault(c.ann.device);
    expect(ch?.patch).toMatchObject({ name: 'My notes', isInbox: true, module: 'notes' });
    const rows = c.db
      .prepare("SELECT COUNT(*) n FROM lists WHERE module = 'notes' AND is_inbox = 1")
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('is created at the first pull of an account that has none, and only once', async () => {
    c.db.prepare('DELETE FROM change_log WHERE patch LIKE \'%"module":"notes"%\'').run();
    c.db.prepare("DELETE FROM lists WHERE module = 'notes'").run();
    await c.ann.device.pullAll();
    await c.ann.device.pullAll();
    const n = c.db.prepare("SELECT COUNT(*) n FROM lists WHERE module = 'notes'").get() as {
      n: number;
    };
    expect(n.n).toBe(1);
    expect(await notesDefault(c.ann.device)).toBeDefined();
  });

  it('may be renamed but not deleted', async () => {
    const id = (await notesDefault(c.ann.device))!.entityId;
    // Later than the server's clock when it created the list.
    const later = (n: number) =>
      formatHlc({ wall: Date.now() + 60_000 + n, counter: 0, clientId: 'aaaa' });
    const r = await c.ann.device.push([
      op('list', 'update', id, { name: 'Personal' }, later(0)),
      op('list', 'delete', id, {}, later(1)),
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['inbox_protected']);
    expect(listRow(c, id)).toMatchObject({ name: 'Personal', deleted_at: null });
  });

  it('still protects the name of the task Inbox', async () => {
    const inbox = await c.ann.device.inboxId();
    const r = await c.ann.device.push([op('list', 'update', inbox, { name: 'X' }, hlcAt(10))]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['inbox_protected']);
  });
});

describe('note lists (FR-125 – FR-131)', () => {
  it('stores a note list and a note in it, and sends both to another device', async () => {
    const listId = newId();
    const noteId = newId();
    const r = await c.ann.device.push([
      op('list', 'create', listId, { name: 'Work', orderKey: 'b0', module: 'notes' }, hlcAt(1)),
      op('note', 'create', noteId, { orderKey: 'a0', text: 'Hi', listId }, hlcAt(2)),
    ]);
    expect(r.rejected).toEqual([]);
    expect(listRow(c, listId)).toMatchObject({ module: 'notes', name: 'Work' });
    expect(noteRow(c, noteId)).toMatchObject({ list_id: listId });

    const phone = await loginDevice(c.app, 'ann@corp.test', 'cccc');
    const all = await phone.pullAll();
    expect(all.find((x) => x.entityId === listId)?.patch).toMatchObject({ module: 'notes' });
    expect(all.find((x) => x.entityId === noteId)?.patch).toMatchObject({ listId });
  });

  it('keeps task lists as the default module', async () => {
    const listId = newId();
    await c.ann.device.push([
      op('list', 'create', listId, { name: 'L', orderKey: 'b0' }, hlcAt(1)),
    ]);
    expect(listRow(c, listId)).toMatchObject({ module: 'tasks' });
  });

  it('never changes the module of a list', async () => {
    const listId = newId();
    await c.ann.device.push([
      op('list', 'create', listId, { name: 'L', orderKey: 'b0' }, hlcAt(1)),
    ]);
    const r = await c.ann.device.push([
      op('list', 'create', listId, { name: 'L', orderKey: 'b0', module: 'notes' }, hlcAt(2)),
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['invalid_operation']);
    expect(listRow(c, listId)).toMatchObject({ module: 'tasks' });
  });

  it('refuses a task in a note list and a note in a task list', async () => {
    const notesList = newId();
    await c.ann.device.push([
      op('list', 'create', notesList, { name: 'N', orderKey: 'b0', module: 'notes' }, hlcAt(1)),
    ]);
    const inbox = await c.ann.device.inboxId();
    const r = await c.ann.device.push([
      op('todo', 'create', newId(), { listId: notesList, title: 'T', orderKey: 'a0' }, hlcAt(2)),
      op('note', 'create', newId(), { orderKey: 'a0', text: 'x', listId: inbox }, hlcAt(3)),
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['list_not_found', 'list_not_found']);
  });

  it('refuses a note in a note list of another user', async () => {
    const bob = await registerDevice(c.app, 'bob@corp.test', 'bbbb');
    const bobList = newId();
    await bob.device.push([
      op('list', 'create', bobList, { name: 'B', orderKey: 'b0', module: 'notes' }, hlcAt(1)),
    ]);
    const r = await c.ann.device.push([
      op('note', 'create', newId(), { orderKey: 'a0', text: 'x', listId: bobList }, hlcAt(2)),
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['list_not_found']);
  });

  it('does not offer a note list as a public task list', async () => {
    const bob = await registerDevice(c.app, 'bob@corp.test', 'bbbb');
    const listId = newId();
    await c.ann.device.push([
      op(
        'list',
        'create',
        listId,
        { name: 'N', orderKey: 'b0', module: 'notes', isPublic: true },
        hlcAt(1),
      ),
    ]);
    const res = await bob.device.http.get('/api/public/lists');
    const body = (await res.json()) as { lists: { id: string }[] };
    expect(body.lists.map((l) => l.id)).not.toContain(listId);
  });
});

describe('older apps (L4)', () => {
  it('get no note lists and no listId of notes', async () => {
    const listId = newId();
    const noteId = newId();
    await c.ann.device.push([
      op('list', 'create', listId, { name: 'Work', orderKey: 'b0', module: 'notes' }, hlcAt(1)),
      op('note', 'create', noteId, { orderKey: 'a0', text: 'Hi', listId }, hlcAt(2)),
      op('list', 'update', listId, { name: 'Work 2' }, hlcAt(3)),
    ]);
    const changes = await legacyPull(c.ann.device);
    const lists = changes.filter((x) => x.entity === 'list');
    expect(lists.every((x) => !('module' in x.patch))).toBe(true);
    expect(lists.map((x) => x.entityId)).not.toContain(listId);
    expect(lists).toHaveLength(1); // the task Inbox only
    const note = changes.find((x) => x.entityId === noteId)!;
    expect(note.patch).not.toHaveProperty('listId');
    expect(note.patch).toMatchObject({ text: 'Hi' });
  });
});
