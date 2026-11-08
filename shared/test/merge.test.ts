import { describe, expect, it } from 'vitest';
import { formatHlc } from '../src/hlc';
import { newId } from '../src/id';
import { applyOp, type ApplyInput, type ApplyResult } from '../src/merge';
import type { List, Todo } from '../src/schemas';

const T0 = 1_730_822_400_000;
const hlc = (wall: number, counter = 0, clientId = 'a') => formatHlc({ wall, counter, clientId });

const TODO_ID = newId(T0);
const LIST_ID = newId(T0);

function createTodo(at = hlc(T0)): ApplyInput {
  return {
    entity: 'todo',
    entityId: TODO_ID,
    type: 'create',
    patch: { listId: LIST_ID, title: 'Buy milk', orderKey: 'a0' },
    hlc: at,
  };
}

function updateTodo(patch: Record<string, unknown>, at: string): ApplyInput {
  return { entity: 'todo', entityId: TODO_ID, type: 'update', patch, hlc: at };
}

function op(type: 'delete' | 'restore', at: string): ApplyInput {
  return { entity: 'todo', entityId: TODO_ID, type, patch: {}, hlc: at };
}

/** Applies ops in order, starting from no row. Fails the test on an error. */
function run(ops: ApplyInput[], start?: Todo): Todo {
  let row: Todo | List | undefined = start;
  for (const o of ops) {
    const r: ApplyResult<Todo | List> = applyOp(row, o);
    if (!r.ok) throw new Error(`unexpected ${r.reason}`);
    row = r.row;
  }
  return row as Todo;
}

describe('applyOp – create', () => {
  it('creates a todo from defaults and the patch', () => {
    const r = applyOp(undefined, createTodo());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.row).toEqual({
      id: TODO_ID,
      listId: LIST_ID,
      title: 'Buy milk',
      notes: '',
      done: false,
      completedAt: null,
      dueAt: null,
      priority: 0,
      remindBefore: null,
      orderKey: 'a0',
      fieldHlc: { listId: hlc(T0), title: hlc(T0), orderKey: hlc(T0) },
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    });
    expect(r.accepted).toEqual({ listId: LIST_ID, title: 'Buy milk', orderKey: 'a0' });
  });

  it('creates a list from defaults and the patch', () => {
    const r = applyOp(undefined, {
      entity: 'list',
      entityId: LIST_ID,
      type: 'create',
      patch: { name: 'Work', orderKey: 'a0' },
      hlc: hlc(T0),
    });
    expect(r.ok && r.row).toEqual({
      id: LIST_ID,
      name: 'Work',
      isInbox: false,
      isPublic: false,
      orderKey: 'a0',
      fieldHlc: { name: hlc(T0), orderKey: hlc(T0) },
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    });
  });

  it('keeps server-only fields such as isInbox from a pulled change', () => {
    const r = applyOp(undefined, {
      entity: 'list',
      entityId: LIST_ID,
      type: 'create',
      patch: { name: 'Inbox', orderKey: 'a0', isInbox: true },
      hlc: hlc(T0),
    });
    expect(r.ok && (r.row as List).isInbox).toBe(true);
  });

  it('fails when required fields are missing', () => {
    const r = applyOp(undefined, { ...createTodo(), patch: { title: 'No list' } });
    expect(r).toEqual({ ok: false, reason: 'missing_fields' });
  });

  it('treats a create for an existing row as a merge', () => {
    const existing = run([createTodo(hlc(T0))]);
    const r = applyOp(existing, {
      ...createTodo(hlc(T0 + 1)),
      patch: { listId: LIST_ID, title: 'Other', orderKey: 'a0' },
    });
    expect(r.ok && (r.row as Todo).title).toBe('Other');
  });
});

