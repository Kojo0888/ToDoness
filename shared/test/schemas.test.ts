import { describe, expect, it } from 'vitest';
import { newId } from '../src/id';
import {
  listSchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
  syncOpSchema,
  todoSchema,
} from '../src/schemas';

const HLC = '1730822400000-0003-c9f1a2';

function op(overrides: Record<string, unknown>) {
  return {
    opId: newId(),
    entity: 'todo',
    entityId: newId(),
    type: 'update',
    patch: { title: 'Buy milk' },
    hlc: HLC,
    ...overrides,
  };
}

const todoCreate = () =>
  op({ type: 'create', patch: { listId: newId(), title: 'Buy milk', orderKey: 'a0' } });

describe('syncOpSchema – todos', () => {
  it('accepts a minimal create', () => {
    expect(syncOpSchema.safeParse(todoCreate()).success).toBe(true);
  });

  it('accepts a create with every optional field', () => {
    const o = op({
      type: 'create',
      patch: {
        listId: newId(),
        title: 'Pay rent',
        orderKey: 'a0',
        notes: 'before the 10th',
        done: false,
        completedAt: null,
        dueAt: 1_730_822_400_000,
        priority: 3,
      },
    });
    expect(syncOpSchema.safeParse(o).success).toBe(true);
  });

  it('requires listId, title and orderKey on create', () => {
    for (const missing of ['listId', 'title', 'orderKey']) {
      const o = todoCreate();
      delete (o.patch as Record<string, unknown>)[missing];
      expect(syncOpSchema.safeParse(o).success, missing).toBe(false);
    }
  });

  it('trims the title and rejects an empty or too long one', () => {
    const parsed = syncOpSchema.parse(op({ patch: { title: '  Buy milk  ' } }));
    expect(parsed.patch).toEqual({ title: 'Buy milk' });
    expect(syncOpSchema.safeParse(op({ patch: { title: '   ' } })).success).toBe(false);
    expect(syncOpSchema.safeParse(op({ patch: { title: 'x'.repeat(501) } })).success).toBe(false);
    expect(syncOpSchema.safeParse(op({ patch: { title: 'x'.repeat(500) } })).success).toBe(true);
  });

  it('accepts priority 0–3 only', () => {
    for (const p of [0, 1, 2, 3]) {
      expect(syncOpSchema.safeParse(op({ patch: { priority: p } })).success).toBe(true);
    }
    for (const p of [-1, 4, 1.5, '2']) {
      expect(syncOpSchema.safeParse(op({ patch: { priority: p } })).success, String(p)).toBe(false);
    }
  });

  it('accepts dates as epoch milliseconds or null', () => {
    expect(syncOpSchema.safeParse(op({ patch: { dueAt: null } })).success).toBe(true);
    expect(syncOpSchema.safeParse(op({ patch: { dueAt: 1_730_822_400_000 } })).success).toBe(true);
    expect(syncOpSchema.safeParse(op({ patch: { dueAt: '2026-11-05' } })).success).toBe(false);
    expect(syncOpSchema.safeParse(op({ patch: { dueAt: -5 } })).success).toBe(false);
  });

  it('rejects fields the client may not set (whitelist)', () => {
    for (const field of ['id', 'userId', 'fieldHlc', 'createdAt', 'updatedAt', 'deletedAt']) {
      const o = op({ patch: { title: 'ok', [field]: 1 } });
      expect(syncOpSchema.safeParse(o).success, field).toBe(false);
    }
  });

  it('rejects an update that changes nothing', () => {
    expect(syncOpSchema.safeParse(op({ patch: {} })).success).toBe(false);
  });

  it('accepts delete and restore only with an empty patch', () => {
    for (const type of ['delete', 'restore']) {
      expect(syncOpSchema.safeParse(op({ type, patch: {} })).success, type).toBe(true);
      expect(syncOpSchema.safeParse(op({ type, patch: { title: 'x' } })).success, type).toBe(false);
    }
  });

  it('rejects unknown types and entities', () => {
    expect(syncOpSchema.safeParse(op({ type: 'upsert' })).success).toBe(false);
    expect(syncOpSchema.safeParse(op({ entity: 'user' })).success).toBe(false);
  });

  it('rejects invalid ids and HLCs', () => {
    expect(syncOpSchema.safeParse(op({ opId: 'abc' })).success).toBe(false);
    expect(syncOpSchema.safeParse(op({ entityId: 'abc' })).success).toBe(false);
    expect(syncOpSchema.safeParse(op({ hlc: '2026-11-05' })).success).toBe(false);
  });
});

