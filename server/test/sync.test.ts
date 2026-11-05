import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { testApp } from './helpers/app';
import { TestClient } from './helpers/client';
import { Device, hlcAt, loginDevice, op, registerDevice, T0 } from './helpers/sync';

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const t = testApp();
  const { device: ann, me } = await registerDevice(t.app, 'ann@corp.test');
  const inbox = await ann.inboxId();
  return { ...t, ann, me, inbox };
}

const todoCreate = (id: string, listId: string, title: string, hlc: string, extra = {}) =>
  op('todo', 'create', id, { listId, title, orderKey: 'a0', ...extra }, hlc);

const row = (c: Ctx, table: string, id: string) =>
  c.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;

const logCount = (c: Ctx) =>
  (c.db.prepare('SELECT COUNT(*) n FROM change_log').get() as { n: number }).n;

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('authentication and request checks', () => {
  it('requires a session for push and pull', async () => {
    const anon = new Device(new TestClient(c.app));
    expect((await anon.rawPush({ clientId: 'aaaa', ops: [] })).status).toBe(401);
    expect((await anon.http.get('/api/sync/pull')).status).toBe(401);
  });

  it('rejects a malformed push body with 400', async () => {
    const bad = [
      {},
      { clientId: 'no-dash', ops: [{ opId: newId() }] },
      { clientId: 'aaaa', ops: [] },
      { clientId: 'aaaa', ops: [{ nope: 1 }] },
      { clientId: 'aaaa', ops: Array.from({ length: 501 }, () => ({ opId: newId() })) },
    ];
    for (const body of bad) {
      expect((await c.ann.rawPush(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it('rejects a body that is too large with 413', async () => {
    const big = { clientId: 'aaaa', ops: [{ opId: newId(), pad: 'x'.repeat(2_000_000) }] };
    expect((await c.ann.rawPush(big)).status).toBe(413);
  });

  it('rejects bad pull parameters with 400', async () => {
    for (const q of ['since=-1', 'since=abc', 'since=1.5', 'limit=0', 'limit=abc']) {
      expect((await c.ann.http.get(`/api/sync/pull?${q}`)).status, q).toBe(400);
    }
  });
});

describe('push: creating and storing', () => {
  it('stores a list and a todo and reports them accepted', async () => {
    const listId = newId();
    const todoId = newId();
    const ops = [
      op('list', 'create', listId, { name: 'Work', orderKey: 'a1' }, hlcAt(1)),
      todoCreate(todoId, listId, 'Buy milk', hlcAt(2), {
        notes: 'oat',
        dueAt: 1_730_900_000_000,
        priority: 2,
      }),
    ];
    const res = await c.ann.push(ops);
    expect(res.accepted).toEqual(ops.map((o) => o.opId));
    expect(res.rejected).toEqual([]);

    expect(row(c, 'lists', listId)).toMatchObject({
      user_id: c.me.id,
      name: 'Work',
      is_inbox: 0,
      order_key: 'a1',
      deleted_at: null,
    });
    expect(row(c, 'todos', todoId)).toMatchObject({
      user_id: c.me.id,
      list_id: listId,
      title: 'Buy milk',
      notes: 'oat',
      done: 0,
      completed_at: null,
      due_at: 1_730_900_000_000,
      priority: 2,
      order_key: 'a0',
      created_at: 1_730_822_400_002,
      updated_at: 1_730_822_400_002,
      deleted_at: null,
    });
    const hlcs = JSON.parse(row(c, 'todos', todoId)!.field_hlc as string);
    expect(hlcs.title).toBe(hlcAt(2));
  });

  it('applies operations in order within a batch', async () => {
    const t = newId();
    const res = await c.ann.push([
      todoCreate(t, c.inbox, 'First', hlcAt(1)),
      op('todo', 'update', t, { title: 'Second' }, hlcAt(2)),
      op('todo', 'update', t, { done: true, completedAt: T0 + 3 }, hlcAt(3)),
    ]);
    expect(res.rejected).toEqual([]);
    expect(row(c, 'todos', t)).toMatchObject({ title: 'Second', done: 1, completed_at: T0 + 3 });
  });

  it('trims the title through the schema', async () => {
    const t = newId();
    await c.ann.push([todoCreate(t, c.inbox, '  padded  ', hlcAt(1))]);
    expect(row(c, 'todos', t)!.title).toBe('padded');
  });

  it('accepts a todo in a list that was deleted (it is hidden with the list)', async () => {
    const list = newId();
    await c.ann.push([
      op('list', 'create', list, { name: 'Old', orderKey: 'a1' }, hlcAt(1)),
      op('list', 'delete', list, {}, hlcAt(2)),
    ]);
    const res = await c.ann.push([todoCreate(newId(), list, 'Late task', hlcAt(3))]);
    expect(res.rejected).toEqual([]);
  });

  it('stores the sending browser in the change log', async () => {
    const t = newId();
    await c.ann.push([todoCreate(t, c.inbox, 'x', hlcAt(1))]);
    const rowLog = c.db.prepare('SELECT client_id FROM change_log WHERE entity_id = ?').get(t) as {
      client_id: string;
    };
    expect(rowLog.client_id).toBe('aaaa');
  });

  it('handles the largest allowed batch', async () => {
    const ops = Array.from({ length: 500 }, (_, i) =>
      todoCreate(newId(), c.inbox, `t${i}`, hlcAt(i)),
    );
    const res = await c.ann.push(ops);
    expect(res.accepted).toHaveLength(500);
    expect((c.db.prepare('SELECT COUNT(*) n FROM todos').get() as { n: number }).n).toBe(500);
  });
});

describe('push: repeating is safe', () => {
  it('sending the same batch twice changes nothing the second time', async () => {
    const t = newId();
    const ops = [
      todoCreate(t, c.inbox, 'Once', hlcAt(1)),
      op('todo', 'update', t, { title: 'Twice' }, hlcAt(2)),
    ];
    const first = await c.ann.push(ops);
    const logBefore = logCount(c);
    const rowBefore = row(c, 'todos', t);

    const second = await c.ann.push(ops);
    expect(second.accepted).toEqual(first.accepted);
    expect(second.rejected).toEqual([]);
    expect(logCount(c)).toBe(logBefore);
    expect(row(c, 'todos', t)).toEqual(rowBefore);
    expect(
      (c.db.prepare('SELECT COUNT(*) n FROM todos WHERE id = ?').get(t) as { n: number }).n,
    ).toBe(1);
  });

  it('a resent operation next to a new one only applies the new one', async () => {
    const t = newId();
    const create = todoCreate(t, c.inbox, 'A', hlcAt(1));
    await c.ann.push([create]);
    const logBefore = logCount(c);
    const update = op('todo', 'update', t, { title: 'B' }, hlcAt(2));
    const res = await c.ann.push([create, update]);
    expect(res.accepted).toEqual([create.opId, update.opId]);
    expect(logCount(c)).toBe(logBefore + 1);
    expect(row(c, 'todos', t)!.title).toBe('B');
  });

  it('the same operation id twice in one batch is applied once', async () => {
    const t = newId();
    const create = todoCreate(t, c.inbox, 'A', hlcAt(1));
    const res = await c.ann.push([create, create]);
    expect(res.accepted).toEqual([create.opId, create.opId]);
    expect(logCount(c)).toBe(2); // Inbox + this todo
  });
});

describe('push: operation ids', () => {
  it('records every applied operation id', async () => {
    const ops = [
      todoCreate(newId(), c.inbox, 'A', hlcAt(1)),
      todoCreate(newId(), c.inbox, 'B', hlcAt(2)),
    ];
    await c.ann.push(ops);
    const ids = (c.db.prepare('SELECT op_id FROM processed_ops').all() as { op_id: string }[]).map(
      (r) => r.op_id,
    );
    expect(ids.sort()).toEqual(ops.map((o) => o.opId).sort());
  });

  it('treats the operation id as the key: same id with different content is ignored', async () => {
    const t = newId();
    const first = op('todo', 'update', t, { title: 'A' }, hlcAt(5));
    await c.ann.push([todoCreate(t, c.inbox, 'Base', hlcAt(1)), first]);
    const replay = { ...first, patch: { title: 'B' }, hlc: hlcAt(9) };
    expect((await c.ann.push([replay])).accepted).toEqual([first.opId]);
    expect(row(c, 'todos', t)!.title).toBe('A');
  });
});

describe('push: invalid and refused operations', () => {
  it('rejects the invalid ones and still applies the valid ones', async () => {
    const good1 = todoCreate(newId(), c.inbox, 'Good 1', hlcAt(1));
    const badField = op('todo', 'update', newId(), { title: 'x', userId: 'evil' }, hlcAt(2));
    const badTitle = todoCreate(newId(), c.inbox, '   ', hlcAt(3));
    const good2 = todoCreate(newId(), c.inbox, 'Good 2', hlcAt(4));

    const res = await c.ann.push([good1, badField, badTitle, good2]);
    expect(res.accepted).toEqual([good1.opId, good2.opId]);
    expect(res.rejected).toEqual([
      { opId: badField.opId, reason: 'invalid_operation' },
      { opId: badTitle.opId, reason: 'invalid_operation' },
    ]);
    expect((c.db.prepare('SELECT COUNT(*) n FROM todos').get() as { n: number }).n).toBe(2);
  });

  it('does not remember rejected operations as processed', async () => {
    const missing = op('todo', 'update', newId(), { title: 'x' }, hlcAt(1));
    expect((await c.ann.push([missing])).rejected).toHaveLength(1);
    const n = c.db
      .prepare('SELECT COUNT(*) n FROM processed_ops WHERE op_id = ?')
      .get(missing.opId);
    expect(n).toEqual({ n: 0 });
  });

  it('rejects an update or delete of something that does not exist', async () => {
    const u = op('todo', 'update', newId(), { title: 'x' }, hlcAt(1));
    const d = op('list', 'delete', newId(), {}, hlcAt(2));
    const res = await c.ann.push([u, d]);
    expect(res.rejected).toEqual([
      { opId: u.opId, reason: 'not_found' },
      { opId: d.opId, reason: 'not_found' },
    ]);
  });

  it('rejects a todo for a list that does not exist, on create and on move', async () => {
    const t = newId();
    const create = todoCreate(t, newId(), 'Orphan', hlcAt(1));
    const ok = todoCreate(newId(), c.inbox, 'Fine', hlcAt(2));
    const move = op('todo', 'update', ok.entityId, { listId: newId() }, hlcAt(3));
    const res = await c.ann.push([create, ok, move]);
    expect(res.rejected).toEqual([
      { opId: create.opId, reason: 'list_not_found' },
      { opId: move.opId, reason: 'list_not_found' },
    ]);
    expect(row(c, 'todos', ok.entityId)!.list_id).toBe(c.inbox);
  });

  it('protects the Inbox from rename and delete', async () => {
    const rename = op('list', 'update', c.inbox, { name: 'Mine' }, hlcAt(1));
    const del = op('list', 'delete', c.inbox, {}, hlcAt(2));
    const res = await c.ann.push([rename, del]);
    expect(res.rejected).toEqual([
      { opId: rename.opId, reason: 'inbox_protected' },
      { opId: del.opId, reason: 'inbox_protected' },
    ]);
    expect(row(c, 'lists', c.inbox)).toMatchObject({ name: 'Inbox', deleted_at: null });
  });

  it('never lets a client create an Inbox', async () => {
    const o = op(
      'list',
      'create',
      newId(),
      { name: 'Inbox 2', orderKey: 'a1', isInbox: true },
      hlcAt(1),
    );
    expect((await c.ann.push([o])).rejected).toEqual([
      { opId: o.opId, reason: 'invalid_operation' },
    ]);
  });

  it('rolls back everything if the database fails mid-batch', async () => {
    const a = todoCreate(newId(), c.inbox, 'A', hlcAt(1));
    const b = todoCreate(newId(), c.inbox, 'B', hlcAt(2));
    c.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON todos WHEN NEW.title = 'B'
               BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    const res = await c.ann.rawPush({ clientId: 'aaaa', ops: [a, b] });
    expect(res.status).toBe(500);
    expect((c.db.prepare('SELECT COUNT(*) n FROM todos').get() as { n: number }).n).toBe(0);
    expect(
      (
        c.db.prepare('SELECT COUNT(*) n FROM processed_ops WHERE op_id = ?').get(a.opId) as {
          n: number;
        }
      ).n,
    ).toBe(0);
    c.db.exec('DROP TRIGGER boom');
    // After the problem is gone the same batch works.
    expect((await c.ann.push([a, b])).accepted).toHaveLength(2);
  });
});

describe('users cannot reach each other’s data', () => {
  let bob: Device;
  let bobInbox: string;
  beforeEach(async () => {
    bob = (await registerDevice(c.app, 'bob@corp.test', 'bbbb')).device;
    bobInbox = await bob.inboxId();
  });

  it('rejects changes to someone else’s rows', async () => {
    const t = newId();
    await c.ann.push([todoCreate(t, c.inbox, 'Ann’s secret', hlcAt(1))]);
    const attack = [
      op('todo', 'update', t, { title: 'hacked' }, hlcAt(9)),
      op('todo', 'delete', t, {}, hlcAt(9)),
      op('list', 'delete', c.inbox, {}, hlcAt(9)),
    ];
    const res = await bob.push(attack);
    expect(res.rejected.map((r) => r.reason)).toEqual(['not_found', 'not_found', 'not_found']);
    expect(row(c, 'todos', t)).toMatchObject({ title: 'Ann’s secret', deleted_at: null });
  });

  it('rejects a todo created in someone else’s list', async () => {
    const o = todoCreate(newId(), c.inbox, 'Planted', hlcAt(1));
    expect((await bob.push([o])).rejected).toEqual([{ opId: o.opId, reason: 'list_not_found' }]);
  });

  it('rejects moving own todo into someone else’s list', async () => {
    const t = newId();
    await bob.push([todoCreate(t, bobInbox, 'Mine', hlcAt(1))]);
    const move = op('todo', 'update', t, { listId: c.inbox }, hlcAt(2));
    expect((await bob.push([move])).rejected).toEqual([
      { opId: move.opId, reason: 'list_not_found' },
    ]);
  });

  it('rejects creating a row with an id that belongs to another user', async () => {
    const t = newId();
    await c.ann.push([todoCreate(t, c.inbox, 'Ann’s', hlcAt(1))]);
    const o = todoCreate(t, bobInbox, 'Bob wants this id', hlcAt(2));
    expect((await bob.push([o])).rejected).toEqual([{ opId: o.opId, reason: 'not_found' }]);
    expect(row(c, 'todos', t)!.user_id).toBe(c.me.id);
  });

  it('pull only returns the caller’s changes', async () => {
    await c.ann.push([todoCreate(newId(), c.inbox, 'Ann’s', hlcAt(1))]);
    await bob.push([todoCreate(newId(), bobInbox, 'Bob’s', hlcAt(1))]);
    const annSees = await c.ann.pullAll();
    const bobSees = await bob.pullAll();
    expect(annSees.map((x) => x.entity)).toEqual(['list', 'todo']);
    expect(bobSees.map((x) => x.entity)).toEqual(['list', 'todo']);
    expect(JSON.stringify(annSees)).not.toContain('Bob’s');
    expect(JSON.stringify(bobSees)).not.toContain('Ann’s');
  });

  it('the same operation id from two users does not collide', async () => {
    const shared = newId();
    const a = { ...todoCreate(newId(), c.inbox, 'A', hlcAt(1)), opId: shared };
    const b = { ...todoCreate(newId(), bobInbox, 'B', hlcAt(1)), opId: shared };
    expect((await c.ann.push([a])).accepted).toEqual([shared]);
    expect((await bob.push([b])).accepted).toEqual([shared]);
  });
});

describe('pull', () => {
  it('starts with the Inbox created at sign-up', async () => {
    const { changes, nextSeq, hasMore } = await c.ann.pull(0);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entity: 'list',
      entityId: c.inbox,
      type: 'create',
      patch: { name: 'Inbox', orderKey: 'a0', isInbox: true },
    });
    expect(nextSeq).toBe(changes[0]!.serverSeq);
    expect(hasMore).toBe(false);
  });

  it('returns changes oldest first and only the accepted fields', async () => {
    const t = newId();
    await c.ann.push([
      todoCreate(t, c.inbox, 'A', hlcAt(1)),
      op('todo', 'update', t, { title: 'B', priority: 3 }, hlcAt(2)),
      op('todo', 'delete', t, {}, hlcAt(3)),
    ]);
    const { changes } = await c.ann.pull(0);
    const todo = changes.filter((x) => x.entity === 'todo');
    expect(todo.map((x) => x.type)).toEqual(['create', 'update', 'delete']);
    expect(todo[1]!.patch).toEqual({ title: 'B', priority: 3 });
    expect(todo[2]!.patch).toEqual({ deletedAt: T0 + 3 });
    const seqs = changes.map((x) => x.serverSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('pages with limit, hasMore and nextSeq', async () => {
    await c.ann.push(
      Array.from({ length: 5 }, (_, i) => todoCreate(newId(), c.inbox, `t${i}`, hlcAt(i))),
    );
    // 6 changes in total (Inbox + 5 todos)
    const p1 = await c.ann.pull(0, 4);
    expect(p1.changes).toHaveLength(4);
    expect(p1.hasMore).toBe(true);
    const p2 = await c.ann.pull(p1.nextSeq, 4);
    expect(p2.changes).toHaveLength(2);
    expect(p2.hasMore).toBe(false);
    const all = [...p1.changes, ...p2.changes].map((x) => x.serverSeq);
    expect(new Set(all).size).toBe(6);
  });

  it('returns nothing and keeps the cursor when up to date', async () => {
    const { nextSeq } = await c.ann.pull(0);
    const again = await c.ann.pull(nextSeq);
    expect(again).toEqual({ changes: [], nextSeq, hasMore: false });
  });

  it('caps the page size at 1000', async () => {
    const res = await c.ann.http.get('/api/sync/pull?since=0&limit=100000');
    expect(res.status).toBe(200);
  });

  it('a second browser of the same user sees the changes of the first', async () => {
    const phone = await loginDevice(c.app, 'ann@corp.test', 'cccc');
    const t = newId();
    await c.ann.push([todoCreate(t, c.inbox, 'From laptop', hlcAt(1))]);
    const seen = await phone.pullAll();
    expect(
      seen.some((x) => x.entityId === t && 'title' in x.patch && x.patch.title === 'From laptop'),
    ).toBe(true);
  });
});

describe('conflicts', () => {
  it('keeps both changes when two devices edit different fields', async () => {
    const t = newId();
    await c.ann.push([todoCreate(t, c.inbox, 'Base', hlcAt(1))]);
    const phone = await loginDevice(c.app, 'ann@corp.test', 'bbbb');
    await c.ann.push([op('todo', 'update', t, { title: 'Title from laptop' }, hlcAt(10, 'aaaa'))]);
    await phone.push([op('todo', 'update', t, { dueAt: T0 + 86_400_000 }, hlcAt(10, 'bbbb'))]);
    expect(row(c, 'todos', t)).toMatchObject({
      title: 'Title from laptop',
      due_at: T0 + 86_400_000,
    });
  });

  it('the later edit wins on the same field, whichever arrives first', async () => {
    const t = newId();
    await c.ann.push([todoCreate(t, c.inbox, 'Base', hlcAt(1))]);
    await c.ann.push([op('todo', 'update', t, { title: 'Late' }, hlcAt(20))]);
    const stale = op('todo', 'update', t, { title: 'Early' }, hlcAt(10));
    const logBefore = logCount(c);
    const res = await c.ann.push([stale]);
    expect(res.accepted).toEqual([stale.opId]); // accepted, but it lost
    expect(row(c, 'todos', t)!.title).toBe('Late');
    expect(logCount(c)).toBe(logBefore); // nothing to tell other devices
  });

  it('a stale operation only logs the fields that won', async () => {
    const t = newId();
    await c.ann.push([
      todoCreate(t, c.inbox, 'Base', hlcAt(1)),
      op('todo', 'update', t, { title: 'Late' }, hlcAt(20)),
    ]);
    await c.ann.push([op('todo', 'update', t, { title: 'Early', priority: 1 }, hlcAt(10))]);
    const last = (await c.ann.pullAll()).at(-1)!;
    expect(last.patch).toEqual({ priority: 1 });
  });

  it('a delete wins over an edit from another device', async () => {
    const t = newId();
    await c.ann.push([todoCreate(t, c.inbox, 'Base', hlcAt(1))]);
    const phone = await loginDevice(c.app, 'ann@corp.test', 'bbbb');
    await c.ann.push([op('todo', 'delete', t, {}, hlcAt(10, 'aaaa'))]);
    await phone.push([op('todo', 'update', t, { title: 'Edited offline' }, hlcAt(11, 'bbbb'))]);
    expect(row(c, 'todos', t)).toMatchObject({ title: 'Edited offline', deleted_at: T0 + 10 });
  });

  it('a newer restore undoes a delete; an older one does not', async () => {
    const t = newId();
    await c.ann.push([
      todoCreate(t, c.inbox, 'Base', hlcAt(1)),
      op('todo', 'delete', t, {}, hlcAt(10)),
    ]);
    await c.ann.push([op('todo', 'restore', t, {}, hlcAt(5))]);
    expect(row(c, 'todos', t)!.deleted_at).toBe(T0 + 10);
    await c.ann.push([op('todo', 'restore', t, {}, hlcAt(15))]);
    expect(row(c, 'todos', t)!.deleted_at).toBeNull();
    const last = (await c.ann.pullAll()).at(-1)!;
    expect(last).toMatchObject({ type: 'restore', patch: { deletedAt: null } });
  });
});
