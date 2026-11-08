import { describe, expect, it } from 'vitest';
import { syncOpSchema } from '@todoness/shared';
import { createPublicEditor } from '../src/app/publicEdit';
import { fakeNow, testDb } from './helpers';
import { fakeFetch, json, type Call } from './sync-helpers';

const LIST = '0192f0c1-0000-7000-8000-0000000000a1';
const TODO = '0192f0c1-0000-7000-8000-0000000000b1';

function setup(
  answer: (call: Call) => Response | 'network-error' = (call) =>
    json(200, { accepted: [call.body.ops[0].opId], rejected: [] }),
) {
  const db = testDb();
  const f = fakeFetch(answer);
  const now = fakeNow();
  const editor = createPublicEditor({ db, fetch: f, now });
  const ops = () => f.calls.flatMap((c) => c.body.ops as Record<string, unknown>[]);
  return { db, f, now, editor, ops };
}

describe('public editor (FR-33)', () => {
  it('sends a valid create for a new task, on top of the others', async () => {
    const { editor, f, ops } = setup();
    const r = await editor.createTodo(LIST, '  Buy milk  ', 'a5');
    expect(r).toEqual({ ok: true });
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: `/api/public/lists/${LIST}/push` });
    const op = syncOpSchema.parse(ops()[0]);
    expect(op).toMatchObject({
      entity: 'todo',
      type: 'create',
      patch: { listId: LIST, title: 'Buy milk' },
    });
    expect((op.patch as { orderKey: string }).orderKey < 'a5').toBe(true);
  });

  it('sends updates, done, delete and restore as the matching operations', async () => {
    const { editor, ops } = setup();
    await editor.updateTodo(LIST, TODO, { title: 'New', priority: 2 });
    await editor.setDone(LIST, TODO, true);
    await editor.setDone(LIST, TODO, false);
    await editor.deleteTodo(LIST, TODO);
    await editor.restoreTodo(LIST, TODO);
    const sent = ops().map((o) => syncOpSchema.parse(o));
    expect(sent.map((o) => [o.type, o.patch])).toEqual([
      ['update', { title: 'New', priority: 2 }],
      ['update', { done: true, completedAt: expect.any(Number) }],
      ['update', { done: false, completedAt: null }],
      ['delete', {}],
      ['restore', {}],
    ]);
  });

  it('turns a drop into one orderKey update, and sends nothing if nothing changes', async () => {
    const { editor, f, ops } = setup();
    const [x1, x2, x3] = [1, 2, 3].map((n) => `0192f0c1-0000-7000-8000-0000000000c${n}`);
    const open = [
      { id: x1!, orderKey: 'a0' },
      { id: x2!, orderKey: 'a1' },
      { id: x3!, orderKey: 'a2' },
    ];
    await editor.reorder(LIST, open, x3!, x1!);
    expect(ops()).toHaveLength(1);
    expect(ops()[0]).toMatchObject({ entityId: x3, type: 'update' });
    await editor.reorder(LIST, open, x2!, x3!); // already before x3
    expect(f.calls).toHaveLength(1);
  });

  it('uses this device’s clock: ids and times only go forward, the client id is kept', async () => {
    const { editor, f, db, now } = setup();
    await editor.updateTodo(LIST, TODO, { title: 'a' });
    now.advance(5);
    await editor.updateTodo(LIST, TODO, { title: 'b' });
    const [a, b] = f.calls.map((c) => c.body);
    expect(a.clientId).toBe(b.clientId);
    expect(a.clientId).toBe(await db.getMeta('clientId'));
    expect(a.ops[0].hlc < b.ops[0].hlc).toBe(true);
    expect(a.ops[0].opId).not.toBe(b.ops[0].opId);
  });

  it('maps server answers to results', async () => {
    const cases: [() => Response | 'network-error', string][] = [
      [() => json(404, {}), 'gone'],
      [() => json(401, {}), 'auth'],
      [() => json(500, {}), 'server'],
      [() => 'network-error', 'offline'],
      [
        () => json(200, { accepted: [], rejected: [{ opId: TODO, reason: 'not_found' }] }),
        'rejected',
      ],
      [() => json(200, { nonsense: true }), 'server'],
    ];
    for (const [answer, error] of cases) {
      const { editor } = setup(() => answer());
      expect(await editor.updateTodo(LIST, TODO, { title: 'x' }), error).toEqual({
        ok: false,
        error,
      });
    }
  });

  it('refuses an invalid change without calling the server', async () => {
    const { editor, f } = setup();
    expect(await editor.updateTodo(LIST, TODO, { title: '   ' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(f.calls).toHaveLength(0);
  });

  it('tells subscribers after every change that was accepted', async () => {
    const { editor } = setup();
    let n = 0;
    const off = editor.subscribe(() => n++);
    await editor.updateTodo(LIST, TODO, { title: 'x' });
    expect(n).toBe(1);
    off();
    await editor.updateTodo(LIST, TODO, { title: 'y' });
    expect(n).toBe(1);
  });
});