describe('syncOpSchema – lists', () => {
  const listOp = (type: string, patch: Record<string, unknown>) =>
    op({ entity: 'list', type, patch });

  it('accepts create, update, delete and restore', () => {
    expect(syncOpSchema.safeParse(listOp('create', { name: 'Work', orderKey: 'a0' })).success).toBe(
      true,
    );
    expect(syncOpSchema.safeParse(listOp('update', { name: 'Home' })).success).toBe(true);
    expect(syncOpSchema.safeParse(listOp('delete', {})).success).toBe(true);
    expect(syncOpSchema.safeParse(listOp('restore', {})).success).toBe(true);
  });

  it('requires name and orderKey on create', () => {
    expect(syncOpSchema.safeParse(listOp('create', { name: 'Work' })).success).toBe(false);
    expect(syncOpSchema.safeParse(listOp('create', { orderKey: 'a0' })).success).toBe(false);
  });

  it('does not let the client mark a list as Inbox', () => {
    expect(syncOpSchema.safeParse(listOp('update', { isInbox: true })).success).toBe(false);
    expect(
      syncOpSchema.safeParse(listOp('create', { name: 'X', orderKey: 'a0', isInbox: true }))
        .success,
    ).toBe(false);
  });

  it('limits the name to 1–200 characters', () => {
    expect(syncOpSchema.safeParse(listOp('update', { name: '' })).success).toBe(false);
    expect(syncOpSchema.safeParse(listOp('update', { name: 'x'.repeat(201) })).success).toBe(false);
  });

  it('does not accept todo fields on a list', () => {
    expect(syncOpSchema.safeParse(listOp('update', { title: 'x' })).success).toBe(false);
  });
});

describe('pushRequestSchema / pushResponseSchema', () => {
  it('accepts a batch of operations', () => {
    const body = { clientId: 'c9f1a2', ops: [todoCreate(), op({})] };
    expect(pushRequestSchema.safeParse(body).success).toBe(true);
  });

  it('rejects an empty batch, a batch over 500 and a bad client id', () => {
    expect(pushRequestSchema.safeParse({ clientId: 'c9f1a2', ops: [] }).success).toBe(false);
    const many = Array.from({ length: 501 }, () => op({}));
    expect(pushRequestSchema.safeParse({ clientId: 'c9f1a2', ops: many }).success).toBe(false);
    expect(pushRequestSchema.safeParse({ clientId: 'bad-id', ops: [op({})] }).success).toBe(false);
  });

  it('accepts a response', () => {
    const res = { accepted: [newId()], rejected: [{ opId: newId(), reason: 'not found' }] };
    expect(pushResponseSchema.safeParse(res).success).toBe(true);
  });
});

describe('pullResponseSchema', () => {
  it('accepts changes including server-only fields', () => {
    const res = {
      changes: [
        {
          serverSeq: 1,
          entity: 'list',
          entityId: newId(),
          type: 'create',
          patch: { name: 'Inbox', orderKey: 'a0', isInbox: true },
          hlc: HLC,
        },
        {
          serverSeq: 2,
          entity: 'todo',
          entityId: newId(),
          type: 'delete',
          patch: { deletedAt: 1_730_822_400_000 },
          hlc: HLC,
        },
      ],
      nextSeq: 2,
      hasMore: false,
    };
    expect(pullResponseSchema.safeParse(res).success).toBe(true);
  });

  it('rejects a non-positive serverSeq', () => {
    const res = {
      changes: [
        { serverSeq: 0, entity: 'todo', entityId: newId(), type: 'update', patch: {}, hlc: HLC },
      ],
      nextSeq: 0,
      hasMore: false,
    };
    expect(pullResponseSchema.safeParse(res).success).toBe(false);
  });
});

describe('todoSchema / listSchema', () => {
  it('accept full rows', () => {
    const now = 1_730_822_400_000;
    const todo = {
      id: newId(),
      listId: newId(),
      title: 'Buy milk',
      notes: '',
      done: false,
      completedAt: null,
      dueAt: null,
      priority: 0,
      orderKey: 'a0',
      fieldHlc: { title: HLC },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    expect(todoSchema.safeParse(todo).success).toBe(true);
    expect(todoSchema.safeParse({ ...todo, fieldHlc: { title: 'bad' } }).success).toBe(false);

    const list = {
      id: newId(),
      name: 'Inbox',
      isInbox: true,
      orderKey: 'a0',
      fieldHlc: {},
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    expect(listSchema.safeParse(list).success).toBe(true);
  });
});
