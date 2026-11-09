/** The public list editor queues its changes (docs/v1/PRD.md FR-33, docs/notes/PRD.md FR-107). */
import { describe, expect, it } from 'vitest';
import { syncOpSchema } from '@todoness/shared';
import { createPublicEditor } from '../../src/services/publicEdit';
import { fakeNow, testDb } from '../helpers/db';

const LIST = '0192f0c1-0000-7000-8000-0000000000a1';
const TODO = '0192f0c1-0000-7000-8000-0000000000b1';

function setup() {
  const db = testDb();
  const now = fakeNow();
  const editor = createPublicEditor({ db, now });
  /** The queued operations in the order they will be sent, without the queue fields. */
  const ops = async () =>
    (await db.publicOutbox.orderBy('hlc').toArray()).map(
      ({ attempts, createdAt, target, targetId, ...op }) => {
        expect([target, targetId]).toEqual(['list', LIST]);
        void [attempts, createdAt];
        return syncOpSchema.parse(op);
      },
    );
  return { db, now, editor, ops };
}

describe('public editor (FR-33, FR-107)', () => {
  it('queues a valid create for a new task, on top of the others', async () => {
    const { editor, ops } = setup();
    expect(await editor.createTodo(LIST, '  Buy milk  ', 'a5')).toEqual({ ok: true });
    const [op] = await ops();
    expect(op).toMatchObject({
      entity: 'todo',
      type: 'create',
      patch: { listId: LIST, title: 'Buy milk' },
    });
    expect((op!.patch as { orderKey: string }).orderKey < 'a5').toBe(true);
  });

  it('queues updates, done, delete and restore as the matching operations', async () => {
    const { editor, ops, now } = setup();
    await editor.updateTodo(LIST, TODO, { title: 'New', priority: 2 });
    for (const change of [
      () => editor.setDone(LIST, TODO, true),
      () => editor.setDone(LIST, TODO, false),
      () => editor.deleteTodo(LIST, TODO),
      () => editor.restoreTodo(LIST, TODO),
    ]) {
      now.advance(1);
      await change();
    }
    expect((await ops()).map((o) => [o.type, o.patch])).toEqual([
      ['update', { title: 'New', priority: 2 }],
      ['update', { done: true, completedAt: expect.any(Number) }],
      ['update', { done: false, completedAt: null }],
      ['delete', {}],
      ['restore', {}],
    ]);
  });

  it('turns a drop into one orderKey update, and queues nothing if nothing changes', async () => {
    const { editor, ops } = setup();
    const [x1, x2, x3] = [1, 2, 3].map((n) => `0192f0c1-0000-7000-8000-0000000000c${n}`);
    const open = [
      { id: x1!, orderKey: 'a0' },
      { id: x2!, orderKey: 'a1' },
      { id: x3!, orderKey: 'a2' },
    ];
    await editor.reorder(LIST, open, x3!, x1!);
    await editor.reorder(LIST, open, x2!, x3!); // already before x3
    const queued = await ops();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ entityId: x3, type: 'update' });
  });

  it('uses this device’s clock: ids and times only go forward', async () => {
    const { editor, ops, now } = setup();
    await editor.updateTodo(LIST, TODO, { title: 'a' });
    now.advance(5);
    await editor.updateTodo(LIST, TODO, { title: 'b' });
    const [a, b] = await ops();
    expect(a!.hlc < b!.hlc).toBe(true);
    expect(a!.opId).not.toBe(b!.opId);
  });

  it('refuses an invalid change without queuing it', async () => {
    const { editor, db } = setup();
    expect(await editor.updateTodo(LIST, TODO, { title: '   ' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await db.publicOutbox.count()).toBe(0);
  });
});