describe('applyOp – update', () => {
  it('applies a newer value and records its HLC', () => {
    const row = run([createTodo(), updateTodo({ title: 'Buy oat milk' }, hlc(T0 + 10))]);
    expect(row.title).toBe('Buy oat milk');
    expect(row.fieldHlc.title).toBe(hlc(T0 + 10));
    expect(row.updatedAt).toBe(T0 + 10);
  });

  it('ignores an older value for the same field', () => {
    const row = run([
      createTodo(),
      updateTodo({ title: 'Newer' }, hlc(T0 + 20)),
      updateTodo({ title: 'Older' }, hlc(T0 + 10)),
    ]);
    expect(row.title).toBe('Newer');
  });

  it('reports only the accepted fields', () => {
    const row = run([createTodo(), updateTodo({ title: 'Newer' }, hlc(T0 + 20))]);
    const r = applyOp(row, updateTodo({ title: 'Older', priority: 2 }, hlc(T0 + 10)));
    expect(r.ok && r.accepted).toEqual({ priority: 2 });
  });

  it('keeps updatedAt at the latest time', () => {
    const row = run([
      createTodo(),
      updateTodo({ title: 'Newer' }, hlc(T0 + 20)),
      updateTodo({ priority: 1 }, hlc(T0 + 10)),
    ]);
    expect(row.priority).toBe(1);
    expect(row.updatedAt).toBe(T0 + 20);
  });

  it('fails for a row that does not exist', () => {
    expect(applyOp(undefined, updateTodo({ title: 'x' }, hlc(T0)))).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('applying the same operation twice changes nothing the second time', () => {
    const u = updateTodo({ title: 'Once' }, hlc(T0 + 5));
    const once = run([createTodo(), u]);
    const r = applyOp(once, u);
    expect(r.ok && r.changed).toBe(false);
    expect(r.ok && r.accepted).toEqual({});
    expect(r.ok && r.row).toEqual(once);
  });

  it('does not modify the input row', () => {
    const row = run([createTodo()]);
    const copy = structuredClone(row);
    applyOp(row, updateTodo({ title: 'Changed', priority: 3 }, hlc(T0 + 1)));
    expect(row).toEqual(copy);
  });
});

describe('applyOp – conflicts between devices', () => {
  const fromA = updateTodo({ title: 'Title from A' }, hlc(T0 + 10, 0, 'a'));
  const fromB = updateTodo({ dueAt: T0 + 86_400_000 }, hlc(T0 + 10, 0, 'b'));

  it('keeps both changes when devices edit different fields', () => {
    for (const order of [
      [fromA, fromB],
      [fromB, fromA],
    ]) {
      const row = run([createTodo(), ...order]);
      expect(row.title).toBe('Title from A');
      expect(row.dueAt).toBe(T0 + 86_400_000);
    }
  });

  it('the later edit wins when devices edit the same field, in any order', () => {
    const early = updateTodo({ title: 'Early' }, hlc(T0 + 10, 0, 'b'));
    const late = updateTodo({ title: 'Late' }, hlc(T0 + 11, 0, 'a'));
    expect(run([createTodo(), early, late]).title).toBe('Late');
    expect(run([createTodo(), late, early]).title).toBe('Late');
  });

  it('breaks exact-time ties by client id', () => {
    const x = updateTodo({ title: 'From a' }, hlc(T0 + 10, 0, 'a'));
    const y = updateTodo({ title: 'From b' }, hlc(T0 + 10, 0, 'b'));
    expect(run([createTodo(), x, y]).title).toBe('From b');
    expect(run([createTodo(), y, x]).title).toBe('From b');
  });
});

describe('applyOp – delete and restore', () => {
  it('delete sets deletedAt to the operation time', () => {
    const row = run([createTodo(), op('delete', hlc(T0 + 50))]);
    expect(row.deletedAt).toBe(T0 + 50);
    expect(row.fieldHlc.deletedAt).toBe(hlc(T0 + 50));
  });

  it('a delete wins over an edit made at the same time on another device', () => {
    const del = op('delete', hlc(T0 + 10, 0, 'a'));
    const edit = updateTodo({ title: 'Edited' }, hlc(T0 + 11, 0, 'b'));
    for (const order of [
      [del, edit],
      [edit, del],
    ]) {
      const row = run([createTodo(), ...order]);
      expect(row.deletedAt).not.toBeNull();
      expect(row.title).toBe('Edited'); // the edit is stored but does not undelete
    }
  });

  it('a newer restore brings the row back', () => {
    const row = run([createTodo(), op('delete', hlc(T0 + 10)), op('restore', hlc(T0 + 20))]);
    expect(row.deletedAt).toBeNull();
  });

  it('an older restore does not undo a newer delete', () => {
    const row = run([createTodo(), op('delete', hlc(T0 + 20)), op('restore', hlc(T0 + 10))]);
    expect(row.deletedAt).toBe(T0 + 20);
  });

  it('delete and restore fail for a row that does not exist', () => {
    expect(applyOp(undefined, op('delete', hlc(T0)))).toEqual({ ok: false, reason: 'not_found' });
    expect(applyOp(undefined, op('restore', hlc(T0)))).toEqual({ ok: false, reason: 'not_found' });
  });

  it('accepts a pulled delete change that carries deletedAt in its patch', () => {
    const r = applyOp(run([createTodo()]), {
      ...op('delete', hlc(T0 + 30)),
      patch: { deletedAt: T0 + 30 },
    });
    expect(r.ok && (r.row as Todo).deletedAt).toBe(T0 + 30);
  });
});

describe('applyOp – convergence', () => {
  it('every order of the same operations gives the same row', () => {
    const ops: ApplyInput[] = [
      updateTodo({ title: 'A1' }, hlc(T0 + 10, 0, 'a')),
      updateTodo({ title: 'B1', priority: 2 }, hlc(T0 + 12, 0, 'b')),
      updateTodo({ done: true, completedAt: T0 + 13 }, hlc(T0 + 13, 0, 'a')),
      op('delete', hlc(T0 + 14, 0, 'b')),
      op('restore', hlc(T0 + 15, 0, 'a')),
      updateTodo({ notes: 'n', priority: 1 }, hlc(T0 + 11, 0, 'c')),
      updateTodo({ title: 'A1' }, hlc(T0 + 10, 0, 'a')), // duplicate delivery
    ];

    const permutations = (xs: ApplyInput[]): ApplyInput[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) =>
            permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
          );

    const results = permutations(ops).map((p) => run([createTodo(), ...p]));
    expect(results.length).toBe(5040);
    for (const r of results) expect(r).toEqual(results[0]);

    expect(results[0]).toMatchObject({
      title: 'B1',
      priority: 2,
      done: true,
      notes: 'n',
      deletedAt: null,
      updatedAt: T0 + 15,
    });
  });
});

describe('v1 fields', () => {
  it('a new todo starts without a reminder, a new list starts private', () => {
    const todo = run([createTodo()]);
    expect(todo.remindBefore).toBeNull();

    const r = applyOp<List>(undefined, {
      entity: 'list',
      entityId: newId(T0),
      type: 'create',
      patch: { name: 'Recipes', orderKey: 'a1' },
      hlc: hlc(T0),
    });
    expect(r.ok && r.row.isPublic).toBe(false);
  });

  it('remindBefore is merged per field, last write wins', () => {
    const todo = run([
      createTodo(),
      updateTodo({ remindBefore: 'week' }, hlc(T0 + 10)),
      updateTodo({ remindBefore: 'hour' }, hlc(T0 + 5)), // older: ignored
    ]);
    expect(todo.remindBefore).toBe('week');
    expect(run([updateTodo({ remindBefore: null }, hlc(T0 + 20))], todo).remindBefore).toBeNull();
  });

  it('isPublic is merged per field and independent of the name', () => {
    const create = applyOp<List>(undefined, {
      entity: 'list',
      entityId: newId(T0),
      type: 'create',
      patch: { name: 'Recipes', orderKey: 'a1' },
      hlc: hlc(T0),
    });
    if (!create.ok) throw new Error('create failed');
    const upd = (patch: Record<string, unknown>, at: string) => ({
      entity: 'list' as const,
      entityId: create.row.id,
      type: 'update' as const,
      patch,
      hlc: at,
    });
    const a = applyOp<List>(create.row, upd({ isPublic: true }, hlc(T0 + 10)));
    if (!a.ok) throw new Error('a failed');
    const b = applyOp<List>(a.row, upd({ name: 'Food' }, hlc(T0 + 5)));
    if (!b.ok) throw new Error('b failed');
    expect(b.row).toMatchObject({ isPublic: true, name: 'Food' });
    const c = applyOp<List>(b.row, upd({ isPublic: false }, hlc(T0 + 3))); // older: ignored
    expect(c.ok && c.changed).toBe(false);
  });
});
